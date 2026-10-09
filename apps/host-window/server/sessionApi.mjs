/**
 * File-bypass session API helpers + Connect-style middleware for Host window.
 * Reads IUI_SESSION_DIR (current.json / snapshot / events) and writes actions.ndjson.
 *
 * Auth: all /api/* except GET /api/health require shared IUI_HOST_TOKEN
 * (Bearer / X-IUI-Host-Token / ?token=). See hostAuth.mjs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  applyStrictCors,
  ensureHostToken,
  extractRequestToken,
  isPublicApiPath,
  tokensEqual,
} from "./hostAuth.mjs";
import { attachSessionSse } from "./sseStream.mjs";

export {
  resolveHostToken,
  ensureHostToken,
  defaultHostTokenPath,
  extractRequestToken,
  isAllowedCorsOrigin,
} from "./hostAuth.mjs";

export function resolveSessionDir(override) {
  const dir =
    override ??
    process.env.IUI_SESSION_DIR ??
    path.join(os.homedir(), ".intelligent-ui-mcp", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJsonFile(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function readNdjson(filePath, since = 0) {
  if (!fs.existsSync(filePath)) {
    return { lines: [], nextOffset: 0, totalLines: 0 };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const all = raw.length ? raw.replace(/\n$/, "").split("\n") : [];
  const slice = all.slice(Math.max(0, since));
  const lines = [];
  for (const line of slice) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      lines.push({ type: "parse_error", raw: line });
    }
  }
  return { lines, nextOffset: all.length, totalLines: all.length };
}

export function currentPath(dir) {
  return path.join(dir, "current.json");
}
export function snapshotPath(dir, sessionId) {
  return path.join(dir, `${sessionId}.snapshot.json`);
}
export function eventsPath(dir, sessionId) {
  return path.join(dir, `${sessionId}.ndjson`);
}
export function actionsPath(dir, sessionId) {
  return path.join(dir, `${sessionId}.actions.ndjson`);
}

/** In-memory actionId sets per session file (process-local hot path). */
const seenActionIdsByFile = new Map();

function loadSeenActionIds(file) {
  const cached = seenActionIdsByFile.get(file);
  if (cached) return cached;
  const set = new Set();
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj.actionId === "string" && obj.actionId) {
          set.add(obj.actionId);
        }
      } catch {
        /* skip corrupt lines */
      }
    }
  }
  seenActionIdsByFile.set(file, set);
  return set;
}

/**
 * Append action to {sessionId}.actions.ndjson. Idempotent on actionId
 * via parsed NDJSON + in-memory Set (not substring includes).
 * @returns {{ ok: true, actionId: string, duplicate?: boolean } | { ok: false, error: string }}
 */
export function appendAction(dir, body) {
  const sessionId = body?.sessionId;
  if (!sessionId || typeof sessionId !== "string") {
    return { ok: false, error: "sessionId required" };
  }
  const type = body?.type ?? body?.action?.type;
  if (!type || typeof type !== "string") {
    return { ok: false, error: "type required" };
  }

  const actionId =
    (typeof body.actionId === "string" && body.actionId) ||
    `a_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(actionId)) {
    return { ok: false, error: "actionId invalid" };
  }

  const record = {
    actionId,
    sessionId,
    nodeId: body.nodeId ?? body.action?.nodeId ?? null,
    type,
    componentType: body.componentType ?? body.action?.componentType ?? null,
    value: body.value !== undefined ? body.value : body.action?.value,
    path: body.path ?? body.action?.path,
    payload: body.payload ?? body.action?.payload ?? {},
    ts: body.ts ?? new Date().toISOString(),
    source: body.source ?? body.action?.source ?? "host",
  };

  const file = actionsPath(dir, sessionId);
  fs.mkdirSync(dir, { recursive: true });

  const seen = loadSeenActionIds(file);
  if (seen.has(actionId)) {
    return { ok: true, actionId, duplicate: true };
  }

  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
  seen.add(actionId);
  return { ok: true, actionId, duplicate: false };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  const MAX = 1_000_000;
  for await (const chunk of req) {
    total += chunk.length ?? Buffer.byteLength(chunk);
    if (total > MAX) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    const e = new Error(
      `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
    );
    e.code = "BAD_JSON";
    throw e;
  }
}

/**
 * Connect / Vite middleware: /api/*
 * @param {string} [sessionDir]
 * @param {{ hostToken?: string }} [opts]
 */
export function createSessionMiddleware(sessionDir, opts = {}) {
  const dir = resolveSessionDir(sessionDir);
  const expectedToken = opts.hostToken ?? ensureHostToken();

  return async function sessionMiddleware(req, res, next) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (!pathname.startsWith("/api/")) {
      return next();
    }

    const corsOk = applyStrictCors(req, res);
    if (!corsOk) {
      return sendJson(res, 403, {
        ok: false,
        error: "CORS_ORIGIN_DENIED",
        message: "Origin not on loopback allowlist",
      });
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Content-Length", "0");
      res.end();
      return;
    }

    const publicPath = isPublicApiPath(pathname, req.method);
    if (!publicPath) {
      const provided = extractRequestToken(req, url);
      if (!provided || !tokensEqual(provided, expectedToken)) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="intelligent-ui-host"');
        return sendJson(res, 401, {
          ok: false,
          error: "UNAUTHORIZED",
          message:
            "Host API requires IUI_HOST_TOKEN (Authorization: Bearer …, X-IUI-Host-Token, or ?token=)",
        });
      }
    }

    try {
      if (req.method === "GET" && pathname === "/api/health") {
        return sendJson(res, 200, {
          ok: true,
          sessionDir: dir,
          auth: "required-except-health",
          sse: true,
          ssePath: "/api/stream",
        });
      }

      if (req.method === "GET" && pathname === "/api/config") {
        return sendJson(res, 200, {
          ok: true,
          sessionDir: dir,
          iuiSessionDirEnv: process.env.IUI_SESSION_DIR ?? null,
          authRequired: true,
        });
      }

      // SSE push (preferred over short-poll). Auth + CORS already applied.
      if (req.method === "GET" && (pathname === "/api/stream" || pathname === "/api/events")) {
        const accept = String(req.headers.accept ?? "");
        // /api/events without :sessionId is SSE; /api/events/:id stays JSON below.
        // Allow explicit ?format=sse or Accept: text/event-stream; /api/stream always SSE.
        const wantSse =
          pathname === "/api/stream" ||
          url.searchParams.get("format") === "sse" ||
          accept.includes("text/event-stream");
        if (pathname === "/api/events" && !wantSse) {
          return sendJson(res, 400, {
            ok: false,
            error: "USE_SSE_OR_SESSION",
            message:
              "GET /api/events is SSE (Accept: text/event-stream or ?format=sse). For JSON poll use GET /api/events/:sessionId?since=",
          });
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        if (typeof res.flushHeaders === "function") {
          try {
            res.flushHeaders();
          } catch {
            /* ignore */
          }
        }
        attachSessionSse(res, {
          sessionDir: dir,
          pinnedSessionId: url.searchParams.get("sessionId"),
          eventsSince: Number(url.searchParams.get("since") ?? "0") || 0,
          includeSnapshot: url.searchParams.get("snapshot") !== "0",
          includeActions: url.searchParams.get("actions") !== "0",
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/packages") {
        const registryFile = path.join(dir, "registry.json");
        const registry = readJsonFile(registryFile, { packages: [], updatedAt: null });
        return sendJson(res, 200, {
          ok: true,
          sessionDir: dir,
          registryPath: registryFile,
          updatedAt: registry?.updatedAt ?? null,
          packages: Array.isArray(registry?.packages) ? registry.packages : [],
        });
      }

      if (req.method === "GET" && pathname === "/api/current") {
        const current = readJsonFile(currentPath(dir), null);
        return sendJson(res, 200, {
          ok: true,
          sessionDir: dir,
          current,
        });
      }

      const snapMatch = pathname.match(/^\/api\/snapshot\/([^/]+)$/);
      if (req.method === "GET" && snapMatch) {
        const sessionId = decodeURIComponent(snapMatch[1]);
        const snap = readJsonFile(snapshotPath(dir, sessionId), null);
        if (!snap) {
          return sendJson(res, 404, { ok: false, error: "SNAPSHOT_NOT_FOUND", sessionId });
        }
        return sendJson(res, 200, { ok: true, sessionId, snapshot: snap });
      }

      const eventsMatch = pathname.match(/^\/api\/events\/([^/]+)$/);
      if (req.method === "GET" && eventsMatch) {
        const sessionId = decodeURIComponent(eventsMatch[1]);
        const since = Number(url.searchParams.get("since") ?? "0") || 0;
        const result = readNdjson(eventsPath(dir, sessionId), since);
        return sendJson(res, 200, {
          ok: true,
          sessionId,
          since,
          ...result,
        });
      }

      const actionsMatch = pathname.match(/^\/api\/actions\/([^/]+)$/);
      if (req.method === "GET" && actionsMatch) {
        const sessionId = decodeURIComponent(actionsMatch[1]);
        const since = Number(url.searchParams.get("since") ?? "0") || 0;
        const result = readNdjson(actionsPath(dir, sessionId), since);
        return sendJson(res, 200, {
          ok: true,
          sessionId,
          since,
          ...result,
        });
      }

      const pkgEntryMatch = pathname.match(/^\/api\/package-entry\/([^/]+)$/);
      if (req.method === "GET" && pkgEntryMatch) {
        const packageId = decodeURIComponent(pkgEntryMatch[1]);
        const registryFile = path.join(dir, "registry.json");
        const registry = readJsonFile(registryFile, { packages: [] });
        const pkgs = Array.isArray(registry?.packages) ? registry.packages : [];
        const rec = pkgs.find((p) => p && p.id === packageId);
        if (!rec) {
          return sendJson(res, 404, {
            ok: false,
            error: "PACKAGE_NOT_REGISTERED",
            packageId,
          });
        }
        if (rec.enabled === false) {
          return sendJson(res, 403, {
            ok: false,
            error: "PACKAGE_DISABLED",
            packageId,
          });
        }
        const entryAbs = rec.entryAbsPath;
        if (!entryAbs || typeof entryAbs !== "string") {
          return sendJson(res, 400, {
            ok: false,
            error: "NO_ENTRY",
            packageId,
          });
        }
        let realEntry;
        try {
          realEntry = fs.realpathSync(entryAbs);
        } catch {
          return sendJson(res, 404, {
            ok: false,
            error: "ENTRY_NOT_FOUND",
            packageId,
            entryAbsPath: entryAbs,
          });
        }
        // Must stay under the registered package root (prevents registry tampering → arbitrary read).
        let rootReal = rec.rootPath;
        try {
          if (rootReal && fs.existsSync(rootReal)) rootReal = fs.realpathSync(rootReal);
        } catch {
          /* keep */
        }
        if (
          rootReal &&
          realEntry !== rootReal &&
          !realEntry.startsWith(rootReal + path.sep)
        ) {
          return sendJson(res, 403, {
            ok: false,
            error: "ENTRY_OUTSIDE_PACKAGE_ROOT",
            packageId,
          });
        }
        const maxBytes = 1_500_000;
        const st = fs.statSync(realEntry);
        if (!st.isFile()) {
          return sendJson(res, 400, { ok: false, error: "ENTRY_NOT_FILE", packageId });
        }
        if (st.size > maxBytes) {
          return sendJson(res, 413, {
            ok: false,
            error: "ENTRY_TOO_LARGE",
            packageId,
            size: st.size,
            maxBytes,
          });
        }
        const source = fs.readFileSync(realEntry, "utf8");
        const actualHash =
          "sha256-" + createHash("sha256").update(source, "utf8").digest("hex");
        const expectedHash =
          typeof rec.hash === "string" && rec.hash.trim() ? rec.hash.trim() : null;
        const strictHashEnv = (process.env.IUI_STRICT_HASH ?? "1").trim().toLowerCase();
        const strictHash =
          !["0", "false", "off", "no"].includes(strictHashEnv);
        if (strictHash) {
          if (!expectedHash) {
            return sendJson(res, 409, {
              ok: false,
              error: "HASH_MISSING",
              packageId,
              message: "registry hash required when IUI_STRICT_HASH is on (default)",
            });
          }
          if (expectedHash.toLowerCase() !== actualHash.toLowerCase()) {
            return sendJson(res, 409, {
              ok: false,
              error: "HASH_MISMATCH",
              packageId,
              expected: expectedHash,
              actual: actualHash,
            });
          }
        }
        return sendJson(res, 200, {
          ok: true,
          packageId,
          entryAbsPath: realEntry,
          hash: expectedHash ?? actualHash,
          bytes: Buffer.byteLength(source, "utf8"),
          source,
        });
      }

      if (req.method === "POST" && pathname === "/api/action") {
        const body = await readBody(req);
        const result = appendAction(dir, body);
        if (!result.ok) {
          return sendJson(res, 400, result);
        }
        return sendJson(res, 200, result);
      }

      return sendJson(res, 404, { ok: false, error: "NOT_FOUND", path: pathname, method: req.method });
    } catch (err) {
      const status = err?.code === "BAD_JSON" ? 400 : 500;
      return sendJson(res, status, {
        ok: false,
        error: status === 400 ? "BAD_JSON" : "INTERNAL",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

/**
 * Minimal Node HTTP server wrapping the middleware (for smoke / preview without Vite).
 */
export function startSessionApiServer(opts = {}) {
  const dir = resolveSessionDir(opts.sessionDir);
  const hostToken = opts.hostToken ?? ensureHostToken();
  const middleware = createSessionMiddleware(dir, { hostToken });
  const port = opts.port ?? 0;

  return new Promise((resolve, reject) => {
    import("node:http").then(({ createServer }) => {
      const server = createServer((req, res) => {
        middleware(req, res, () => {
          sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
        });
      });
      server.on("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const addr = server.address();
        resolve({
          server,
          port: typeof addr === "object" && addr ? addr.port : port,
          sessionDir: dir,
          hostToken,
          close: () =>
            new Promise((r, j) => server.close((e) => (e ? j(e) : r()))),
        });
      });
    });
  });
}
