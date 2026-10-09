import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { RenderAction } from "@intelligent-ui/renderer-react";
import reactUmd from "./vendor/react.production.min.js?raw";
import reactDomUmd from "./vendor/react-dom.production.min.js?raw";
import { buildSandboxSrcdoc } from "./bootstrapSrcdoc";
import {
  IUI_SANDBOX_CHANNEL,
  isSandboxEnvelope,
  normalizeSandboxAction,
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
  /** Optional: Host posts action_ack after /api/action succeeds. */
  onActionAck?: (info: {
    actionId: string;
    ok: boolean;
    duplicate?: boolean;
    error?: string;
  }) => void;
}

/**
 * Renders one custom-package component inside an opaque-origin iframe.
 * sandbox="allow-scripts" only — same-origin flag off (cannot touch parent DOM / token).
 *
 * Stability:
 * - iframe lifecycle keyed by moduleSource/exportName/componentType/nodeId (not props)
 * - props updates go through postMessage `props` (no remount)
 * - child→parent messages filtered by requestId (except boot)
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
  // Keep latest node identity for init without rebinding the message listener.
  const identityRef = useRef({ moduleSource, exportName, componentType, nodeId, nodeProps });
  identityRef.current = { moduleSource, exportName, componentType, nodeId, nodeProps };

  const postToChild = (msg: SandboxParentToChild) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    // Opaque sandbox origin is serialized as "null"; '*' is required.
    win.postMessage(msg, "*");
  };

  // Mount-once iframe + message bridge. Re-init only when package entry identity changes.
  useEffect(() => {
    bootedRef.current = false;
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      if (!isSandboxEnvelope(ev.data)) return;
      const data = ev.data as SandboxChildToParent;

      if (data.type === "boot") {
        bootedRef.current = true;
        const id = identityRef.current;
        postToChild({
          channel: IUI_SANDBOX_CHANNEL,
          type: "init",
          requestId,
          reactUmd,
          reactDomUmd,
          moduleSource: id.moduleSource,
          exportName: id.exportName,
          componentType: id.componentType,
          nodeId: id.nodeId,
          props: id.nodeProps ?? {},
        });
        return;
      }

      // Drop stale messages from a previous iframe generation.
      if ("requestId" in data && data.requestId && data.requestId !== requestId) {
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
        const normalized = normalizeSandboxAction(data, {
          nodeId: identityRef.current.nodeId,
          componentType: identityRef.current.componentType,
        });
        if (!normalized) return;
        const action: RenderAction = {
          type: normalized.type,
          nodeId: normalized.nodeId,
          componentType: normalized.componentType,
          payload: normalized.payload,
        };
        if ("value" in normalized) action.value = normalized.value;
        if (normalized.path) action.path = normalized.path;
        onActionRef.current?.(action);
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
      bootedRef.current = false;
    };
    // Identity that requires a fresh module load / node mount.
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
    <div
      className="iui-sandbox-slot"
      data-iui-sandbox={componentType}
      data-iui-node-id={nodeId}
    >
      {error ? (
        <div className="iui-sandbox-error" role="alert">
          Sandbox error: {error}
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title={`iui-sandbox:${componentType}:${nodeId}`}
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

/** Helper for Host to ack an action back into a known sandbox iframe. */
export function postSandboxActionAck(
  iframe: HTMLIFrameElement | null | undefined,
  ack: {
    requestId: string;
    actionId: string;
    ok: boolean;
    duplicate?: boolean;
    error?: string;
  },
): void {
  const win = iframe?.contentWindow;
  if (!win) return;
  const msg: SandboxParentToChild = {
    channel: IUI_SANDBOX_CHANNEL,
    type: "action_ack",
    requestId: ack.requestId,
    actionId: ack.actionId,
    ok: ack.ok,
    duplicate: ack.duplicate,
    error: ack.error,
  };
  win.postMessage(msg, "*");
}
