/**
 * Server-Sent Events push for Host session files.
 * Pushes current / snapshot / ui events / actions to authenticated clients.
 * Uses short poll + fs.watch (watch alone is flaky across platforms).
 */
import fs from "node:fs";
import path from "node:path";

function readJsonFile(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readNdjson(filePath, since = 0) {
  if (!fs.existsSync(filePath)) {
    return { lines: [], nextOffset: 0, totalLines: 0 };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const all = raw.length ? raw.replace(/\n$/, "").split("\n") : [];
  const slice = all.slice(Math.max(0, since));
  const lines = [];
  for (const line of slice) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      lines.push({ type: "parse_error", raw: line });
    }
  }
  return { lines, nextOffset: all.length, totalLines: all.length };
}

function currentPath(dir) {
  return path.join(dir, "current.json");
}
function snapshotPath(dir, sessionId) {
  return path.join(dir, `${sessionId}.snapshot.json`);
}
function eventsPath(dir, sessionId) {
  return path.join(dir, `${sessionId}.ndjson`);
}
function actionsPath(dir, sessionId) {
  return path.join(dir, `${sessionId}.actions.ndjson`);
}

export function writeSse(res, event, data) {
  if (res.writableEnded) return;
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

export function writeSseComment(res, text) {
  if (res.writableEnded) return;
  res.write(`: ${text}\n\n`);
}

/**
 * Attach an SSE session stream to an already-authenticated response.
 * Caller must set SSE headers before calling.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{
 *   sessionDir: string,
 *   pinnedSessionId?: string | null,
 *   eventsSince?: number,
 *   includeSnapshot?: boolean,
 *   includeActions?: boolean,
 *   pollMs?: number,
 *   heartbeatMs?: number,
 * }} opts
 * @returns {{ close: () => void }}
 */
export function attachSessionSse(res, opts) {
  const dir = opts.sessionDir;
  const pinned = opts.pinnedSessionId?.trim() || null;
  const includeSnapshot = opts.includeSnapshot !== false;
  const includeActions = opts.includeActions !== false;
  const pollMs = Math.max(40, opts.pollMs ?? 80);
  const heartbeatMs = Math.max(5000, opts.heartbeatMs ?? 15000);
  const initialEventsSince = Math.max(0, Number(opts.eventsSince) || 0);

  let closed = false;
  let eventsOffset = initialEventsSince;
  let lastSessionId = "";
  let lastRevision = -1;
  let lastCurrentRaw = "";
  let lastActionsOffset = 0;
  let timer = null;
  let heartbeat = null;
  /** @type {fs.FSWatcher | null} */
  let watcher = null;

  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    try {
      watcher?.close();
    } catch {
      /* ignore */
    }
    watcher = null;
  };

  const schedule = (immediate = false) => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, immediate ? 0 : pollMs);
  };

  const tick = () => {
    if (closed || res.writableEnded) {
      close();
      return;
    }
    try {
      const curFile = currentPath(dir);
      const current = readJsonFile(curFile, null);
      let curRaw = "";
      try {
        curRaw = fs.existsSync(curFile) ? fs.readFileSync(curFile, "utf8") : "";
      } catch {
        curRaw = "";
      }
      if (curRaw !== lastCurrentRaw) {
        lastCurrentRaw = curRaw;
        writeSse(res, "current", {
          ok: true,
          sessionDir: dir,
          current,
        });
      }

      const sid =
        pinned ||
        (current && typeof current.latestSessionId === "string"
          ? current.latestSessionId
          : "");

      if (!sid) {
        if (lastSessionId) {
          lastSessionId = "";
          eventsOffset = initialEventsSince;
          lastRevision = -1;
          lastActionsOffset = 0;
          writeSse(res, "session", { sessionId: null, reason: "cleared" });
        }
        schedule();
        return;
      }

      if (sid !== lastSessionId) {
        lastSessionId = sid;
        eventsOffset = initialEventsSince;
        lastRevision = -1;
        lastActionsOffset = 0;
        writeSse(res, "session", { sessionId: sid, reason: "switch" });
      }

      if (includeSnapshot) {
        const snap = readJsonFile(snapshotPath(dir, sid), null);
        const rev =
          snap && typeof snap.revision === "number" ? snap.revision : null;
        if (snap && rev !== null && rev !== lastRevision) {
          lastRevision = rev;
          writeSse(res, "snapshot", {
            ok: true,
            sessionId: sid,
            snapshot: snap,
          });
        }
      }

      const ev = readNdjson(eventsPath(dir, sid), eventsOffset);
      for (const line of ev.lines) {
        writeSse(res, "ui", line);
        if (
          (line?.type === "ui.delta" || line?.type === "ui.replace") &&
          typeof line.revision === "number"
        ) {
          lastRevision = Math.max(lastRevision, line.revision);
        }
      }
      eventsOffset = ev.nextOffset;

      if (includeActions) {
        const act = readNdjson(actionsPath(dir, sid), lastActionsOffset);
        for (const line of act.lines) {
          writeSse(res, "action", line);
        }
        lastActionsOffset = act.nextOffset;
      }
    } catch (err) {
      writeSse(res, "error", {
        ok: false,
        error: "SSE_TICK",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    schedule();
  };

  writeSse(res, "ready", {
    ok: true,
    sessionDir: dir,
    transport: "sse",
    pollMs,
    pinnedSessionId: pinned,
  });

  try {
    fs.mkdirSync(dir, { recursive: true });
    watcher = fs.watch(dir, { persistent: false }, () => schedule(true));
  } catch {
    watcher = null;
  }

  heartbeat = setInterval(() => {
    writeSseComment(res, `ping ${new Date().toISOString()}`);
    writeSse(res, "ping", { ts: new Date().toISOString() });
  }, heartbeatMs);

  schedule(true);

  res.on("close", close);
  res.on("error", close);

  return { close };
}
