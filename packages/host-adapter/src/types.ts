/**
 * 宿主适配器契约类型 — 对齐 docs/HOST-RENDERER-ADAPTER.md §4。
 * 与 @intelligent-ui/renderer-react 的 UiNode / RenderAction 同形。
 */

export type { UiNode, RenderAction, ComponentRenderer } from "@intelligent-ui/renderer-react";

export type HostDensity = "full" | "compact" | "plain_prefer";

export interface MountOptions {
  title?: string;
  density?: HostDensity;
}

/** 协议事件（已 parse 的 ui.* 对象） */
export type UiProtocolEvent =
  | {
      protocolVersion?: string;
      type: "ui.open";
      sessionId: string;
      ts?: string;
      title?: string;
      state?: Record<string, unknown>;
    }
  | {
      protocolVersion?: string;
      type: "ui.replace";
      sessionId: string;
      ts?: string;
      revision: number;
      partial?: boolean;
      tree: import("@intelligent-ui/renderer-react").UiNode | null;
      state?: Record<string, unknown>;
    }
  | {
      protocolVersion?: string;
      type: "ui.delta";
      sessionId: string;
      ts?: string;
      revision: number;
      partial?: boolean;
      ops: unknown[];
      /** 可选：部分泵会附带最新 state */
      state?: Record<string, unknown>;
    }
  | {
      protocolVersion?: string;
      type: "ui.done";
      sessionId: string;
      ts?: string;
      revision: number;
      reason?: string;
    }
  | {
      protocolVersion?: string;
      type: "ui.error";
      sessionId: string;
      ts?: string;
      code: string;
      message: string;
      recoverable: boolean;
    }
  | {
      protocolVersion?: string;
      type: "ui.action";
      sessionId: string;
      ts?: string;
      actionId: string;
      action: Record<string, unknown>;
    };

export interface SessionSnapshotInput {
  revision: number;
  tree: import("@intelligent-ui/renderer-react").UiNode | null;
  state: Record<string, unknown>;
  partial?: boolean;
  title?: string;
  density?: HostDensity;
  status?: string;
}

export type SessionMirrorStatus =
  | "mounted"
  | "streaming"
  | "idle"
  | "done"
  | "error"
  | "unmounted";

/** 本地镜像（MCP 仍为真相源；重连应用 setSnapshot） */
export interface SessionMirror {
  sessionId: string;
  title: string;
  density: HostDensity;
  revision: number;
  tree: import("@intelligent-ui/renderer-react").UiNode | null;
  state: Record<string, unknown>;
  partial: boolean;
  status: SessionMirrorStatus;
  lastError: { code: string; message: string; recoverable: boolean } | null;
  lastActionId: string | null;
}

export type ActionHandler = (
  action: import("@intelligent-ui/renderer-react").RenderAction,
  sessionId: string,
) => void;

/**
 * 最小宿主 API（选项 A）。
 * 产品气泡通道由宿主自有；本仓 interim 泵走 Host HTTP / NDJSON。
 */
export interface IntelligentUiHostSurface {
  /** open：为 session 创建绘制面（气泡内 slot） */
  mount(sessionId: string, opts?: MountOptions): void;

  /** stream：应用协议事件（已 parse 的 ui.* 对象） */
  applyEvent(event: UiProtocolEvent): void;

  /** 可选：直接塞最新 snapshot（调试 / 重连） */
  setSnapshot?(sessionId: string, snapshot: SessionSnapshotInput): void;

  /** action：用户操作出口；宿主负责送到 MCP */
  onAction(handler: ActionHandler): void;

  /** 卸下（气泡折叠 / ui_close） */
  unmount(sessionId: string): void;
}

/** 事件泵：把旁路/产品通道推到 surface.applyEvent */
export interface HostEventPump {
  /** 开始订阅；返回 stop */
  start(surface: IntelligentUiHostSurface): () => void;
}

/**
 * 产品内气泡通道（Cursor / Grok Bot IPC/SSE）— **宿主自有，本包仅占位类型**。
 * M0 不实现；M1+ 由宿主注入等价于 HostEventPump 的实现。
 */
export interface ProductBubbleChannel extends HostEventPump {
  readonly kind: "product_bubble";
}
