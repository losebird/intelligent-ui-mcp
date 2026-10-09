import type { RenderAction } from "@intelligent-ui/renderer-react";

export interface CurrentPointer {
  latestSessionId: string;
  revision: number | null;
  updatedAt?: string;
  sessionDir?: string;
  eventsPath?: string;
  actionsPath?: string;
  snapshotPath?: string;
}

export interface SessionSnapshot {
  protocolVersion?: string;
  sessionId: string;
  status: string;
  revision: number;
  tree: unknown;
  state: Record<string, unknown>;
  partial?: boolean;
  title?: string;
  density?: string;
  lastError?: { code: string; message: string } | null;
  updatedAt?: string;
}

/** Prefer same-document origin so relative /api never wanders to a wrong host. */
function apiUrl(path: string): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

/** Shared Host API token (Vite injects import.meta.env.IUI_HOST_TOKEN). */
export function resolveClientHostToken(): string {
  const fromEnv =
    (typeof import.meta !== "undefined" &&
      (import.meta as ImportMeta & { env?: Record<string, string> }).env
        ?.IUI_HOST_TOKEN) ||
    "";
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("token");
    if (q?.trim()) return q.trim();
  }
  return "";
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const token = resolveClientHostToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers["X-IUI-Host-Token"] = token;
  }
  return headers;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isRetryableFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message || String(err);
  // Vite HMR / brief restart, agent proxy blip, connection reset
  return (
    err.name === "TypeError" ||
    /Failed to fetch|NetworkError|fetch failed|ECONNREFUSED|ECONNRESET|network|→ 5\d\d/i.test(
      msg,
    )
  );
}

/**
 * GET JSON with short retries — Vite HMR / brief proxy blips often surface as
 * TypeError: Failed to fetch even though /api/* is fine a moment later.
 */
async function getJson<T>(url: string, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(apiUrl(url), {
        cache: "no-store",
        headers: authHeaders({ Accept: "application/json" }),
      });
      if (!res.ok) {
        const err = new Error(`${url} → ${res.status}`);
        if (res.status === 401) throw err;
        if (res.status >= 500 && i < attempts - 1) {
          lastErr = err;
          await sleep(80 * (i + 1));
          continue;
        }
        throw err;
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1 && isRetryableFetchError(err)) {
        await sleep(80 * (i + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchConfig() {
  return getJson<{ ok: boolean; sessionDir: string }>("/api/config");
}

export async function fetchCurrent() {
  return getJson<{ ok: boolean; sessionDir: string; current: CurrentPointer | null }>(
    "/api/current",
  );
}

export async function fetchSnapshot(sessionId: string) {
  return getJson<{ ok: boolean; snapshot: SessionSnapshot }>(
    `/api/snapshot/${encodeURIComponent(sessionId)}`,
  );
}

export async function fetchEvents(sessionId: string, since: number) {
  return getJson<{
    ok: boolean;
    lines: Array<Record<string, unknown>>;
    nextOffset: number;
  }>(`/api/events/${encodeURIComponent(sessionId)}?since=${since}`);
}

export async function postAction(
  sessionId: string,
  action: RenderAction,
  actionId?: string,
) {
  const body = JSON.stringify({
    actionId,
    sessionId,
    type: action.type,
    nodeId: action.nodeId,
    componentType: action.componentType,
    value: action.value,
    path: action.path,
    payload: action.payload ?? {},
    ts: new Date().toISOString(),
  });

  const url = apiUrl("/api/action");
  const attempts = 3;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
          Accept: "application/json",
        }),
        body,
        cache: "no-store",
      });
      const text = await res.text();
      let parsed: {
        ok: boolean;
        actionId?: string;
        duplicate?: boolean;
        error?: string;
        message?: string;
      };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        throw new Error(
          `/api/action → ${res.status} non-JSON: ${text.slice(0, 160)}`,
        );
      }
      if (!res.ok && !parsed.ok) {
        throw new Error(
          parsed.error ?? parsed.message ?? `/api/action → ${res.status}`,
        );
      }
      return parsed;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1 && isRetryableFetchError(err)) {
        await sleep(120 * (i + 1));
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface HostPackageRecord {
  id: string;
  version: string;
  title: string;
  enabled: boolean;
  renderStatus: string;
  rootPath: string;
  entryAbsPath: string;
  entryRelative: string;
  exports: Record<string, string>;
  components: string[];
  hash?: string;
}

export async function fetchPackages() {
  return getJson<{
    ok: boolean;
    packages: HostPackageRecord[];
    updatedAt?: string | null;
    registryPath?: string;
  }>("/api/packages");
}

export async function fetchPackageEntry(packageId: string) {
  return getJson<{
    ok: boolean;
    packageId?: string;
    entryAbsPath?: string;
    hash?: string | null;
    bytes?: number;
    source?: string;
    error?: string;
  }>(`/api/package-entry/${encodeURIComponent(packageId)}`);
}
