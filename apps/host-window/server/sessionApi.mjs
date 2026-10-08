/**
 * File-bypass session API helpers + Connect-style middleware for Host window.
 * Reads IUI_SESSION_DIR (current.json / snapshot / events) and writes actions.ndjson.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

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

/**
 * Append action to {sessionId}.actions.ndjson. Idempotent on actionId.
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

  const record = {
    actionId,
    sessionId,
    nodeId: body.nodeId ?? body.action?.nodeId ?? null,
    type,
    componentType: body.componentType ?? body.action?.componentType ?? null,
    value: body.value ?? body.action?.value,
    path: body.path ?? body.action?.path,
    payload: body.payload ?? body.action?.payload ?? {},
    ts: body.ts ?? new Date().toISOString(),
  };

  const file = actionsPath(dir, sessionId);
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf8");
    if (
      existing.includes(`"actionId":"${actionId}"`) ||
      existing.includes(`"actionId": "${actionId}"`)
    ) {
      return { ok: true, actionId, duplicate: true };
    }
  }

  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
  return { ok: true, actionId, duplicate: false };
}

function applyCors(req, res) {
  const origin = req.headers?.origin;
  // Reflect Origin when present (agent browsers / localhost vs 127.0.0.1);
  // otherwise allow same-origin tools.
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, X-Requested-With",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
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
 */
export function createSessionMiddleware(sessionDir) {
  const dir = resolveSessionDir(sessionDir);

  return async function sessionMiddleware(req, res, next) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (!pathname.startsWith("/api/")) {
      return next();
    }

    applyCors(req, res);

    // Preflight — without this, cross-origin (localhost≠127.0.0.1, agent proxy)
    // POSTs surface as TypeError: Failed to fetch in the browser.
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Content-Length", "0");
      res.end();
      return;
    }

    try {
      if (req.method === "GET" && pathname === "/api/health") {
        return sendJson(res, 200, { ok: true, sessionDir: dir });
      }

      if (req.method === "GET" && pathname === "/api/config") {
        return sendJson(res, 200, {
          ok: true,
          sessionDir: dir,
          iuiSessionDirEnv: process.env.IUI_SESSION_DIR ?? null,
        });
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
  const middleware = createSessionMiddleware(dir);
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
          close: () =>
            new Promise((r, j) => server.close((e) => (e ? j(e) : r()))),
        });
      });
    });
  });
}
