/**
 * Canonical RenderAction shape used by Host POST /api/action, sandbox iframe
 * postMessage, and MCP ui_report_action / actions.ndjson drain.
 *
 * Accepts both flat Host records and nested `{ action: {...} }` envelopes.
 */
import type { RenderAction } from "./types.js";

export type LooseAction =
  | RenderAction
  | {
      type?: unknown;
      nodeId?: unknown;
      componentType?: unknown;
      value?: unknown;
      path?: unknown;
      payload?: unknown;
      action?: LooseAction;
      actionId?: unknown;
    }
  | null
  | undefined;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Pull a usable action object from flat or nested input. */
export function coerceActionInput(input: LooseAction): Record<string, unknown> | null {
  const root = asRecord(input);
  if (!root) return null;
  const nested = asRecord(root.action);
  if (nested && typeof (nested.type ?? root.type) !== "undefined") {
    // Prefer nested fields, fall back to flat siblings (Host sometimes duplicates).
    return {
      type: nested.type ?? root.type,
      nodeId: nested.nodeId ?? root.nodeId,
      componentType: nested.componentType ?? root.componentType,
      value: "value" in nested ? nested.value : root.value,
      path: nested.path ?? root.path,
      payload: nested.payload ?? root.payload,
      actionId: root.actionId ?? nested.actionId,
    };
  }
  return root;
}

/**
 * Normalize to RenderAction. Returns null if `type` missing/invalid.
 * Does not invent nodeId — caller may fill defaults.
 */
export function normalizeRenderAction(
  input: LooseAction,
  defaults?: { nodeId?: string; componentType?: string },
): RenderAction | null {
  const raw = coerceActionInput(input);
  if (!raw) return null;
  const type = raw.type;
  if (typeof type !== "string" || !type.trim()) return null;

  const payload = asRecord(raw.payload) ?? {};
  const nodeId =
    typeof raw.nodeId === "string" && raw.nodeId
      ? raw.nodeId
      : defaults?.nodeId ?? "";
  const componentType =
    typeof raw.componentType === "string" && raw.componentType
      ? raw.componentType
      : defaults?.componentType ?? "";

  const out: RenderAction = {
    type: type.trim(),
    nodeId,
    componentType,
    payload,
  };
  if ("value" in raw) out.value = raw.value;
  if (typeof raw.path === "string") out.path = raw.path;
  return out;
}

/** Flat body for POST /api/action and actions.ndjson lines. */
export function toHostActionRecord(
  action: RenderAction,
  opts: { actionId: string; sessionId: string; ts?: string; source?: string },
): Record<string, unknown> {
  return {
    actionId: opts.actionId,
    sessionId: opts.sessionId,
    type: action.type,
    nodeId: action.nodeId || null,
    componentType: action.componentType || null,
    value: action.value,
    path: action.path,
    payload: action.payload ?? {},
    ts: opts.ts ?? new Date().toISOString(),
    source: opts.source ?? "host",
  };
}
