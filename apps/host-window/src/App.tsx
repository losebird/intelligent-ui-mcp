import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createHostEventPump,
  createIntelligentUiHostSurface,
  type HostSurface,
  type SessionMirror,
} from "@intelligent-ui/host-adapter";
import { HostSurfaceView } from "@intelligent-ui/host-adapter/react";
import type { RenderAction } from "@intelligent-ui/renderer-react";
import {
  fetchConfig,
  postAction,
  resolveClientHostToken,
  type CurrentPointer,
} from "./api";
import { useCustomPackages } from "./useCustomPackages";
import { parseHostMode } from "./hostMode";

interface LogEntry {
  id: string;
  kind: "ui.action" | "ui.error" | "local.action" | "info" | "error";
  ts: string;
  text: string;
}

function makeActionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `a_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function useMirror(surface: HostSurface, sessionId: string | null): SessionMirror | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => surface.subscribe(onStoreChange),
    [surface],
  );
  const getSnapshot = useCallback(
    () => (sessionId ? surface.getMirror(sessionId) : null),
    [surface, sessionId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function App() {
  const mode = useMemo(() => parseHostMode(), []);
  const surface = useMemo(() => createIntelligentUiHostSurface(), []);

  const [sessionDir, setSessionDir] = useState<string>("");
  const [current, setCurrent] = useState<CurrentPointer | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    mode.pinnedSessionId ?? null,
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [transport, setTransport] = useState<string>("sse");
  const [copied, setCopied] = useState(false);
  const { extraRenderers, banner: packageBanner } = useCustomPackages();
  const [densityOverride, setDensityOverride] = useState<
    "full" | "compact" | "plain_prefer" | "session"
  >(() => {
    try {
      const v = localStorage.getItem("iui.host.density");
      if (v === "full" || v === "compact" || v === "plain_prefer" || v === "session") return v;
    } catch {
      /* ignore */
    }
    return "session";
  });

  const logSeq = useRef(0);
  const pushLog = useCallback((entry: Omit<LogEntry, "id">) => {
    logSeq.current += 1;
    const id = `l_${logSeq.current}`;
    setLogs((prev) => [...prev.slice(-99), { ...entry, id }]);
  }, []);

  const mirror = useMirror(surface, activeSessionId);

  useEffect(() => {
    fetchConfig()
      .then((c) => setSessionDir(c.sessionDir))
      .catch((e) => setPollError(String(e)));
  }, []);

  // M1+: host-adapter pump — prefer SSE (/api/stream), fall back to HTTP poll
  useEffect(() => {
    surface.onAction(async (action: RenderAction, sessionId: string) => {
      const actionId = makeActionId();
      try {
        const res = await postAction(sessionId, action, actionId);
        pushLog({
          kind: "local.action",
          ts: new Date().toISOString(),
          text: res.ok
            ? `wrote ${res.actionId}${res.duplicate ? " (dup)" : ""} → ${action.type} @ ${action.nodeId}`
            : `action failed: ${res.error}`,
        });
      } catch (e) {
        pushLog({
          kind: "error",
          ts: new Date().toISOString(),
          text: `action post error: ${String(e)}`,
        });
      }
    });

    const pump = createHostEventPump({
      preferSse: true,
      pollMs: 150,
      syncSnapshot: true,
      wireActions: false,
      token: resolveClientHostToken(),
      sessionId: mode.pinnedSessionId,
      stickyFails: 3,
      backoffMaxMs: 2000,
      sseFallbackAfter: 3,
      onTransport: (t) => setTransport(t),
      onCurrent: (info) => {
        if (info.sessionDir) setSessionDir(info.sessionDir);
        setCurrent(info.current);
        setActiveSessionId(info.activeSessionId);
      },
      onEvent: (line) => {
        const type = String(line.type ?? "");
        if (type === "ui.error") {
          pushLog({
            kind: "ui.error",
            ts: String(line.ts ?? new Date().toISOString()),
            text: `${line.code ?? "ERROR"}: ${line.message ?? JSON.stringify(line)}`,
          });
        } else if (type === "ui.action") {
          pushLog({
            kind: "ui.action",
            ts: String(line.ts ?? new Date().toISOString()),
            text: `${line.actionId ?? ""} ${JSON.stringify(line.action ?? line)}`,
          });
        } else if (type === "ui.delta") {
          const ops = Array.isArray(line.ops) ? line.ops : [];
          const opNames = ops
            .map((o: { op?: string }) => o?.op ?? "?")
            .slice(0, 6)
            .join(",");
          pushLog({
            kind: "info",
            ts: String(line.ts ?? new Date().toISOString()),
            text: `ui.delta rev=${line.revision ?? "?"} partial=${line.partial ? "yes" : "no"} ops=[${opNames}]`,
          });
        }
      },
      onPollOk: () => setPollError(null),
      onPollError: (e) => setPollError(String(e)),
    });

    const stop = pump.start(surface);
    return () => {
      stop();
    };
  }, [surface, pushLog, mode.pinnedSessionId]);

  const statusLabel = useMemo(() => {
    if (pollError) return "poll_error";
    if (!activeSessionId) return "waiting";
    if (mirror?.status === "streaming" || mirror?.partial) return "streaming";
    if (mirror?.status === "error") return "error";
    if (mirror?.status === "done") return "done";
    if (mirror?.status === "idle" || mirror?.status === "mounted") return mirror.status === "mounted" ? "idle" : mirror.status;
    return mirror?.status ?? "unknown";
  }, [pollError, activeSessionId, mirror]);

  const sessionDensity =
    (mirror?.density as "full" | "compact" | "plain_prefer" | undefined) ?? "full";
  const effectiveDensity =
    densityOverride === "session" ? sessionDensity : densityOverride;

  const onDensityChange = (v: typeof densityOverride) => {
    setDensityOverride(v);
    try {
      localStorage.setItem("iui.host.density", v);
    } catch {
      /* ignore */
    }
  };

  const copySessionDir = async () => {
    const text = sessionDir || current?.sessionDir || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      pushLog({
        kind: "info",
        ts: new Date().toISOString(),
        text: `sessionDir: ${text}`,
      });
    }
  };

  const displaySessionId = activeSessionId ?? current?.latestSessionId ?? null;
  const displayRevision = mirror?.revision ?? current?.revision ?? null;
  const isStreaming =
    Boolean(mirror?.partial) ||
    mirror?.status === "streaming" ||
    statusLabel === "streaming";

  const emptyPlaceholder = (
    <div
      className={
        isStreaming ? "host-empty host-empty-streaming" : "host-empty"
      }
    >
      {isStreaming ? (
        <>
          <strong>生成中</strong>
          等待首个控件节点（mode=ops / JSONL chunk）…
        </>
      ) : (
        <>
          <strong>等待 session</strong>
          还没有可渲染的 UI 树。跑一次{" "}
          <code>IUI_SESSION_DIR=… npm run live-demo</code> 或由 MCP{" "}
          <code>ui_propose</code> 写出旁路文件。
        </>
      )}
    </div>
  );


  /* Bubble iframe auto-height: report content size to parent (dsh plugin). */
  useEffect(() => {
    if (!mode.bare && !mode.embed) return;
    const report = () => {
      const h = Math.ceil(
        Math.max(
          document.documentElement?.scrollHeight ?? 0,
          document.body?.scrollHeight ?? 0,
          document.getElementById("root")?.scrollHeight ?? 0,
        ),
      );
      if (!h || h < 40) return;
      try {
        window.parent?.postMessage(
          { source: "intelligent-ui-host", type: "iui.resize", height: h },
          "*",
        );
      } catch {
        /* ignore */
      }
    };
    report();
    const ro = new ResizeObserver(() => report());
    const root = document.getElementById("root") || document.body;
    if (root) ro.observe(root);
    const t = window.setInterval(report, 800);
    window.addEventListener("load", report);
    return () => {
      ro.disconnect();
      window.clearInterval(t);
      window.removeEventListener("load", report);
    };
  }, [mode.bare, mode.embed, activeSessionId, mirror?.revision, mirror?.status]);

  const shellClass = [
    "host-shell",
    mode.embed ? "host-shell-embed" : "",
    mode.bare ? "host-shell-bare" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      {!mode.bare ? (
        <header className={mode.embed ? "host-top host-top-embed" : "host-top"}>
          {!mode.embed ? (
            <div className="host-brand">Intelligent UI Host</div>
          ) : (
            <div className="host-brand host-brand-embed" title="Intelligent UI (embed)">
              IUI
            </div>
          )}
          <div className="host-meta">
            <span title="sessionId">
              <em>session</em> {displaySessionId ?? "—"}
            </span>
            <span title="revision">
              <em>rev</em> {displayRevision ?? "—"}
            </span>
            <span title="status" className={`host-status host-status-${statusLabel}`}>
              <em>status</em> {statusLabel}
            </span>
            <span title="event transport" className="host-transport">
              <em>xfer</em> {transport}
            </span>
            {mirror?.title ? (
              <span title="title">
                <em>title</em> {mirror.title}
              </span>
            ) : null}
            {mode.embed ? (
              <span title="embed mode" className="host-embed-badge">
                <em>view</em> embed
              </span>
            ) : null}
          </div>
          {!mode.embed ? (
            <div className="host-actions">
              <button
                type="button"
                className="host-btn"
                onClick={copySessionDir}
                title={sessionDir}
              >
                {copied ? "已复制路径" : "复制 session 目录"}
              </button>
              <label
                className="host-density"
                title="G10: Host density; harness should also pass density to get_prompt_fragment / ui_open"
              >
                <em>density</em>{" "}
                <select
                  value={densityOverride}
                  onChange={(e) =>
                    onDensityChange(
                      e.target.value as "full" | "compact" | "plain_prefer" | "session",
                    )
                  }
                >
                  <option value="session">session ({sessionDensity})</option>
                  <option value="full">full</option>
                  <option value="compact">compact</option>
                  <option value="plain_prefer">plain_prefer</option>
                </select>
              </label>
            </div>
          ) : null}
        </header>
      ) : null}

      {!mode.embed && !mode.bare && sessionDir ? (
        <div className="host-path" title={sessionDir}>
          IUI_SESSION_DIR: {sessionDir}
        </div>
      ) : null}

      {pollError ? (
        <div className="host-banner-error" role="alert">
          事件通道失败（将自动重试 / 回退轮询）：{pollError}
        </div>
      ) : null}
      {!mode.bare && packageBanner ? (
        <div className="host-banner-warn" title={packageBanner}>
          自定义包降级：{packageBanner}
        </div>
      ) : null}

      {!mode.bare && isStreaming && activeSessionId ? (
        <div className="host-banner-stream" role="status">
          生成中… 流式增量已上屏（rev {displayRevision ?? "—"}）
        </div>
      ) : null}

      <main className="host-main">
        <div className="host-canvas">
          {activeSessionId ? (
            <HostSurfaceView
              surface={surface}
              sessionId={activeSessionId}
              density={effectiveDensity}
              extraRenderers={extraRenderers}
              showStreamingChrome={false}
              showErrorChrome={Boolean(mirror?.lastError)}
              emptyPlaceholder={emptyPlaceholder}
              chromeMode={mode.bare ? "0" : mode.embed ? "embed" : "full"}
            />
          ) : (
            emptyPlaceholder
          )}
        </div>
      </main>

      {!mode.embed ? (
        <footer className="host-bottom">
          <div className="host-bottom-title">
            最近 ui.action / ui.error / 本地 action（M1+: SSE / poll fallback）
          </div>
          <ul className="host-log">
            {logs.length === 0 ? (
              <li className="host-log-empty">暂无日志</li>
            ) : (
              [...logs].reverse().map((l) => (
                <li
                  key={l.id}
                  className={`host-log-item host-log-${l.kind.replace(/\./g, "-")}`}
                >
                  <time>{l.ts}</time>
                  <span>{l.text}</span>
                </li>
              ))
            )}
          </ul>
        </footer>
      ) : (
        <div className="host-embed-foot" aria-hidden="true" />
      )}
    </div>
  );
}
