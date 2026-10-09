import fs from "node:fs";
import type { EventBypass } from "./events.js";

export type HostActionLine = {
  actionId: string;
  action: Record<string, unknown>;
  ts?: string;
  sessionId?: string;
  source?: string;
};

/**
 * Poll actions.ndjson for new lines (Host writes via POST /api/action).
 * Dedup by actionId is done by the caller (SessionStore).
 */
export class ActionsFileWatcher {
  private offset = 0;
  private buffer = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private watcher: fs.FSWatcher | null = null;

  constructor(
    private events: EventBypass,
    private sessionId: string,
    private onLines: (lines: HostActionLine[]) => void,
    private intervalMs = 200,
  ) {}

  start(): void {
    this.events.ensureActionBypass(this.sessionId);
    const p = this.events.actionsPath(this.sessionId);
    try {
      const st = fs.statSync(p);
      // Start at end so we only pick up new Host writes after MCP open/watch
      // For smoke that writes after open, offset=EOF is correct.
      // If file already has content from a previous run, skip it.
      this.offset = st.size;
    } catch {
      this.offset = 0;
    }

    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      (this.timer as NodeJS.Timeout).unref();
    }
    try {
      this.watcher = fs.watch(p, () => this.poll());
      // fs.watch handle keeps process alive; ok while session open
    } catch {
      // watch optional; poll covers it
    }
  }

  /** Force read from current offset (also used by drain/poll tools). */
  poll(): HostActionLine[] {
    const p = this.events.actionsPath(this.sessionId);
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      return [];
    }
    if (st.size < this.offset) {
      // truncated / recreated
      this.offset = 0;
      this.buffer = "";
    }
    if (st.size === this.offset) return [];

    const fd = fs.openSync(p, "r");
    try {
      const len = st.size - this.offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, this.offset);
      this.offset = st.size;
      this.buffer += buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }

    const lines: HostActionLine[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const raw = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        if (!obj || typeof obj.actionId !== "string") continue;
        // Host POST /api/action writes flat {actionId,type,nodeId,...};
        // older smoke / bypass used nested {actionId, action:{...}}.
        let action = obj.action as Record<string, unknown> | undefined;
        if (!action || typeof action !== "object") {
          if (typeof obj.type === "string") {
            action = {
              type: obj.type,
              nodeId: obj.nodeId ?? null,
              componentType: obj.componentType ?? null,
              value: obj.value,
              path: obj.path,
              payload: obj.payload ?? {},
            };
          }
        }
        if (!action) continue;
        lines.push({
          actionId: obj.actionId,
          action,
          ts: typeof obj.ts === "string" ? obj.ts : undefined,
          sessionId: typeof obj.sessionId === "string" ? obj.sessionId : undefined,
          source: typeof obj.source === "string" ? obj.source : undefined,
        });
      } catch {
        // skip bad line
      }
    }

    if (lines.length) this.onLines(lines);
    return lines;
  }

  /** Reset offset to 0 and re-read entire file (for tests / catch-up). */
  reingestAll(): HostActionLine[] {
    this.offset = 0;
    this.buffer = "";
    return this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
