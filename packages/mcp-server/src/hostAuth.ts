/**
 * Shared Host API token helpers (mirrors apps/host-window/server/hostAuth.mjs).
 * MCP and Host must resolve the same secret via IUI_HOST_TOKEN or the token file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export function defaultHostTokenPath(): string {
  return (
    process.env.IUI_HOST_TOKEN_FILE?.trim() ||
    path.join(os.homedir(), ".intelligent-ui-mcp", "host-token")
  );
}

function readTokenFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    return raw.length ? raw : null;
  } catch {
    return null;
  }
}

function writeTokenFile(filePath: string, token: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* best-effort */
  }
}

export function resolveHostToken(opts: { ensure?: boolean } = {}): string | null {
  const ensure = opts.ensure === true;
  const fromEnv = process.env.IUI_HOST_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const filePath = defaultHostTokenPath();
  const fromFile = readTokenFile(filePath);
  if (fromFile) return fromFile;

  if (!ensure) return null;

  const token = randomBytes(32).toString("hex");
  writeTokenFile(filePath, token);
  process.env.IUI_HOST_TOKEN = token;
  return token;
}

/** Ensure token exists; sync to process.env.IUI_HOST_TOKEN. */
export function ensureHostToken(): string {
  const token = resolveHostToken({ ensure: true });
  if (!token) {
    throw new Error("failed to ensure IUI_HOST_TOKEN");
  }
  if (!process.env.IUI_HOST_TOKEN?.trim()) {
    process.env.IUI_HOST_TOKEN = token;
  }
  return token;
}

export function hostAuthHeaders(token?: string): Record<string, string> {
  const t = (token ?? resolveHostToken({ ensure: false }) ?? "").trim();
  if (!t) return {};
  return {
    Authorization: `Bearer ${t}`,
    "X-IUI-Host-Token": t,
  };
}
