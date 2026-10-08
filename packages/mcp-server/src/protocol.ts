export const PROTOCOL_VERSION = "0.1";

export interface UiNode {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  children?: UiNode[];
  bind?: string;
  /** Safe expr map: propName → expression over session.state (G6 ⑤). */
  expr?: Record<string, string>;
  actions?: Record<
    string,
    { actionType: string; payload?: Record<string, unknown> }
  >;
  key?: string;
  meta?: Record<string, unknown>;
}

export type SessionStatus =
  | "open"
  | "streaming"
  | "idle"
  | "action_pending"
  | "closing"
  | "closed"
  | "error";

export interface SessionRecord {
  sessionId: string;
  status: SessionStatus;
  revision: number;
  tree: UiNode | null;
  state: Record<string, unknown>;
  partial: boolean;
  title: string;
  density: "full" | "compact" | "plain_prefer";
  preferPlainText: boolean;
  createdAt: string;
  updatedAt: string;
  lastActionId: string | null;
  lastError: { code: string; message: string } | null;
  meta?: Record<string, unknown>;
  /** Last user query associated with this session (for policy_check). */
  lastQuery?: string;
  /** Session-level derived state: key → safe expr over state (G6 ⑤). */
  reducers?: Record<string, string>;
}

export type UiEvent =
  | {
      protocolVersion: string;
      type: "ui.open";
      sessionId: string;
      ts: string;
      title?: string;
      state: Record<string, unknown>;
    }
  | {
      protocolVersion: string;
      type: "ui.replace";
      sessionId: string;
      ts: string;
      revision: number;
      partial: boolean;
      tree: UiNode | null;
    }
  | {
      protocolVersion: string;
      type: "ui.delta";
      sessionId: string;
      ts: string;
      revision: number;
      partial: boolean;
      ops: unknown[];
    }
  | {
      protocolVersion: string;
      type: "ui.done";
      sessionId: string;
      ts: string;
      revision: number;
      reason?: string;
    }
  | {
      protocolVersion: string;
      type: "ui.error";
      sessionId: string;
      ts: string;
      code: string;
      message: string;
      recoverable: boolean;
    }
  | {
      protocolVersion: string;
      type: "ui.action";
      sessionId: string;
      ts: string;
      actionId: string;
      action: Record<string, unknown>;
    };

export function okResult<T extends Record<string, unknown>>(data: T) {
  return { ok: true as const, protocolVersion: PROTOCOL_VERSION, ...data };
}

export function errResult(code: string, message: string, details?: unknown) {
  return {
    ok: false as const,
    protocolVersion: PROTOCOL_VERSION,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function textContent(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
  };
}
