/**
 * postMessage protocol between Host parent and custom-package sandbox iframe.
 * Channel versioned so future hosts can evolve without colliding.
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
      action: {
        type?: string;
        value?: unknown;
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
