/**
 * 把 HostSurface 某个 session 画进 React 树（气泡 slot / Webview PoC）。
 * 依赖 peer react + @intelligent-ui/renderer-react。
 */

import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  UiRenderer,
  type ComponentRenderer,
  type RenderAction,
} from "@intelligent-ui/renderer-react";
import type { HostSurface } from "../surface.js";
import type { SessionMirror } from "../types.js";

export interface HostSurfaceViewProps {
  surface: HostSurface;
  sessionId: string;
  /** 覆盖镜像密度 */
  density?: "full" | "compact" | "plain_prefer";
  className?: string;
  extraRenderers?: Record<string, ComponentRenderer>;
  /** 生成中 chrome；默认简单条 */
  showStreamingChrome?: boolean;
  /** 错误条；默认显示 lastError */
  showErrorChrome?: boolean;
  emptyPlaceholder?: ReactNode;
}

function useMirror(surface: HostSurface, sessionId: string): SessionMirror | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => surface.subscribe(onStoreChange),
    [surface],
  );
  const getSnapshot = useCallback(
    () => surface.getMirror(sessionId),
    [surface, sessionId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function HostSurfaceView(props: HostSurfaceViewProps) {
  const {
    surface,
    sessionId,
    density,
    className,
    extraRenderers,
    showStreamingChrome = true,
    showErrorChrome = true,
    emptyPlaceholder,
  } = props;

  const mirror = useMirror(surface, sessionId);

  const onAction = useCallback(
    (action: RenderAction) => {
      surface.dispatchAction(sessionId, action);
    },
    [surface, sessionId],
  );

  const effectiveDensity = density ?? mirror?.density ?? "full";

  const chrome = useMemo(() => {
    if (!mirror) return null;
    return (
      <>
        {showStreamingChrome && mirror.partial && mirror.status !== "done" ? (
          <div
            className="iui-host-streaming"
            style={{
              fontSize: 12,
              opacity: 0.75,
              marginBottom: 8,
              padding: "4px 8px",
              borderRadius: 6,
              background: "rgba(59,130,246,0.12)",
            }}
          >
            生成中… rev={mirror.revision}
            {mirror.title ? ` · ${mirror.title}` : ""}
          </div>
        ) : null}
        {showErrorChrome && mirror.lastError ? (
          <div
            className="iui-host-error"
            style={{
              fontSize: 12,
              marginBottom: 8,
              padding: "6px 8px",
              borderRadius: 6,
              background: "rgba(239,68,68,0.12)",
              color: "#b91c1c",
            }}
          >
            {mirror.lastError.code}: {mirror.lastError.message}
            {mirror.lastError.recoverable ? "（可恢复）" : ""}
          </div>
        ) : null}
      </>
    );
  }, [mirror, showStreamingChrome, showErrorChrome]);

  if (!mirror || mirror.status === "unmounted") {
    return (
      <div className={className} data-iui-host-slot={sessionId}>
        {emptyPlaceholder ?? (
          <div style={{ opacity: 0.6, fontSize: 13 }}>等待 ui_open…</div>
        )}
      </div>
    );
  }

  if (!mirror.tree) {
    return (
      <div className={className} data-iui-host-slot={sessionId} data-iui-rev={mirror.revision}>
        {chrome}
        {emptyPlaceholder ?? (
          <div style={{ opacity: 0.6, fontSize: 13 }}>等待 ui_propose…</div>
        )}
      </div>
    );
  }

  return (
    <div className={className} data-iui-host-slot={sessionId} data-iui-rev={mirror.revision}>
      {chrome}
      <UiRenderer
        tree={mirror.tree}
        state={mirror.state}
        density={effectiveDensity}
        extraRenderers={extraRenderers}
        onAction={onAction}
      />
    </div>
  );
}
