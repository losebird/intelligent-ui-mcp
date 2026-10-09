import type { UiNode } from "../protocol.js";
import type { UiOp } from "./ops.js";

function collectIds(tree: UiNode | null | undefined, into: Set<string>): void {
  if (!tree) return;
  if (typeof tree.id === "string" && tree.id) into.add(tree.id);
  for (const c of tree.children ?? []) collectIds(c, into);
}

function idsFromOps(ops: UiOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of ops) {
    if (!op) continue;
    if (op.op === "replace_tree") {
      collectIds((op.tree as UiNode) ?? (op.node as UiNode) ?? null, ids);
    } else if (op.op === "upsert" || op.op === "append_child") {
      collectIds(op.node ?? null, ids);
    } else if (op.op === "replace_children" && Array.isArray(op.children)) {
      for (const c of op.children) collectIds(c, ids);
    }
  }
  return ids;
}

/**
 * Warn when a write is likely to remount interactive Host/iframe slots.
 * First-principles: keep node.id stable; prefer patch_props / statePatch (data)
 * over replace_tree / full ui_propose (render).
 */
export function remountRiskWarnings(input: {
  prevTree: UiNode | null | undefined;
  nextTree?: UiNode | null;
  ops?: UiOp[];
  via: "propose_tree" | "propose_ops" | "patch";
}): string[] {
  const warnings: string[] = [];
  const prev = new Set<string>();
  collectIds(input.prevTree ?? null, prev);
  if (prev.size === 0) return warnings;

  const hasReplace =
    input.via === "propose_tree" ||
    Boolean(input.ops?.some((o) => o?.op === "replace_tree"));

  if (input.via === "propose_tree" || hasReplace) {
    warnings.push(
      "REMOUNT_RISK: full tree replace — Host may remount interactive slots (iframe/local state). Prefer ui_patch + patch_props/statePatch and keep node.id stable (see docs/DATA-VS-RENDER.md).",
    );
  }

  let nextIds = new Set<string>();
  if (input.nextTree) collectIds(input.nextTree, nextIds);
  else if (input.ops?.length) nextIds = idsFromOps(input.ops);

  if (nextIds.size > 0) {
    let overlap = 0;
    for (const id of nextIds) if (prev.has(id)) overlap += 1;
    const ratio = overlap / prev.size;
    if (ratio < 0.5) {
      warnings.push(
        `REMOUNT_RISK: only ${overlap}/${prev.size} prior node.id preserved — interactive components will remount. Reuse ids; use data tools (ui_patch) not render rebuild.`,
      );
    }
  }

  return warnings;
}
