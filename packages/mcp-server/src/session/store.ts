import { randomUUID } from "node:crypto";
import type { SessionRecord, SessionStatus, UiEvent, UiNode } from "../protocol.js";
import { PROTOCOL_VERSION, nowIso } from "../protocol.js";
import { EventBypass } from "./events.js";
import type { CatalogRegistry } from "../catalog/registry.js";
import { lintTree, type LintResult } from "../lint.js";
import { applyDerived, evaluateExpr } from "../policy/expr.js";
import { applyOps, type UiOp } from "./ops.js";
import { ActionsFileWatcher, type HostActionLine } from "./actions-watch.js";

function genSessionId(): string {
  return `s_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function genActionId(): string {
  return `a_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function actionTimeoutMs(): number {
  const n = Number(process.env.IUI_ACTION_TIMEOUT_MS ?? "120000");
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

export type PendingAction = {
  actionId: string;
  action: Record<string, unknown>;
  ts: string;
  source: "tool" | "bypass";
  drained: boolean;
};

type SessionRuntime = {
  mutex: Promise<unknown>;
  streamBuffer: string;
  /** Non-op JSONL lines / incomplete blob held for chunkDone full-parse fallback. */
  fallbackBuffer: string;
  pendingActions: PendingAction[];
  seenActionIds: Set<string>;
  actionPendingAt: number | null;
  actionTimer: ReturnType<typeof setTimeout> | null;
  watcher: ActionsFileWatcher | null;
};

const WRITEABLE: SessionStatus[] = [
  "open",
  "streaming",
  "idle",
  "action_pending",
  "error",
];

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();
  private runtime = new Map<string, SessionRuntime>();
  readonly events: EventBypass;

  constructor(
    private catalog: CatalogRegistry,
    sessionDir?: string,
  ) {
    this.events = new EventBypass(sessionDir);
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  /** Serialize writes for one session. */
  private async withLock<T>(sessionId: string, fn: () => T | Promise<T>): Promise<T> {
    const rt = this.ensureRuntime(sessionId);
    const prev = rt.mutex;
    let release!: () => void;
    rt.mutex = new Promise<void>((r) => {
      release = r;
    });
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private ensureRuntime(sessionId: string): SessionRuntime {
    let rt = this.runtime.get(sessionId);
    if (!rt) {
      rt = {
        mutex: Promise.resolve(),
        streamBuffer: "",
        fallbackBuffer: "",
        pendingActions: [],
        seenActionIds: new Set(),
        actionPendingAt: null,
        actionTimer: null,
        watcher: null,
      };
      this.runtime.set(sessionId, rt);
    }
    return rt;
  }

  private startWatcher(sessionId: string): void {
    const rt = this.ensureRuntime(sessionId);
    if (rt.watcher) return;
    rt.watcher = new ActionsFileWatcher(this.events, sessionId, (lines) => {
      for (const line of lines) {
        void this.ingestBypassAction(sessionId, line);
      }
    });
    rt.watcher.start();
  }

  private stopWatcher(sessionId: string): void {
    const rt = this.runtime.get(sessionId);
    if (!rt?.watcher) return;
    rt.watcher.stop();
    rt.watcher = null;
  }

  private clearActionTimer(sessionId: string): void {
    const rt = this.runtime.get(sessionId);
    if (!rt) return;
    if (rt.actionTimer) {
      clearTimeout(rt.actionTimer);
      rt.actionTimer = null;
    }
    rt.actionPendingAt = null;
  }

  private armActionTimeout(sessionId: string): void {
    const rt = this.ensureRuntime(sessionId);
    this.clearActionTimer(sessionId);
    rt.actionPendingAt = Date.now();
    const ms = actionTimeoutMs();
    rt.actionTimer = setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (!session || session.status !== "action_pending") return;
      session.status = "idle";
      session.updatedAt = nowIso();
      const ev: UiEvent = {
        protocolVersion: PROTOCOL_VERSION,
        type: "ui.error",
        sessionId,
        ts: session.updatedAt,
        code: "ACTION_TIMEOUT",
        message: `action_pending timed out after ${ms}ms; returned to idle`,
        recoverable: true,
      };
      this.events.append(ev);
      this.persistSnapshot(session);
    }, ms);
    // Don't keep process alive solely for timeout in smoke
    if (typeof rt.actionTimer === "object" && rt.actionTimer && "unref" in rt.actionTimer) {
      (rt.actionTimer as NodeJS.Timeout).unref();
    }
  }

  open(input: {
    sessionId?: string;
    title?: string;
    initialState?: Record<string, unknown>;
    preferPlainText?: boolean;
    density?: SessionRecord["density"];
    meta?: Record<string, unknown>;
    reducers?: Record<string, string>;
    query?: string;
  }):
    | { ok: true; session: SessionRecord; eventsPath: string }
    | { ok: false; code: string; message: string } {
    const sessionId = input.sessionId ?? genSessionId();
    const existing = this.sessions.get(sessionId);
    if (existing && existing.status !== "closed") {
      return {
        ok: false,
        code: "SESSION_EXISTS",
        message: `Session already open: ${sessionId}`,
      };
    }
    if (input.reducers && typeof input.reducers === "object") {
      for (const [k, expr] of Object.entries(input.reducers)) {
        if (typeof expr !== "string") {
          return {
            ok: false,
            code: "EXPR_INVALID",
            message: `reducer ${k} must be a string expression`,
          };
        }
        const probe = evaluateExpr(expr, {
          ...(input.initialState ?? {}),
          // allow undef refs during validate by filling 0 for missing — use empty and catch FORBIDDEN only
        });
        // Only hard-fail on forbidden/syntax; undef state is ok at open
        if (
          !probe.ok &&
          (probe.code === "EXPR_FORBIDDEN" ||
            probe.code === "EXPR_BAD_FUNC" ||
            probe.code === "EXPR_BAD_NUMBER" ||
            probe.code === "EXPR_TOO_LONG" ||
            probe.code === "EXPR_EMPTY" ||
            probe.code === "EXPR_UNEXPECTED" ||
            probe.code === "EXPR_PAREN" ||
            probe.code === "EXPR_TRAILING" ||
            probe.code === "EXPR_ARITY")
        ) {
          return {
            ok: false,
            code: probe.code,
            message: `reducer ${k}: ${probe.message}`,
          };
        }
      }
    }

    const now = nowIso();
    let state: Record<string, unknown> = { ...(input.initialState ?? {}) };
    if (input.reducers) {
      const derived = applyDerived(null, state, input.reducers);
      state = derived.state;
    }
    const session: SessionRecord = {
      sessionId,
      status: "open",
      revision: 0,
      tree: null,
      state,
      partial: false,
      title: input.title ?? "",
      density: input.density ?? "full",
      preferPlainText: input.preferPlainText ?? false,
      createdAt: now,
      updatedAt: now,
      lastActionId: null,
      lastError: null,
      meta: input.meta,
      lastQuery: input.query,
      reducers: input.reducers,
    };
    this.sessions.set(sessionId, session);
    this.ensureRuntime(sessionId);
    const ev: UiEvent = {
      protocolVersion: PROTOCOL_VERSION,
      type: "ui.open",
      sessionId,
      ts: now,
      title: session.title || undefined,
      state: session.state,
    };
    this.events.append(ev);
    this.events.ensureActionBypass(sessionId);
    this.persistSnapshot(session);
    this.startWatcher(sessionId);
    return {
      ok: true,
      session,
      eventsPath: this.events.sessionPath(sessionId),
    };
  }

  private requireWritable(
    sessionId: string,
  ):
    | { ok: true; session: SessionRecord }
    | { ok: false; code: string; message: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, code: "SESSION_NOT_FOUND", message: "Unknown sessionId" };
    }
    if (session.status === "closed" || session.status === "closing") {
      return { ok: false, code: "SESSION_CLOSED", message: "Session is closed" };
    }
    if (!WRITEABLE.includes(session.status)) {
      return {
        ok: false,
        code: "INVALID_STATUS",
        message: `Cannot write in status=${session.status}`,
      };
    }
    return { ok: true, session };
  }

  proposeTree(input: {
    sessionId: string;
    tree?: UiNode | null;
    plainTextFallback?: string;
    runLint?: boolean;
    query?: string;
    forceUi?: boolean;
  }):
    | {
        ok: true;
        session: SessionRecord;
        lint: LintResult;
        decision: "ui" | "plain_text";
        plainText?: string;
        warnings: string[];
      }
    | { ok: false; code: string; message: string; lint?: LintResult } {
    const gate = this.requireWritable(input.sessionId);
    if (!gate.ok) return gate;
    const session = gate.session;
    if (typeof input.query === "string" && input.query.trim()) {
      session.lastQuery = input.query.trim();
    }

    const warnings: string[] = [];
    if (!input.tree && input.plainTextFallback) {
      if (session.status === "action_pending") this.clearActionTimer(session.sessionId);
      session.status = "idle";
      session.partial = false;
      session.updatedAt = nowIso();
      this.emitDone(session, "plain_text");
      this.persistSnapshot(session);
      return {
        ok: true,
        session,
        lint: { passed: true, issues: [] },
        decision: "plain_text",
        plainText: input.plainTextFallback,
        warnings,
      };
    }

    if (!input.tree) {
      return {
        ok: false,
        code: "MISSING_TREE",
        message: "mode=tree requires tree or plainTextFallback",
      };
    }

    const runLint = input.runLint ?? true;
    const lint = runLint
      ? lintTree(input.tree, (t) => this.catalog.isTypeEnabled(t))
      : { passed: true, issues: [] };

    const hasError = lint.issues.some((i) => i.severity === "error");
    if (hasError) {
      this.emitError(
        session,
        "LINT_FAILED",
        lint.issues
          .filter((i) => i.severity === "error")
          .map((i) => i.message)
          .join("; "),
        true,
      );
      return {
        ok: false,
        code: "LINT_FAILED",
        message: lint.issues
          .filter((i) => i.severity === "error")
          .map((i) => i.message)
          .join("; "),
        lint,
      };
    }

    for (const issue of lint.issues) {
      if (issue.severity === "warn") warnings.push(`${issue.code}: ${issue.message}`);
    }

    if (session.status === "action_pending") this.clearActionTimer(session.sessionId);
    session.status = "streaming";
    session.tree = input.tree;
    // Apply session reducers + node.expr against current state
    const derived = applyDerived(session.tree, session.state, session.reducers);
    session.state = derived.state;
    for (const e of derived.errors) warnings.push(`EXPR: ${e}`);
    session.revision += 1;
    session.partial = false;
    session.updatedAt = nowIso();
    session.lastError = null;

    const replaceEv: UiEvent = {
      protocolVersion: PROTOCOL_VERSION,
      type: "ui.replace",
      sessionId: session.sessionId,
      ts: session.updatedAt,
      revision: session.revision,
      partial: false,
      tree: session.tree,
    };
    this.events.append(replaceEv);
    this.emitDone(session, "completed");
    session.status = "idle";
    this.persistSnapshot(session);

    return {
      ok: true,
      session,
      lint,
      decision: "ui",
      warnings,
    };
  }

  proposeOps(input: {
    sessionId: string;
    ops: UiOp[];
    chunkDone?: boolean;
    runLint?: boolean;
    refresh?: boolean;
    targetNodeId?: string;
  }):
    | {
        ok: true;
        session: SessionRecord;
        lint: LintResult;
        decision: "ui";
        warnings: string[];
        refresh?: string;
      }
    | { ok: false; code: string; message: string; lint?: LintResult } {
    const gate = this.requireWritable(input.sessionId);
    if (!gate.ok) return gate;
    const session = gate.session;

    if (!input.ops || !Array.isArray(input.ops) || input.ops.length === 0) {
      return {
        ok: false,
        code: "MISSING_OPS",
        message: "mode=ops requires non-empty ops[]",
      };
    }

    // refresh: treat as alias note; still apply ops if provided
    const refreshNote = input.refresh
      ? `refresh=${input.targetNodeId ?? "session"} (optional; ops applied as patch)`
      : undefined;

    const applied = applyOps(session.tree, input.ops);
    if (!applied.ok) {
      this.emitError(session, applied.code, applied.message, true);
      return { ok: false, code: applied.code, message: applied.message };
    }

    const warnings: string[] = [];
    let lint: LintResult = { passed: true, issues: [] };
    if (applied.tree && (input.runLint ?? true)) {
      lint = lintTree(applied.tree, (t) => this.catalog.isTypeEnabled(t));
      const hasError = lint.issues.some((i) => i.severity === "error");
      if (hasError) {
        const msg = lint.issues
          .filter((i) => i.severity === "error")
          .map((i) => i.message)
          .join("; ");
        this.emitError(session, "LINT_FAILED", msg, true);
        return { ok: false, code: "LINT_FAILED", message: msg, lint };
      }
      for (const issue of lint.issues) {
        if (issue.severity === "warn") warnings.push(`${issue.code}: ${issue.message}`);
      }
    }
    if (refreshNote) warnings.push(refreshNote);

    if (session.status === "action_pending") this.clearActionTimer(session.sessionId);
    // Progressive default: only explicit chunkDone:true finalizes (omit/false → partial).
    const done = input.chunkDone === true;
    session.status = "streaming";
    session.tree = applied.tree;
    session.revision += 1;
    session.partial = !done;
    session.updatedAt = nowIso();
    session.lastError = null;

    const deltaEv: UiEvent = {
      protocolVersion: PROTOCOL_VERSION,
      type: "ui.delta",
      sessionId: session.sessionId,
      ts: session.updatedAt,
      revision: session.revision,
      partial: session.partial,
      ops: input.ops,
    };
    this.events.append(deltaEv);

    if (done) {
      this.emitDone(session, "completed");
      session.status = "idle";
      session.partial = false;
    } else {
      warnings.push(
        "STREAMING_PARTIAL: chunkDone omitted/false — Host paints this shard; pass chunkDone:true to finalize",
      );
    }
    this.persistSnapshot(session);

    return {
      ok: true,
      session,
      lint,
      decision: "ui",
      warnings,
      ...(refreshNote ? { refresh: refreshNote } : {}),
    };
  }

  /**
   * streaming_chunks:
   * - Prefer JSONL ops: each complete newline-delimited JSON line that is an op /
   *   ops array / {ops:[]} is applied immediately via proposeOps (ui.delta + snapshot).
   * - Non-op lines accumulate in fallbackBuffer; on chunkDone, parse leftover as
   *   full JSON tree | {tree} | {ops} (legacy one-shot behavior).
   */
  proposeChunks(input: {
    sessionId: string;
    chunk?: string;
    chunkIndex?: number;
    chunkDone?: boolean;
    runLint?: boolean;
  }):
    | {
        ok: true;
        session: SessionRecord;
        lint: LintResult;
        decision: "ui";
        warnings: string[];
        bufferedChars: number;
        appliedOps?: number;
      }
    | { ok: false; code: string; message: string; lint?: LintResult } {
    const gate = this.requireWritable(input.sessionId);
    if (!gate.ok) return gate;
    const session = gate.session;
    const rt = this.ensureRuntime(session.sessionId);

    if (typeof input.chunk === "string") {
      rt.streamBuffer += input.chunk;
    }

    if (session.status === "action_pending") this.clearActionTimer(session.sessionId);
    session.status = "streaming";
    session.partial = true;
    session.updatedAt = nowIso();

    const warnings: string[] = [];
    let appliedOps = 0;
    let lastLint: LintResult = { passed: true, issues: [] };

    const coerceOps = (parsed: unknown): UiOp[] | null => {
      if (Array.isArray(parsed)) {
        if (
          parsed.length > 0 &&
          parsed.every(
            (x) => x && typeof x === "object" && typeof (x as UiOp).op === "string",
          )
        ) {
          return parsed as UiOp[];
        }
        return null;
      }
      if (parsed && typeof parsed === "object") {
        const o = parsed as { op?: unknown; ops?: unknown };
        if (typeof o.op === "string") return [parsed as UiOp];
        if (Array.isArray(o.ops)) return o.ops as UiOp[];
      }
      return null;
    };

    // Drain complete JSONL lines and apply ops immediately
    while (true) {
      const nl = rt.streamBuffer.indexOf("\n");
      if (nl < 0) break;
      const line = rt.streamBuffer.slice(0, nl).trim();
      rt.streamBuffer = rt.streamBuffer.slice(nl + 1);
      if (!line) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        rt.fallbackBuffer += line + "\n";
        warnings.push(`streaming_chunks: non-JSON line deferred (${msg})`);
        continue;
      }

      const ops = coerceOps(parsed);
      if (ops && ops.length > 0) {
        const opsResult = this.proposeOps({
          sessionId: session.sessionId,
          ops,
          chunkDone: false,
          runLint: input.runLint,
        });
        if (!opsResult.ok) return opsResult;
        appliedOps += ops.length;
        lastLint = opsResult.lint;
        for (const w of opsResult.warnings) warnings.push(w);
      } else {
        // Tree-shaped or other JSON — keep for chunkDone full parse
        rt.fallbackBuffer += line + "\n";
      }
    }

    if (!input.chunkDone) {
      // Snapshot already written by proposeOps when ops applied; refresh pointer if only buffered
      if (appliedOps === 0) this.persistSnapshot(session);
      return {
        ok: true,
        session,
        lint: lastLint,
        decision: "ui",
        warnings: [
          ...warnings,
          appliedOps > 0
            ? `streaming_chunks: applied ${appliedOps} op(s) from JSONL (partial paint)`
            : "streaming_chunks: buffered; waiting for JSONL newline or chunkDone",
        ],
        bufferedChars: rt.streamBuffer.length + rt.fallbackBuffer.length,
        appliedOps,
      };
    }

    // chunkDone: flush leftover buffer as legacy full JSON (tree | {tree} | {ops})
    const leftover = (rt.fallbackBuffer + rt.streamBuffer).trim();
    rt.streamBuffer = "";
    rt.fallbackBuffer = "";

    if (!leftover) {
      this.emitDone(session, "completed");
      session.status = "idle";
      session.partial = false;
      session.updatedAt = nowIso();
      this.persistSnapshot(session);
      return {
        ok: true,
        session,
        lint: lastLint,
        decision: "ui",
        warnings:
          appliedOps > 0
            ? [...warnings, `streaming_chunks: finalized after ${appliedOps} JSONL op(s)`]
            : [...warnings, "streaming_chunks: chunkDone with empty buffer (no-op finalize)"],
        bufferedChars: 0,
        appliedOps,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(leftover);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.emitError(
        session,
        "PARSE_FAILED",
        `JSON parse failed: ${msg}`,
        true,
      );
      session.partial = true;
      this.persistSnapshot(session);
      return {
        ok: false,
        code: "PARSE_FAILED",
        message: `JSON parse failed: ${msg}`,
      };
    }

    const leftoverOps = coerceOps(parsed);
    if (leftoverOps && leftoverOps.length > 0) {
      const opsResult = this.proposeOps({
        sessionId: session.sessionId,
        ops: leftoverOps,
        chunkDone: true,
        runLint: input.runLint,
      });
      if (!opsResult.ok) return opsResult;
      return {
        ok: true as const,
        session: opsResult.session,
        lint: opsResult.lint,
        decision: "ui" as const,
        warnings: [...warnings, ...opsResult.warnings],
        bufferedChars: 0,
        appliedOps: appliedOps + leftoverOps.length,
      };
    }

    let tree: UiNode | null = null;
    if (
      parsed &&
      typeof parsed === "object" &&
      "tree" in (parsed as object) &&
      (parsed as { tree: unknown }).tree
    ) {
      tree = (parsed as { tree: UiNode }).tree;
    } else if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as UiNode).id === "string" &&
      typeof (parsed as UiNode).type === "string"
    ) {
      tree = parsed as UiNode;
    } else {
      this.emitError(
        session,
        "PARSE_FAILED",
        "Parsed JSON is neither UiNode nor {ops} nor {tree}",
        true,
      );
      session.partial = true;
      this.persistSnapshot(session);
      return {
        ok: false,
        code: "PARSE_FAILED",
        message: "Parsed JSON is neither UiNode nor {ops} nor {tree}",
      };
    }

    const result = this.proposeTree({
      sessionId: session.sessionId,
      tree,
      runLint: input.runLint,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      session: result.session,
      lint: result.lint,
      decision: "ui",
      warnings: [...warnings, ...result.warnings],
      bufferedChars: 0,
      appliedOps,
    };
  }

  patch(input: {
    sessionId: string;
    ops: UiOp[];
    statePatch?: Record<string, unknown>;
    runLint?: boolean;
  }):
    | {
        ok: true;
        session: SessionRecord;
        revision: number;
        state: Record<string, unknown>;
        warnings: string[];
      }
    | { ok: false; code: string; message: string } {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      return { ok: false, code: "SESSION_NOT_FOUND", message: "Unknown sessionId" };
    }
    if (session.status === "closed" || session.status === "closing") {
      return { ok: false, code: "SESSION_CLOSED", message: "Session is closed" };
    }
    if (
      session.status !== "idle" &&
      session.status !== "action_pending" &&
      session.status !== "streaming"
    ) {
      // also allow open (empty tree) for first patch via upsert
      if (session.status !== "open") {
        return {
          ok: false,
          code: "INVALID_STATUS",
          message: `ui_patch not allowed in status=${session.status}`,
        };
      }
    }

    if (!input.ops || input.ops.length === 0) {
      return { ok: false, code: "MISSING_OPS", message: "ops required" };
    }

    const applied = applyOps(session.tree, input.ops);
    if (!applied.ok) {
      this.emitError(session, applied.code, applied.message, true);
      return { ok: false, code: applied.code, message: applied.message };
    }

    const warnings: string[] = [];
    if (applied.tree && (input.runLint ?? true)) {
      const lint = lintTree(applied.tree, (t) => this.catalog.isTypeEnabled(t));
      if (lint.issues.some((i) => i.severity === "error")) {
        const msg = lint.issues
          .filter((i) => i.severity === "error")
          .map((i) => i.message)
          .join("; ");
        this.emitError(session, "LINT_FAILED", msg, true);
        return { ok: false, code: "LINT_FAILED", message: msg };
      }
      for (const issue of lint.issues) {
        if (issue.severity === "warn") warnings.push(`${issue.code}: ${issue.message}`);
      }
    }

    if (input.statePatch && typeof input.statePatch === "object") {
      session.state = { ...session.state, ...input.statePatch };
    }

    const wasPending = session.status === "action_pending";
    if (wasPending) this.clearActionTimer(session.sessionId);

    session.tree = applied.tree;
    const derived = applyDerived(session.tree, session.state, session.reducers);
    session.state = derived.state;
    for (const e of derived.errors) warnings.push(`EXPR: ${e}`);
    const allOps = [...input.ops, ...derived.ops];
    session.revision += 1;
    session.partial = false;
    session.status = "idle";
    session.updatedAt = nowIso();
    session.lastError = null;

    const deltaEv: UiEvent = {
      protocolVersion: PROTOCOL_VERSION,
      type: "ui.delta",
      sessionId: session.sessionId,
      ts: session.updatedAt,
      revision: session.revision,
      partial: false,
      ops: allOps,
    };
    this.events.append(deltaEv);
    this.persistSnapshot(session);

    return {
      ok: true,
      session,
      revision: session.revision,
      state: session.state,
      warnings,
    };
  }

  reportAction(input: {
    sessionId: string;
    action: Record<string, unknown>;
    actionId?: string;
    applyState?: boolean;
    source?: "tool" | "bypass";
  }):
    | {
        ok: true;
        actionId: string;
        state: Record<string, unknown>;
        status: SessionStatus;
        note: string;
        duplicate?: boolean;
      }
    | { ok: false; code: string; message: string } {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      return { ok: false, code: "SESSION_NOT_FOUND", message: "Unknown sessionId" };
    }
    if (session.status === "closed" || session.status === "closing") {
      return { ok: false, code: "SESSION_CLOSED", message: "Session is closed" };
    }
    if (
      session.status !== "idle" &&
      session.status !== "streaming" &&
      session.status !== "action_pending" &&
      session.status !== "open"
    ) {
      return {
        ok: false,
        code: "INVALID_STATUS",
        message: `ui_report_action not allowed in status=${session.status}`,
      };
    }

    if (!input.action || typeof input.action !== "object" || !input.action.type) {
      return {
        ok: false,
        code: "INVALID_ACTION",
        message: "action.type required",
      };
    }

    const serialized = JSON.stringify(input.action);
    if (serialized.length > 32 * 1024) {
      return {
        ok: false,
        code: "PAYLOAD_TOO_LARGE",
        message: "action payload exceeds 32KB",
      };
    }

    const rt = this.ensureRuntime(session.sessionId);
    const actionId = input.actionId ?? genActionId();

    if (rt.seenActionIds.has(actionId)) {
      return {
        ok: true,
        actionId,
        state: session.state,
        status: session.status,
        note: "Duplicate actionId ignored",
        duplicate: true,
      };
    }
    rt.seenActionIds.add(actionId);

    const applyState = input.applyState !== false;
    const exprNotes: string[] = [];
    if (
      applyState &&
      (input.action.type === "state.set" || input.action.type === "change")
    ) {
      const path =
        typeof input.action.path === "string"
          ? input.action.path
          : typeof (input.action.payload as { path?: string } | undefined)?.path ===
              "string"
            ? (input.action.payload as { path: string }).path
            : undefined;
      if (path) {
        const value =
          "value" in input.action
            ? input.action.value
            : (input.action.payload as { value?: unknown } | undefined)?.value;
        this.setStatePath(session.state, path, value);
        const derived = applyDerived(session.tree, session.state, session.reducers);
        session.state = derived.state;
        for (const e of derived.errors) exprNotes.push(e);
        if (derived.ops.length > 0 && session.tree) {
          session.revision += 1;
          const deltaEv: UiEvent = {
            protocolVersion: PROTOCOL_VERSION,
            type: "ui.delta",
            sessionId: session.sessionId,
            ts: nowIso(),
            revision: session.revision,
            partial: false,
            ops: derived.ops,
          };
          this.events.append(deltaEv);
        }
      }
    }

    const ts = nowIso();
    session.lastActionId = actionId;
    session.status = "action_pending";
    session.updatedAt = ts;
    this.armActionTimeout(session.sessionId);

    const pending: PendingAction = {
      actionId,
      action: input.action,
      ts,
      source: input.source ?? "tool",
      drained: false,
    };
    rt.pendingActions.push(pending);

    const ev: UiEvent = {
      protocolVersion: PROTOCOL_VERSION,
      type: "ui.action",
      sessionId: session.sessionId,
      ts,
      actionId,
      action: input.action,
    };
    this.events.append(ev);
    this.persistSnapshot(session);

    return {
      ok: true,
      actionId,
      state: session.state,
      status: session.status,
      note:
        exprNotes.length > 0
          ? `Harness should decide next ui_patch / message; expr: ${exprNotes.join("; ")}`
          : "Harness should decide next ui_patch / message (expr/reducers applied if any)",
    };
  }

  private setStatePath(
    state: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const parts = path.split(".").filter(Boolean);
    if (parts.length === 0) return;
    if (parts.length === 1) {
      state[parts[0]] = value as never;
      return;
    }
    let cur: Record<string, unknown> = state;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] === undefined || typeof cur[p] !== "object" || cur[p] === null) {
        cur[p] = {};
      }
      cur = cur[p] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value as never;
  }

  private async ingestBypassAction(
    sessionId: string,
    line: HostActionLine,
  ): Promise<void> {
    await this.withLock(sessionId, () => {
      const session = this.sessions.get(sessionId);
      if (!session || session.status === "closed" || session.status === "closing") {
        return;
      }
      this.reportAction({
        sessionId,
        actionId: line.actionId,
        action: line.action,
        source: "bypass",
      });
    });
  }

  /** Poll watcher + return undrained pending actions (marks them drained). */
  drainActions(
    sessionId: string,
    opts: { markDrained?: boolean; max?: number } = {},
  ):
    | {
        ok: true;
        actions: PendingAction[];
        status: SessionStatus;
        lastActionId: string | null;
      }
    | { ok: false; code: string; message: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, code: "SESSION_NOT_FOUND", message: "Unknown sessionId" };
    }
    const rt = this.ensureRuntime(sessionId);
    // Catch up file before drain
    rt.watcher?.poll();

    const mark = opts.markDrained !== false;
    const max = opts.max ?? 100;
    const out: PendingAction[] = [];
    for (const p of rt.pendingActions) {
      if (p.drained) continue;
      out.push(p);
      if (mark) p.drained = true;
      if (out.length >= max) break;
    }
    return {
      ok: true,
      actions: out,
      status: session.status,
      lastActionId: session.lastActionId,
    };
  }

  /** Peek pending without marking drained; also polls file. */
  getPendingActions(sessionId: string):
    | {
        ok: true;
        actions: PendingAction[];
        status: SessionStatus;
        lastActionId: string | null;
      }
    | { ok: false; code: string; message: string } {
    return this.drainActions(sessionId, { markDrained: false });
  }

  getState(
    sessionId: string,
    opts: { includeTree?: boolean; includeState?: boolean } = {},
  ):
    | {
        ok: true;
        sessionId: string;
        status: SessionStatus;
        revision: number;
        tree?: UiNode | null;
        state?: Record<string, unknown>;
        partial: boolean;
        lastActionId?: string | null;
      }
    | { ok: false; code: string; message: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, code: "SESSION_NOT_FOUND", message: "Unknown sessionId" };
    }
    const includeTree = opts.includeTree ?? true;
    const includeState = opts.includeState ?? true;
    return {
      ok: true,
      sessionId: session.sessionId,
      status: session.status,
      revision: session.revision,
      partial: session.partial,
      lastActionId: session.lastActionId,
      ...(includeTree ? { tree: session.tree } : {}),
      ...(includeState ? { state: session.state } : {}),
    };
  }

  close(
    sessionId: string,
    reason: "completed" | "cancelled" | "error" | "replaced" = "completed",
  ): { ok: true } | { ok: false; code: string; message: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, code: "SESSION_NOT_FOUND", message: "Unknown sessionId" };
    }
    if (session.status === "closed") {
      return { ok: true };
    }
    this.clearActionTimer(sessionId);
    this.stopWatcher(sessionId);
    const rt = this.runtime.get(sessionId);
    if (rt) {
      rt.streamBuffer = "";
      rt.fallbackBuffer = "";
    }
    session.status = "closing";
    session.updatedAt = nowIso();
    this.emitDone(session, reason);
    session.status = "closed";
    this.persistSnapshot(session);
    return { ok: true };
  }

  private emitDone(session: SessionRecord, reason: string): void {
    const ev: UiEvent = {
      protocolVersion: PROTOCOL_VERSION,
      type: "ui.done",
      sessionId: session.sessionId,
      ts: nowIso(),
      revision: session.revision,
      reason,
    };
    this.events.append(ev);
  }

  private emitError(
    session: SessionRecord,
    code: string,
    message: string,
    recoverable: boolean,
  ): void {
    session.lastError = { code, message };
    const ev: UiEvent = {
      protocolVersion: PROTOCOL_VERSION,
      type: "ui.error",
      sessionId: session.sessionId,
      ts: nowIso(),
      code,
      message,
      recoverable,
    };
    this.events.append(ev);
    if (!recoverable) {
      session.status = "error";
    }
  }

  private persistSnapshot(session: SessionRecord): void {
    this.events.writeSnapshot(session.sessionId, {
      protocolVersion: PROTOCOL_VERSION,
      ...session,
    });
    this.events.writeCurrent(session.sessionId, session.revision);
  }

  /** Expose lock for server tool handlers that need atomic multi-step. */
  runLocked<T>(sessionId: string, fn: () => T | Promise<T>): Promise<T> {
    return this.withLock(sessionId, fn);
  }
}
