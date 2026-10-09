/**
 * Interim 事件泵：轮询 apps/host-window 的 session HTTP API。
 * 产品气泡通道（Cursor/Grok IPC/SSE）由宿主自有，见 ProductBubbleChannel 占位。
 */

import type { RenderAction } from "@intelligent-ui/renderer-react";
import type { HostSurface } from "../surface.js";
import type { HostDensity, IntelligentUiHostSurface, UiProtocolEvent } from "../types.js";
import type { HttpPumpOptions } from "./types.js";

function apiUrl(baseUrl: string | undefined, path: string): string {
  const base = (baseUrl ?? "").replace(/\/$/, "");
  if (!base) {
    if (typeof window !== "undefined" && window.location?.origin) {
      return `${window.location.origin}${path}`;
    }
    return path;
  }
  return `${base}${path}`;
}


function authHeaders(token: string | undefined, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const t = (token ?? "").trim();
  if (t) {
    headers.Authorization = `Bearer ${t}`;
    headers["X-IUI-Host-Token"] = t;
  }
  return headers;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isRetryableFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message || String(err);
  return (
    err.name === "TypeError" ||
    /Failed to fetch|NetworkError|fetch failed|ECONNREFUSED|ECONNRESET|network|→ 5\d\d/i.test(
      msg,
    )
  );
}

async function getJson<T>(url: string, attempts = 3, token?: string): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: authHeaders(token, { Accept: "application/json" }),
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

function asProtocolEvent(line: Record<string, unknown>): UiProtocolEvent | null {
  const type = String(line.type ?? "");
  if (
    type !== "ui.open" &&
    type !== "ui.delta" &&
    type !== "ui.replace" &&
    type !== "ui.done" &&
    type !== "ui.error" &&
    type !== "ui.action"
  ) {
    return null;
  }
  return line as unknown as UiProtocolEvent;
}

function makeActionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `a_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function postActionHttp(
  baseUrl: string | undefined,
  sessionId: string,
  action: RenderAction,
  actionId?: string,
  token?: string,
): Promise<void> {
  const body = JSON.stringify({
    actionId: actionId ?? makeActionId(),
    sessionId,
    type: action.type,
    nodeId: action.nodeId,
    componentType: action.componentType,
    value: action.value,
    path: action.path,
    payload: action.payload ?? {},
    ts: new Date().toISOString(),
  });
  await fetch(apiUrl(baseUrl, "/api/action"), {
    method: "POST",
    headers: authHeaders(token, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body,
    cache: "no-store",
  });
}

/**
 * 创建 HTTP 旁路泵（PoC / 对照 Host）。
 * 延迟 ≥ pollMs；不适合产品气泡 TTFC 目标。
 */
export function createHttpEventPump(options: HttpPumpOptions = {}) {
  const pollMs = options.pollMs ?? 150;
  const syncSnapshot = options.syncSnapshot !== false;
  const wireActions = options.wireActions === true;
  const stickyFails = options.stickyFails ?? 3;
  const backoffMaxMs = options.backoffMaxMs ?? 2000;

  return {
    kind: "http_bypass" as const,
    start(surface: IntelligentUiHostSurface): () => void {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let eventsOffset = 0;
      let lastSessionId = "";
      let lastRevision = -1;
      let failCount = 0;
      let delayMs = pollMs;

      if (wireActions && "onAction" in surface) {
        surface.onAction(async (action: RenderAction, sessionId: string) => {
          try {
            await postActionHttp(options.baseUrl, sessionId, action, undefined, options.token);
          } catch {
            /* PoC：失败由宿主日志处理 */
          }
        });
      }

      const tick = async () => {
        try {
          const cur = await getJson<{
            ok: boolean;
            sessionDir?: string;
            current: {
              latestSessionId: string;
              revision: number | null;
              updatedAt?: string;
            } | null;
          }>(apiUrl(options.baseUrl, "/api/current"), 3, options.token);

          failCount = 0;
          delayMs = pollMs;
          options.onPollOk?.();

          const sid =
            options.sessionId ?? cur.current?.latestSessionId ?? "";

          options.onCurrent?.({
            sessionDir: cur.sessionDir,
            current: cur.current,
            activeSessionId: sid || null,
          });

          if (!sid) {
            if (lastSessionId) {
              surface.unmount(lastSessionId);
              lastSessionId = "";
              eventsOffset = 0;
              lastRevision = -1;
            }
            return;
          }

          if (sid !== lastSessionId) {
            if (lastSessionId) surface.unmount(lastSessionId);
            lastSessionId = sid;
            eventsOffset = 0;
            lastRevision = -1;
            surface.mount(sid);
          }

          if (syncSnapshot) {
            try {
              const snap = await getJson<{
                ok: boolean;
                snapshot: {
                  revision: number;
                  tree: unknown;
                  state: Record<string, unknown>;
                  partial?: boolean;
                  title?: string;
                  density?: string;
                  status?: string;
                };
              }>(
                apiUrl(
                  options.baseUrl,
                  `/api/snapshot/${encodeURIComponent(sid)}`,
                ),
                3,
                options.token,
              );
              const s = snap.snapshot;
              if (s && typeof s.revision === "number" && s.revision !== lastRevision) {
                lastRevision = s.revision;
                surface.setSnapshot?.(sid, {
                  revision: s.revision,
                  tree: s.tree as never,
                  state: s.state ?? {},
                  partial: s.partial,
                  title: s.title,
                  density: s.density as HostDensity | undefined,
                  status: s.status,
                });
              }
            } catch {
              /* soft */
            }
          }

          try {
            const ev = await getJson<{
              ok: boolean;
              lines: Array<Record<string, unknown>>;
              nextOffset: number;
            }>(
              apiUrl(
                options.baseUrl,
                `/api/events/${encodeURIComponent(sid)}?since=${eventsOffset}`,
              ),
              3,
              options.token,
            );
            for (const line of ev.lines) {
              options.onEvent?.(line);
              const pe = asProtocolEvent(line);
              if (pe) {
                surface.applyEvent(pe);
                if (
                  (pe.type === "ui.delta" || pe.type === "ui.replace") &&
                  typeof (pe as { revision?: number }).revision === "number"
                ) {
                  lastRevision = Math.max(
                    lastRevision,
                    (pe as { revision: number }).revision,
                  );
                }
              }
            }
            eventsOffset = ev.nextOffset;
          } catch {
            /* soft */
          }
        } catch (e) {
          if (!cancelled) {
            failCount += 1;
            delayMs = Math.min(
              backoffMaxMs,
              pollMs * 2 ** Math.min(failCount, 4),
            );
            if (failCount >= stickyFails) {
              options.onPollError?.(e);
            }
          }
        } finally {
          if (!cancelled) timer = setTimeout(tick, delayMs);
        }
      };

      void tick();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    },

    /** 便捷：同时挂 HostSurface.dispatchAction → HTTP */
    attachActionBridge(surface: HostSurface): void {
      surface.onAction(async (action, sessionId) => {
        await postActionHttp(options.baseUrl, sessionId, action, undefined, options.token);
      });
    },
  };
}
