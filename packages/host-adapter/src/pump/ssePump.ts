/**
 * Host SSE event pump: GET /api/stream (text/event-stream).
 * Prefer over HTTP short-poll; Auth via Bearer / X-IUI-Host-Token (fetch stream).
 */
import type { RenderAction } from "@intelligent-ui/renderer-react";
import type { HostSurface } from "../surface.js";
import type {
  HostDensity,
  IntelligentUiHostSurface,
  UiProtocolEvent,
} from "../types.js";
import type { HttpPumpCurrentInfo, SsePumpOptions } from "./types.js";
import { createHttpEventPump } from "./httpPump.js";

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

function authHeaders(
  token: string | undefined,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const t = (token ?? "").trim();
  if (t) {
    headers.Authorization = `Bearer ${t}`;
    headers["X-IUI-Host-Token"] = t;
  }
  return headers;
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

/** Minimal SSE frame parser for fetch ReadableStream. */
function createSseParser(onEvent: (event: string, data: string) => void) {
  let buf = "";
  let eventName = "message";
  let dataLines: string[] = [];

  const flush = () => {
    if (!dataLines.length && eventName === "message") return;
    const data = dataLines.join("\n");
    if (data.length || eventName !== "message") {
      onEvent(eventName, data);
    }
    eventName = "message";
    dataLines = [];
  };

  return {
    push(chunk: string) {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        let line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          flush();
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") eventName = value || "message";
        else if (field === "data") dataLines.push(value);
      }
    },
  };
}

function streamPath(options: SsePumpOptions): string {
  const path = options.ssePath ?? "/api/stream";
  const params = new URLSearchParams();
  if (options.sessionId) params.set("sessionId", options.sessionId);
  if (options.eventsSince != null) params.set("since", String(options.eventsSince));
  if (options.syncSnapshot === false) params.set("snapshot", "0");
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

type CurrentPtr = HttpPumpCurrentInfo["current"];

/**
 * Create an SSE event pump (preferred transport for Host / host-adapter).
 */
export function createSseEventPump(options: SsePumpOptions = {}) {
  const wireActions = options.wireActions === true;
  const syncSnapshot = options.syncSnapshot !== false;
  const stickyFails = options.stickyFails ?? 3;
  const reconnectMaxMs = options.backoffMaxMs ?? 2000;
  const maxReconnectsBeforeError = options.maxReconnectsBeforeError ?? stickyFails;

  return {
    kind: "sse" as const,
    start(surface: IntelligentUiHostSurface): () => void {
      let cancelled = false;
      let abort: AbortController | null = null;
      let reconnectAttempt = 0;
      let failCount = 0;
      let lastSessionId = "";
      let lastRevision = -1;
      let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

      if (wireActions && "onAction" in surface) {
        surface.onAction(async (action: RenderAction, sessionId: string) => {
          try {
            await postActionHttp(
              options.baseUrl,
              sessionId,
              action,
              undefined,
              options.token,
            );
          } catch {
            /* PoC */
          }
        });
      }

      const ensureMounted = (sid: string) => {
        if (!sid) return;
        if (sid !== lastSessionId) {
          if (lastSessionId) surface.unmount(lastSessionId);
          lastSessionId = sid;
          lastRevision = -1;
          surface.mount(sid);
        }
      };

      const clearSession = () => {
        if (lastSessionId) {
          surface.unmount(lastSessionId);
          lastSessionId = "";
          lastRevision = -1;
        }
      };

      const handlePayload = (event: string, raw: string) => {
        if (cancelled) return;
        if (event === "ping" || event === "ready") {
          failCount = 0;
          reconnectAttempt = 0;
          options.onPollOk?.();
          options.onTransport?.("sse");
          return;
        }
        if (event === "error") {
          try {
            const body = JSON.parse(raw) as { message?: string };
            options.onPollError?.(new Error(body.message ?? raw));
          } catch {
            options.onPollError?.(new Error(raw || "SSE error event"));
          }
          return;
        }

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return;
        }

        if (event === "current") {
          failCount = 0;
          reconnectAttempt = 0;
          options.onPollOk?.();
          const current = (data.current ?? null) as CurrentPtr;
          const sid =
            options.sessionId ??
            (current && typeof current.latestSessionId === "string"
              ? current.latestSessionId
              : "") ??
            "";
          options.onCurrent?.({
            sessionDir:
              typeof data.sessionDir === "string" ? data.sessionDir : undefined,
            current,
            activeSessionId: sid || null,
          });
          if (!sid) {
            clearSession();
            return;
          }
          ensureMounted(sid);
          return;
        }

        if (event === "session") {
          const sid =
            typeof data.sessionId === "string" ? data.sessionId : null;
          if (!sid) {
            clearSession();
            options.onCurrent?.({ current: null, activeSessionId: null });
            return;
          }
          ensureMounted(sid);
          options.onCurrent?.({
            current: { latestSessionId: sid, revision: null },
            activeSessionId: sid,
          });
          return;
        }

        if (event === "snapshot" && syncSnapshot) {
          const sid =
            (typeof data.sessionId === "string" && data.sessionId) ||
            lastSessionId;
          const s = data.snapshot as
            | {
                revision: number;
                tree: unknown;
                state: Record<string, unknown>;
                partial?: boolean;
                title?: string;
                density?: string;
                status?: string;
              }
            | undefined;
          if (!sid || !s || typeof s.revision !== "number") return;
          ensureMounted(sid);
          if (s.revision !== lastRevision) {
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
          return;
        }

        if (event === "ui") {
          options.onEvent?.(data);
          const pe = asProtocolEvent(data);
          if (pe) {
            const sid =
              (typeof (pe as { sessionId?: string }).sessionId === "string" &&
                (pe as { sessionId: string }).sessionId) ||
              lastSessionId;
            if (sid) ensureMounted(sid);
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
          return;
        }

        if (event === "action") {
          options.onEvent?.({ ...data, type: data.type ?? "host.action" });
        }
      };

      const connect = async () => {
        if (cancelled) return;
        abort = new AbortController();
        const url = apiUrl(options.baseUrl, streamPath(options));
        try {
          const res = await fetch(url, {
            method: "GET",
            headers: authHeaders(options.token, {
              Accept: "text/event-stream",
              "Cache-Control": "no-cache",
            }),
            cache: "no-store",
            signal: abort.signal,
          });
          if (!res.ok) {
            const err = new Error(`${url} → ${res.status}`);
            (err as Error & { status?: number }).status = res.status;
            throw err;
          }
          if (!res.body) {
            throw new Error("SSE response has no body");
          }
          failCount = 0;
          reconnectAttempt = 0;
          options.onPollOk?.();
          options.onTransport?.("sse");

          const parser = createSseParser((event, data) => {
            handlePayload(event, data);
          });
          const reader = res.body.getReader();
          const decoder = new TextDecoder("utf-8");
          while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.push(decoder.decode(value, { stream: true }));
          }
          if (!cancelled) {
            throw new Error("SSE stream ended");
          }
        } catch (e) {
          if (cancelled || (e instanceof Error && e.name === "AbortError")) {
            return;
          }
          failCount += 1;
          reconnectAttempt += 1;
          const delay = Math.min(
            reconnectMaxMs,
            100 * 2 ** Math.min(reconnectAttempt, 4),
          );
          if (failCount >= maxReconnectsBeforeError) {
            options.onPollError?.(e);
          }
          options.onTransport?.("sse_reconnect");
          if (!cancelled) {
            reconnectTimer = setTimeout(() => {
              void connect();
            }, delay);
          }
        }
      };

      void connect();

      return () => {
        cancelled = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        abort?.abort();
      };
    },

    attachActionBridge(surface: HostSurface): void {
      surface.onAction(async (action, sessionId) => {
        await postActionHttp(
          options.baseUrl,
          sessionId,
          action,
          undefined,
          options.token,
        );
      });
    },
  };
}

/**
 * Prefer SSE (`/api/stream`); on hard failure fall back to HTTP short-poll.
 */
export function createHostEventPump(options: SsePumpOptions = {}) {
  const preferSse = options.preferSse !== false;

  return {
    kind: "auto" as const,
    start(surface: IntelligentUiHostSurface): () => void {
      if (!preferSse) {
        options.onTransport?.("poll");
        return createHttpEventPump(options).start(surface);
      }

      let stopped = false;
      let stopCurrent: (() => void) | null = null;
      let usingPoll = false;
      let sseFailStreak = 0;
      const fallbackAfter = options.sseFallbackAfter ?? 3;

      const startPoll = () => {
        if (stopped || usingPoll) return;
        usingPoll = true;
        options.onTransport?.("poll_fallback");
        stopCurrent?.();
        stopCurrent = createHttpEventPump({
          ...options,
          onPollError: (err) => options.onPollError?.(err),
          onPollOk: () => options.onPollOk?.(),
        }).start(surface);
      };

      options.onTransport?.("sse");
      stopCurrent = createSseEventPump({
        ...options,
        stickyFails: 1,
        maxReconnectsBeforeError: 1,
        onPollError: (err) => {
          const status = (err as Error & { status?: number })?.status;
          // Missing SSE endpoint → poll immediately
          if (status === 404 || status === 501 || status === 405) {
            startPoll();
            return;
          }
          sseFailStreak += 1;
          if (sseFailStreak >= fallbackAfter) {
            startPoll();
            return;
          }
          options.onPollError?.(err);
        },
        onPollOk: () => {
          sseFailStreak = 0;
          options.onPollOk?.();
        },
        onTransport: (t) => {
          if (t === "sse") sseFailStreak = 0;
          options.onTransport?.(t);
        },
      }).start(surface);

      return () => {
        stopped = true;
        stopCurrent?.();
        stopCurrent = null;
      };
    },
  };
}
