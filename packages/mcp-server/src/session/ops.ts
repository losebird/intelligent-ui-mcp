import type { UiNode } from "../protocol.js";

export type UiOp = {
  op: string;
  nodeId?: string;
  parentId?: string;
  index?: number;
  node?: UiNode;
  props?: Record<string, unknown>;
  path?: string | null;
  fromIndex?: number;
  toIndex?: number;
  children?: UiNode[];
  tree?: UiNode | null;
};

export type ApplyOpsResult =
  | { ok: true; tree: UiNode | null }
  | { ok: false; code: string; message: string };

function deepClone<T>(v: T): T {
  return structuredClone(v);
}

function findNode(
  tree: UiNode | null,
  id: string,
): { node: UiNode; parent: UiNode | null; index: number } | null {
  if (!tree) return null;
  if (tree.id === id) return { node: tree, parent: null, index: -1 };
  function walk(
    n: UiNode,
    parent: UiNode | null,
  ): { node: UiNode; parent: UiNode | null; index: number } | null {
    const kids = n.children ?? [];
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].id === id) return { node: kids[i], parent: n, index: i };
      const found = walk(kids[i], n);
      if (found) return found;
    }
    return null;
  }
  return walk(tree, null);
}

function ensureChildren(n: UiNode): UiNode[] {
  if (!n.children) n.children = [];
  return n.children;
}

function isUiNode(v: unknown): v is UiNode {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as UiNode).id === "string" &&
    typeof (v as UiNode).type === "string"
  );
}

/** Apply ops atomically on a clone. Returns new tree or error (original untouched). */
export function applyOps(
  tree: UiNode | null,
  ops: UiOp[],
): ApplyOpsResult {
  let next: UiNode | null = tree ? deepClone(tree) : null;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!op || typeof op.op !== "string") {
      return {
        ok: false,
        code: "INVALID_OP",
        message: `ops[${i}]: missing op`,
      };
    }

    switch (op.op) {
      case "replace_tree": {
        if (op.tree === null || op.tree === undefined) {
          if (op.node !== undefined) {
            if (op.node === null) {
              next = null;
              break;
            }
            if (!isUiNode(op.node)) {
              return {
                ok: false,
                code: "INVALID_OP",
                message: `ops[${i}] replace_tree: invalid node`,
              };
            }
            next = deepClone(op.node);
            break;
          }
          next = null;
          break;
        }
        if (!isUiNode(op.tree)) {
          return {
            ok: false,
            code: "INVALID_OP",
            message: `ops[${i}] replace_tree: invalid tree`,
          };
        }
        next = deepClone(op.tree);
        break;
      }

      case "upsert": {
        if (!isUiNode(op.node)) {
          return {
            ok: false,
            code: "INVALID_OP",
            message: `ops[${i}] upsert: node required`,
          };
        }
        const node = deepClone(op.node);
        const nodeId = op.nodeId ?? node.id;
        node.id = nodeId;

        if (!next) {
          // First node becomes root if no tree yet
          if (op.parentId) {
            return {
              ok: false,
              code: "PARENT_NOT_FOUND",
              message: `ops[${i}] upsert: parent ${op.parentId} but tree empty`,
            };
          }
          next = node;
          break;
        }

        const existing = findNode(next, nodeId);
        if (existing) {
          // Replace in place (keep position)
          if (existing.parent === null) {
            next = node;
          } else {
            const kids = ensureChildren(existing.parent);
            kids[existing.index] = node;
          }
          break;
        }

        const parentId = op.parentId ?? "root";
        const parentLoc = findNode(next, parentId);
        if (!parentLoc) {
          return {
            ok: false,
            code: "PARENT_NOT_FOUND",
            message: `ops[${i}] upsert: parent ${parentId} not found`,
          };
        }
        const kids = ensureChildren(parentLoc.node);
        const idx =
          typeof op.index === "number" && op.index >= 0 && op.index <= kids.length
            ? op.index
            : kids.length;
        kids.splice(idx, 0, node);
        break;
      }

      case "patch_props": {
        if (!op.nodeId) {
          return {
            ok: false,
            code: "INVALID_OP",
            message: `ops[${i}] patch_props: nodeId required`,
          };
        }
        if (!op.props || typeof op.props !== "object") {
          return {
            ok: false,
            code: "INVALID_OP",
            message: `ops[${i}] patch_props: props required`,
          };
        }
        const loc = findNode(next, op.nodeId);
        if (!loc) {
          return {
            ok: false,
            code: "NODE_NOT_FOUND",
            message: `ops[${i}] patch_props: node ${op.nodeId} not found`,
          };
        }
        const props = { ...(loc.node.props ?? {}) };
        for (const [k, v] of Object.entries(op.props)) {
          if (v === null) delete props[k];
          else props[k] = v;
        }
        loc.node.props = props;
        break;
      }

      case "remove": {
        if (!op.nodeId) {
          return {
            ok: false,
            code: "INVALID_OP",
            message: `ops[${i}] remove: nodeId required`,
          };
        }
        if (!next) {
          return {
            ok: false,
            code: "NODE_NOT_FOUND",
            message: `ops[${i}] remove: empty tree`,
          };
        }
        if (next.id === op.nodeId) {
          next = null;
          break;
        }
        const loc = findNode(next, op.nodeId);
        if (!loc || !loc.parent) {
          return {
            ok: false,
            code: "NODE_NOT_FOUND",
            message: `ops[${i}] remove: node ${op.nodeId} not found`,
          };
        }
        const kids = ensureChildren(loc.parent);
        kids.splice(loc.index, 1);
        break;
      }

      case "append_child": {
        if (!op.parentId || !isUiNode(op.node)) {
          return {
            ok: false,
            code: "INVALID_OP",
            message: `ops[${i}] append_child: parentId + node required`,
          };
        }
        const loc = findNode(next, op.parentId);
        if (!loc) {
          return {
            ok: false,
            code: "PARENT_NOT_FOUND",
            message: `ops[${i}] append_child: parent ${op.parentId} not found`,
          };
        }
        ensureChildren(loc.node).push(deepClone(op.node));
        break;
      }

      case "replace_children": {
        if (!op.nodeId && !op.parentId) {
          return {
            ok: false,
            code: "INVALID_OP",
            message: `ops[${i}] replace_children: nodeId/parentId required`,
          };
        }
        const targetId = op.nodeId ?? op.parentId!;
        const loc = findNode(next, targetId);
        if (!loc) {
          return {
            ok: false,
            code: "NODE_NOT_FOUND",
            message: `ops[${i}] replace_children: ${targetId} not found`,
          };
        }
        const children =
          op.children ??
          (op.node && Array.isArray(op.node.children) ? op.node.children : null);
        if (!children) {
          return {
            ok: false,
            code: "INVALID_OP",
            message: `ops[${i}] replace_children: children required`,
          };
        }
        loc.node.children = deepClone(children);
        break;
      }

      case "move": {
        if (!op.parentId || typeof op.fromIndex !== "number" || typeof op.toIndex !== "number") {
          return {
            ok: false,
            code: "INVALID_OP",
            message: `ops[${i}] move: parentId, fromIndex, toIndex required`,
          };
        }
        const loc = findNode(next, op.parentId);
        if (!loc) {
          return {
            ok: false,
            code: "PARENT_NOT_FOUND",
            message: `ops[${i}] move: parent ${op.parentId} not found`,
          };
        }
        const kids = ensureChildren(loc.node);
        if (
          op.fromIndex < 0 ||
          op.fromIndex >= kids.length ||
          op.toIndex < 0 ||
          op.toIndex >= kids.length
        ) {
          return {
            ok: false,
            code: "INVALID_OP",
            message: `ops[${i}] move: index out of range`,
          };
        }
        const [item] = kids.splice(op.fromIndex, 1);
        kids.splice(op.toIndex, 0, item);
        break;
      }

      case "set_bind": {
        if (!op.nodeId) {
          return {
            ok: false,
            code: "INVALID_OP",
            message: `ops[${i}] set_bind: nodeId required`,
          };
        }
        const loc = findNode(next, op.nodeId);
        if (!loc) {
          return {
            ok: false,
            code: "NODE_NOT_FOUND",
            message: `ops[${i}] set_bind: node ${op.nodeId} not found`,
          };
        }
        if (op.path === null || op.path === undefined || op.path === "") {
          delete loc.node.bind;
        } else {
          loc.node.bind = String(op.path);
        }
        break;
      }

      default:
        return {
          ok: false,
          code: "UNKNOWN_OP",
          message: `ops[${i}]: unknown op "${op.op}"`,
        };
    }
  }

  return { ok: true, tree: next };
}

/** Collect all node ids in a tree for linting after ops. */
export function collectNodes(tree: UiNode | null): UiNode[] {
  if (!tree) return [];
  const out: UiNode[] = [];
  function walk(n: UiNode) {
    out.push(n);
    for (const c of n.children ?? []) walk(c);
  }
  walk(tree);
  return out;
}
