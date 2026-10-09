/**
 * postMessage protocol between Host parent and custom-package sandbox iframe.
 * Channel versioned so future hosts can evolve without colliding.
 *
 * Action envelope (child → parent) is aligned with Host POST /api/action /
 * RenderAction via normalizeSandboxAction (same fields as renderer-react).
 */
export const IUI_SANDBOX_CHANNEL = "iui.sandbox.v1" as const;

export type SandboxParentToChild =
  | {
      channel: typeof IUI_SANDBOX_CHANNEL;
      type: "init";
      requestId: string;
      reactUmd: string;
      reactDomUmd: string;
      moduleSource: string;
      exportName: string;
      componentType: string;
      nodeId: string;
      props: Record<string, unknown>;
    }
  | {
      channel: typeof IUI_SANDBOX_CHANNEL;
      type: "props";
      requestId: string;
      nodeId: string;
      props: Record<string, unknown>;
    }
  | {
      channel: typeof IUI_SANDBOX_CHANNEL;
      type: "action_ack";
      requestId: string;
      actionId: string;
      ok: boolean;
      duplicate?: boolean;
      error?: string;
    }
  | {
      channel: typeof IUI_SANDBOX_CHANNEL;
      type: "dispose";
      requestId: string;
    };

export type SandboxChildToParent =
  | {
      channel: typeof IUI_SANDBOX_CHANNEL;
      type: "boot";
    }
  | {
      channel: typeof IUI_SANDBOX_CHANNEL;
      type: "ready";
      requestId: string;
    }
  | {
      channel: typeof IUI_SANDBOX_CHANNEL;
      type: "action";
      requestId: string;
      nodeId: string;
      componentType: string;
      /** Optional client-generated id; Host may replace with its own. */
      actionId?: string;
      action: {
        type?: string;
        value?: unknown;
        path?: string;
        payload?: Record<string, unknown>;
      };
    }
  | {
      channel: typeof IUI_SANDBOX_CHANNEL;
      type: "resize";
      requestId: string;
      height: number;
    }
  | {
      channel: typeof IUI_SANDBOX_CHANNEL;
      type: "error";
      requestId: string;
      message: string;
    };

export function isSandboxEnvelope(data: unknown): data is { channel: string; type: string } {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { channel?: unknown }).channel === IUI_SANDBOX_CHANNEL &&
    typeof (data as { type?: unknown }).type === "string"
  );
}

/**
 * Normalize iframe action payload into Host RenderAction fields.
 * Ignores stale frames when requestId does not match (caller checks).
 */
export function normalizeSandboxAction(
  data: Extract<SandboxChildToParent, { type: "action" }>,
  defaults: { nodeId: string; componentType: string },
): {
  type: string;
  nodeId: string;
  componentType: string;
  value?: unknown;
  path?: string;
  payload: Record<string, unknown>;
  actionId?: string;
} | null {
  const a = data.action && typeof data.action === "object" ? data.action : {};
  // Components may pass a full RenderAction as `a` (with nested type/nodeId).
  const nested =
    a && typeof (a as { action?: unknown }).action === "object"
      ? ((a as { action: Record<string, unknown> }).action as Record<string, unknown>)
      : null;
  const src = (nested ?? a) as Record<string, unknown>;
  const typeRaw = src.type;
  const type =
    typeof typeRaw === "string" && typeRaw.trim() ? typeRaw.trim() : "change";
  const nodeId =
    (typeof data.nodeId === "string" && data.nodeId) ||
    (typeof src.nodeId === "string" && src.nodeId) ||
    defaults.nodeId;
  const componentType =
    (typeof data.componentType === "string" && data.componentType) ||
    (typeof src.componentType === "string" && src.componentType) ||
    defaults.componentType;
  const payload =
    src.payload && typeof src.payload === "object" && !Array.isArray(src.payload)
      ? (src.payload as Record<string, unknown>)
      : {};
  const out: {
    type: string;
    nodeId: string;
    componentType: string;
    value?: unknown;
    path?: string;
    payload: Record<string, unknown>;
    actionId?: string;
  } = {
    type,
    nodeId,
    componentType,
    payload,
  };
  if ("value" in src) out.value = src.value;
  if (typeof src.path === "string") out.path = src.path;
  if (typeof data.actionId === "string" && data.actionId) out.actionId = data.actionId;
  else if (typeof src.actionId === "string" && src.actionId) out.actionId = src.actionId;
  return out;
}
