/**
 * Shared Host API auth + CORS helpers.
 *
 * Secret resolution order:
 *   1) process.env.IUI_HOST_TOKEN (non-empty)
 *   2) file at IUI_HOST_TOKEN_FILE or ~/.intelligent-ui-mcp/host-token
 *   3) if ensure=true: generate, write file mode 0600, return it
 *
 * MCP server and Host must share the same secret (same env or same file).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

export const HOST_TOKEN_HEADER = "x-iui-host-token";
export const HOST_TOKEN_QUERY = "token";

export function defaultHostTokenPath() {
  return (
    process.env.IUI_HOST_TOKEN_FILE?.trim() ||
    path.join(os.homedir(), ".intelligent-ui-mcp", "host-token")
  );
}

function readTokenFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    return raw.length ? raw : null;
  } catch {
    return null;
  }
}

function writeTokenFile(filePath, token) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* best-effort on platforms without chmod */
  }
}

/**
 * @param {{ ensure?: boolean }} [opts]
 * @returns {string | null} token, or null when missing and ensure=false
 */
export function resolveHostToken(opts = {}) {
  const ensure = opts.ensure === true;
  const fromEnv = process.env.IUI_HOST_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const filePath = defaultHostTokenPath();
  const fromFile = readTokenFile(filePath);
  if (fromFile) return fromFile;

  if (!ensure) return null;

  const token = randomBytes(32).toString("hex");
  writeTokenFile(filePath, token);
  // Keep process.env in sync so Vite client inject and child tooling see it.
  process.env.IUI_HOST_TOKEN = token;
  return token;
}

/** Ensure a token exists and is exported on process.env.IUI_HOST_TOKEN. */
export function ensureHostToken() {
  const token = resolveHostToken({ ensure: true });
  if (token && !process.env.IUI_HOST_TOKEN?.trim()) {
    process.env.IUI_HOST_TOKEN = token;
  }
  return token;
}

export function tokensEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!a.length || !b.length) return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Extract bearer / header / query token from an IncomingMessage-like req + URL.
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 */
export function extractRequestToken(req, url) {
  const headers = req.headers ?? {};
  const auth = headers.authorization ?? headers.Authorization;
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return m[1].trim();
  }
  const hdr = headers[HOST_TOKEN_HEADER] ?? headers["X-IUI-Host-Token"];
  if (typeof hdr === "string" && hdr.trim()) return hdr.trim();
  if (Array.isArray(hdr) && hdr[0]) return String(hdr[0]).trim();

  const q = url?.searchParams?.get(HOST_TOKEN_QUERY);
  if (typeof q === "string" && q.trim()) return q.trim();
  return null;
}

/**
 * Loopback-only Origin allowlist for CORS.
 * Same-origin / non-browser (no Origin) is fine.
 * Optional extra origins via IUI_CORS_ORIGINS (comma-separated).
 */
export function isAllowedCorsOrigin(origin) {
  if (!origin || typeof origin !== "string") return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  if (host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1") {
    return true;
  }
  const extra = (process.env.IUI_CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

/**
 * Apply CORS headers. Never reflects arbitrary Origin.
 * @returns {boolean} false if Origin present but not allowed (caller may 403)
 */
export function applyStrictCors(req, res) {
  const origin = req.headers?.origin;
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, X-Requested-With, X-IUI-Host-Token",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");

  if (!origin) {
    // Non-browser / same-origin tools: no ACAO needed.
    return true;
  }
  if (isAllowedCorsOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    return true;
  }
  return false;
}

/** Paths that stay public (probe / preflight only). */
export function isPublicApiPath(pathname, method) {
  if (method === "OPTIONS") return true;
  if (method === "GET" && pathname === "/api/health") return true;
  return false;
}
