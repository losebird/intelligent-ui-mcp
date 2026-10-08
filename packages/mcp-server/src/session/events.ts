import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { UiEvent } from "../protocol.js";

export function resolveSessionDir(override?: string): string {
  const dir =
    override ??
    process.env.IUI_SESSION_DIR ??
    path.join(os.homedir(), ".intelligent-ui-mcp", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export class EventBypass {
  readonly dir: string;

  constructor(dir?: string) {
    this.dir = resolveSessionDir(dir);
  }

  sessionPath(sessionId: string): string {
    return path.join(this.dir, `${sessionId}.ndjson`);
  }

  actionsPath(sessionId: string): string {
    return path.join(this.dir, `${sessionId}.actions.ndjson`);
  }

  snapshotPath(sessionId: string): string {
    return path.join(this.dir, `${sessionId}.snapshot.json`);
  }

  currentPath(): string {
    return path.join(this.dir, "current.json");
  }

  ensureActionBypass(sessionId: string): void {
    const p = this.actionsPath(sessionId);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, "", "utf8");
    }
  }

  append(event: UiEvent): void {
    const line = JSON.stringify(event) + "\n";
    fs.appendFileSync(this.sessionPath(event.sessionId), line, "utf8");
    this.ensureActionBypass(event.sessionId);
    this.writeCurrent(event.sessionId, "revision" in event ? event.revision : undefined);
  }

  writeSnapshot(sessionId: string, snapshot: unknown): void {
    fs.writeFileSync(
      this.snapshotPath(sessionId),
      JSON.stringify(snapshot, null, 2),
      "utf8",
    );
  }

  writeCurrent(sessionId: string, revision?: number): void {
    const payload = {
      latestSessionId: sessionId,
      revision: revision ?? null,
      updatedAt: new Date().toISOString(),
      sessionDir: this.dir,
      eventsPath: this.sessionPath(sessionId),
      actionsPath: this.actionsPath(sessionId),
      snapshotPath: this.snapshotPath(sessionId),
    };
    fs.writeFileSync(this.currentPath(), JSON.stringify(payload, null, 2), "utf8");
  }
}
