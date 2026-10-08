import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  UiRenderer,
  type RenderAction,
  type UiNode,
} from "@intelligent-ui/renderer-react";
import {
  fetchConfig,
  fetchCurrent,
  fetchEvents,
  fetchSnapshot,
  postAction,
  type CurrentPointer,
  type SessionSnapshot,
} from "./api";
import { useCustomPackages } from "./useCustomPackages";

interface LogEntry {
  id: string;
  kind: "ui.action" | "ui.error" | "local.action" | "info" | "error";
  ts: string;
  text: string;
}

const POLL_MS = 150;

function makeActionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `a_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function App() {
  const [sessionDir, setSessionDir] = useState<string>("");
  const [current, setCurrent] = useState<CurrentPointer | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
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

  const eventsOffset = useRef(0);
  const lastKey = useRef<string>("");
  const logSeq = useRef(0);

  const pushLog = useCallback((entry: Omit<LogEntry, "id">) => {
    logSeq.current += 1;
    const id = `l_${logSeq.current}`;
    setLogs((prev) => [...prev.slice(-99), { ...entry, id }]);
  }, []);

  useEffect(() => {
    fetchConfig()
      .then((c) => setSessionDir(c.sessionDir))
      .catch((e) => setPollError(String(e)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const cur = await fetchCurrent();
        if (cancelled) return;
        setSessionDir(cur.sessionDir);
        setCurrent(cur.current);
        setPollError(null);

        const sid = cur.current?.latestSessionId;
        if (sid) {
          const key = `${sid}:${cur.current?.revision ?? "?"}`;
          if (key !== lastKey.current) {
            lastKey.current = key;
            const snap = await fetchSnapshot(sid);
            if (!cancelled) setSnapshot(snap.snapshot);
          }

          const ev = await fetchEvents(sid, eventsOffset.current);
          if (!cancelled && ev.lines.length) {
            for (const line of ev.lines) {
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
              }
            }
            eventsOffset.current = ev.nextOffset;
          }
        } else {
          lastKey.current = "";
          setSnapshot(null);
        }
      } catch (e) {
        if (!cancelled) setPollError(String(e));
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pushLog]);

  // Reset event offset when session changes
  useEffect(() => {
    eventsOffset.current = 0;
  }, [current?.latestSessionId]);

  const onAction = useCallback(
    async (action: RenderAction) => {
      const sid = current?.latestSessionId ?? snapshot?.sessionId;
      if (!sid) {
        pushLog({
          kind: "error",
          ts: new Date().toISOString(),
          text: "No active session for action",
        });
        return;
      }
      const actionId = makeActionId();
      try {
        const res = await postAction(sid, action, actionId);
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
    },
    [current?.latestSessionId, snapshot?.sessionId, pushLog],
  );

  const tree = (snapshot?.tree ?? null) as UiNode | null;
  const state = snapshot?.state ?? {};

  const statusLabel = useMemo(() => {
    if (pollError) return "poll_error";
    if (!current?.latestSessionId) return "waiting";
    return snapshot?.status ?? "unknown";
  }, [pollError, current, snapshot]);

  const sessionDensity = (snapshot?.density as "full" | "compact" | "plain_prefer" | undefined) ?? "full";
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

  return (
    <div className="host-shell">
      <header className="host-top">
        <div className="host-brand">Intelligent UI Host</div>
        <div className="host-meta">
          <span title="sessionId">
            <em>session</em> {current?.latestSessionId ?? "—"}
          </span>
          <span title="revision">
            <em>rev</em> {current?.revision ?? snapshot?.revision ?? "—"}
          </span>
          <span title="status" className={`host-status host-status-${statusLabel}`}>
            <em>status</em> {statusLabel}
          </span>
          {snapshot?.title ? (
            <span title="title">
              <em>title</em> {snapshot.title}
            </span>
          ) : null}
        </div>
        <div className="host-actions">
          <button
            type="button"
            className="host-btn"
            onClick={copySessionDir}
            title={sessionDir}
          >
            {copied ? "已复制路径" : "复制 session 目录"}
          </button>
          <label className="host-density" title="G10: Host density; harness should also pass density to get_prompt_fragment / ui_open">
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
      </header>

      {sessionDir ? (
        <div className="host-path" title={sessionDir}>
          IUI_SESSION_DIR: {sessionDir}
        </div>
      ) : null}

      {pollError ? <div className="host-banner-error">轮询失败：{pollError}</div> : null}
      {packageBanner ? (
        <div className="host-banner-warn" title={packageBanner}>
          自定义包降级：{packageBanner}
        </div>
      ) : null}

      <main className="host-main">
        <UiRenderer
          tree={tree}
          state={state}
          onAction={onAction}
          extraRenderers={extraRenderers}
          density={effectiveDensity}
        />
      </main>

      <footer className="host-bottom">
        <div className="host-bottom-title">最近 ui.action / ui.error / 本地 action</div>
        <ul className="host-log">
          {logs.length === 0 ? (
            <li className="host-log-empty">暂无日志</li>
          ) : (
            [...logs].reverse().map((l) => (
              <li key={l.id} className={`host-log-item host-log-${l.kind.replace(/\./g, "-")}`}>
                <time>{l.ts}</time>
                <span>{l.text}</span>
              </li>
            ))
          )}
        </ul>
      </footer>
    </div>
  );
}
