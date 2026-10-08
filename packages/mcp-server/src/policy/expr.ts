/**
 * Safe expression subset for G6 ⑤:
 * numbers, state field refs, + - * / (), whitelist funcs round/min/max/abs.
 * No Function / eval / arbitrary JS.
 */

export type ExprOk = { ok: true; value: number };
export type ExprErr = { ok: false; code: string; message: string };
export type ExprResult = ExprOk | ExprErr;

const FORBIDDEN =
  /\b(Function|eval|process|require|import|globalThis|window|global|constructor|__proto__|prototype|Module|child_process|fs)\b/i;

type Tok =
  | { kind: "num"; value: number }
  | { kind: "id"; value: string }
  | { kind: "op"; value: string }
  | { kind: "lp" }
  | { kind: "rp" }
  | { kind: "comma" };

function tokenize(src: string): { ok: true; tokens: Tok[] } | ExprErr {
  if (typeof src !== "string" || src.length === 0) {
    return { ok: false, code: "EXPR_EMPTY", message: "Empty expression" };
  }
  if (src.length > 512) {
    return { ok: false, code: "EXPR_TOO_LONG", message: "Expression exceeds 512 chars" };
  }
  if (FORBIDDEN.test(src)) {
    return {
      ok: false,
      code: "EXPR_FORBIDDEN",
      message: "Expression contains forbidden identifier",
    };
  }
  // Reject quotes, backticks, brackets, braces, semicolons, equals, bang, etc.
  if (/["'`\[\]{};=!?@#$%^&|\\<>~]/.test(src)) {
    return {
      ok: false,
      code: "EXPR_FORBIDDEN",
      message: "Expression contains disallowed characters",
    };
  }

  const tokens: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      if (!/^\d+(\.\d+)?$/.test(raw) && !/^\.\d+$/.test(raw)) {
        return { ok: false, code: "EXPR_BAD_NUMBER", message: `Bad number: ${raw}` };
      }
      tokens.push({ kind: "num", value: Number(raw) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_.]/.test(src[j])) j++;
      tokens.push({ kind: "id", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/".includes(c)) {
      tokens.push({ kind: "op", value: c });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rp" });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ kind: "comma" });
      i++;
      continue;
    }
    return {
      ok: false,
      code: "EXPR_FORBIDDEN",
      message: `Unexpected character: ${c}`,
    };
  }
  return { ok: true, tokens };
}

function lookupState(state: Record<string, unknown>, path: string): ExprResult {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) {
    return { ok: false, code: "EXPR_BAD_REF", message: "Empty state ref" };
  }
  let cur: unknown = state;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return {
        ok: false,
        code: "EXPR_UNDEF",
        message: `Undefined state path: ${path}`,
      };
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur !== "number" || !Number.isFinite(cur)) {
    return {
      ok: false,
      code: "EXPR_NOT_NUMBER",
      message: `State path ${path} is not a finite number`,
    };
  }
  return { ok: true, value: cur };
}

class Parser {
  private i = 0;
  constructor(
    private tokens: Tok[],
    private state: Record<string, unknown>,
  ) {}

  private peek(): Tok | undefined {
    return this.tokens[this.i];
  }
  private take(): Tok | undefined {
    return this.tokens[this.i++];
  }

  parse(): ExprResult {
    const r = this.parseExpr();
    if (!r.ok) return r;
    if (this.i < this.tokens.length) {
      return {
        ok: false,
        code: "EXPR_TRAILING",
        message: "Trailing tokens after expression",
      };
    }
    return r;
  }

  private parseExpr(): ExprResult {
    let left = this.parseTerm();
    if (!left.ok) return left;
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== "op" || (t.value !== "+" && t.value !== "-")) break;
      this.take();
      const right = this.parseTerm();
      if (!right.ok) return right;
      left = {
        ok: true,
        value: t.value === "+" ? left.value + right.value : left.value - right.value,
      };
    }
    return left;
  }

  private parseTerm(): ExprResult {
    let left = this.parseFactor();
    if (!left.ok) return left;
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== "op" || (t.value !== "*" && t.value !== "/")) break;
      this.take();
      const right = this.parseFactor();
      if (!right.ok) return right;
      if (t.value === "/" && right.value === 0) {
        return { ok: false, code: "EXPR_DIV_ZERO", message: "Division by zero" };
      }
      left = {
        ok: true,
        value: t.value === "*" ? left.value * right.value : left.value / right.value,
      };
    }
    return left;
  }

  private parseFactor(): ExprResult {
    const t = this.peek();
    if (!t) {
      return { ok: false, code: "EXPR_EOF", message: "Unexpected end of expression" };
    }

    if (t.kind === "op" && (t.value === "+" || t.value === "-")) {
      this.take();
      const inner = this.parseFactor();
      if (!inner.ok) return inner;
      return { ok: true, value: t.value === "-" ? -inner.value : inner.value };
    }

    if (t.kind === "num") {
      this.take();
      return { ok: true, value: t.value };
    }

    if (t.kind === "lp") {
      this.take();
      const inner = this.parseExpr();
      if (!inner.ok) return inner;
      const rp = this.take();
      if (!rp || rp.kind !== "rp") {
        return { ok: false, code: "EXPR_PAREN", message: "Expected )" };
      }
      return inner;
    }

    if (t.kind === "id") {
      this.take();
      const name = t.value;
      const next = this.peek();
      if (next && next.kind === "lp") {
        return this.parseCall(name);
      }
      return lookupState(this.state, name);
    }

    return {
      ok: false,
      code: "EXPR_UNEXPECTED",
      message: `Unexpected token near index ${this.i}`,
    };
  }

  private parseCall(name: string): ExprResult {
    const fn = name.toLowerCase();
    if (!["round", "min", "max", "abs"].includes(fn)) {
      return {
        ok: false,
        code: "EXPR_BAD_FUNC",
        message: `Function not allowed: ${name}`,
      };
    }
    this.take(); // (
    const args: number[] = [];
    if (this.peek()?.kind !== "rp") {
      while (true) {
        const a = this.parseExpr();
        if (!a.ok) return a;
        args.push(a.value);
        const sep = this.peek();
        if (sep?.kind === "comma") {
          this.take();
          continue;
        }
        break;
      }
    }
    const rp = this.take();
    if (!rp || rp.kind !== "rp") {
      return { ok: false, code: "EXPR_PAREN", message: "Expected ) after call args" };
    }

    if (fn === "abs") {
      if (args.length !== 1) {
        return { ok: false, code: "EXPR_ARITY", message: "abs expects 1 arg" };
      }
      return { ok: true, value: Math.abs(args[0]) };
    }
    if (fn === "min") {
      if (args.length < 1) {
        return { ok: false, code: "EXPR_ARITY", message: "min expects ≥1 args" };
      }
      return { ok: true, value: Math.min(...args) };
    }
    if (fn === "max") {
      if (args.length < 1) {
        return { ok: false, code: "EXPR_ARITY", message: "max expects ≥1 args" };
      }
      return { ok: true, value: Math.max(...args) };
    }
    if (args.length < 1 || args.length > 2) {
      return { ok: false, code: "EXPR_ARITY", message: "round expects 1 or 2 args" };
    }
    const digits = args.length === 2 ? Math.trunc(args[1]) : 0;
    if (digits < 0 || digits > 12) {
      return { ok: false, code: "EXPR_ROUND", message: "round digits must be 0..12" };
    }
    const f = 10 ** digits;
    return { ok: true, value: Math.round(args[0] * f) / f };
  }
}

/**
 * Evaluate a safe expression against session state.
 * Only finite numbers are returned.
 */
export function evaluateExpr(
  expr: string,
  state: Record<string, unknown>,
): ExprResult {
  const tok = tokenize(expr);
  if (!tok.ok) return tok;
  const parser = new Parser(tok.tokens, state);
  const result = parser.parse();
  if (!result.ok) return result;
  if (!Number.isFinite(result.value)) {
    return { ok: false, code: "EXPR_NAN", message: "Result is not finite" };
  }
  return result;
}

/**
 * Apply session.reducers and node.expr props; mutates tree props in place.
 */
export function applyDerived(
  tree: import("../protocol.js").UiNode | null,
  state: Record<string, unknown>,
  reducers?: Record<string, string> | null,
): {
  state: Record<string, unknown>;
  ops: Array<{
    op: "patch_props";
    nodeId: string;
    props: Record<string, unknown>;
  }>;
  errors: string[];
} {
  const next = { ...state };
  const errors: string[] = [];
  const ops: Array<{
    op: "patch_props";
    nodeId: string;
    props: Record<string, unknown>;
  }> = [];

  if (reducers && typeof reducers === "object") {
    for (const [key, expr] of Object.entries(reducers)) {
      if (typeof expr !== "string") continue;
      const r = evaluateExpr(expr, next);
      if (!r.ok) {
        errors.push(`reducer ${key}: ${r.message}`);
        continue;
      }
      next[key] = r.value;
    }
  }

  function walk(node: import("../protocol.js").UiNode): void {
    if (node.expr && typeof node.expr === "object") {
      const props: Record<string, unknown> = {};
      for (const [prop, expr] of Object.entries(node.expr)) {
        if (typeof expr !== "string") continue;
        const r = evaluateExpr(expr, next);
        if (!r.ok) {
          errors.push(`node ${node.id}.${prop}: ${r.message}`);
          continue;
        }
        props[prop] = r.value;
      }
      if (Object.keys(props).length > 0) {
        node.props = { ...(node.props ?? {}), ...props };
        ops.push({ op: "patch_props", nodeId: node.id, props });
      }
    }
    if (node.children) {
      for (const c of node.children) walk(c);
    }
  }

  if (tree) walk(tree);

  return { state: next, ops, errors };
}
