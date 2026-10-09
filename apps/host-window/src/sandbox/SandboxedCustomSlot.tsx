import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { RenderAction } from "@intelligent-ui/renderer-react";
import reactUmd from "./vendor/react.production.min.js?raw";
import reactDomUmd from "./vendor/react-dom.production.min.js?raw";
import { buildSandboxSrcdoc } from "./bootstrapSrcdoc";
import {
  IUI_SANDBOX_CHANNEL,
  isSandboxEnvelope,
  type SandboxChildToParent,
  type SandboxParentToChild,
} from "./protocol";

export interface SandboxedCustomSlotProps {
  moduleSource: string;
  exportName: string;
  componentType: string;
  nodeId: string;
  props: Record<string, unknown>;
  onAction?: (action: RenderAction) => void;
}

/**
 * Renders one custom-package component inside an opaque-origin iframe.
 * sandbox="allow-scripts" only — same-origin flag off (cannot touch parent DOM / token).
 */
export function SandboxedCustomSlot(props: SandboxedCustomSlotProps) {
  const {
    moduleSource,
    exportName,
    componentType,
    nodeId,
    props: nodeProps,
    onAction,
  } = props;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const requestId = useId();
  const srcdoc = useMemo(() => buildSandboxSrcdoc(), []);
  const [height, setHeight] = useState(64);
  const [error, setError] = useState<string | null>(null);
  const bootedRef = useRef(false);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const postToChild = (msg: SandboxParentToChild) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    // Opaque sandbox origin is serialized as "null"; '*' is required.
    win.postMessage(msg, "*");
  };

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      if (!isSandboxEnvelope(ev.data)) return;
      const data = ev.data as SandboxChildToParent;
      if (data.type === "boot") {
        bootedRef.current = true;
        postToChild({
          channel: IUI_SANDBOX_CHANNEL,
          type: "init",
          requestId,
          reactUmd,
          reactDomUmd,
          moduleSource,
          exportName,
          componentType,
          nodeId,
          props: nodeProps ?? {},
        });
        return;
      }
      if (data.type === "ready") {
        setError(null);
        return;
      }
      if (data.type === "error") {
        setError(data.message);
        return;
      }
      if (data.type === "resize" && typeof data.height === "number") {
        setHeight(Math.min(Math.max(data.height, 32), 4000));
        return;
      }
      if (data.type === "action") {
        const a = data.action ?? {};
        onActionRef.current?.({
          type: a.type ?? "change",
          nodeId: data.nodeId || nodeId,
          componentType: data.componentType || componentType,
          value: a.value,
          payload: a.payload ?? {},
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (bootedRef.current) {
        postToChild({
          channel: IUI_SANDBOX_CHANNEL,
          type: "dispose",
          requestId,
        });
      }
    };
    // Intentionally mount-once for iframe lifecycle; props updates via separate effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, moduleSource, exportName, componentType, nodeId]);

  const propsJson = useMemo(() => JSON.stringify(nodeProps ?? {}), [nodeProps]);

  useEffect(() => {
    if (!bootedRef.current) return;
    postToChild({
      channel: IUI_SANDBOX_CHANNEL,
      type: "props",
      requestId,
      nodeId,
      props: JSON.parse(propsJson) as Record<string, unknown>,
    });
  }, [propsJson, nodeId, requestId]);

  return (
    <div className="iui-sandbox-slot" data-iui-sandbox={componentType}>
      {error ? (
        <div className="iui-sandbox-error" role="alert">
          Sandbox error: {error}
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title={`iui-sandbox:${componentType}`}
        srcDoc={srcdoc}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        style={{
          width: "100%",
          height,
          border: "0",
          display: "block",
          background: "transparent",
        }}
      />
    </div>
  );
}
