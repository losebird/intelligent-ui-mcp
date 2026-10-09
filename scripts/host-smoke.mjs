#!/usr/bin/env node
/**
 * Host ② API smoke (no browser):
 * 1) temp IUI_SESSION_DIR + sample snapshot/ndjson/current
 * 2) start session API server with shared token
 * 3) GET current + snapshot tree (with token)
 * 4) POST action → actions.ndjson (idempotent on actionId)
 * 5) unauthenticated reads/writes → 401
 * 6) CORS: disallowed Origin → 403
 * 7) SSE GET /api/stream: auth + ready/current/snapshot/ui + live push
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  startSessionApiServer,
  actionsPath,
  appendAction,
} from "../apps/host-window/server/sessionApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function authHeaders(token, extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${token}`,
    "X-IUI-Host-Token": token,
  };
}

async function readSseUntil(url, headers, pred, timeoutMs = 4000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const res = await fetch(url, {
    headers: { ...headers, Accept: "text/event-stream" },
    signal: ac.signal,
  });
  if (!res.ok) {
    clearTimeout(timer);
    throw new Error(`SSE HTTP ${res.status}`);
  }
  assert(
    String(res.headers.get("content-type") || "").includes("text/event-stream"),
    "content-type text/event-stream",
  );
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        let event = "message";
        const dataLines = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (!dataLines.length) continue;
        let data;
        try {
          data = JSON.parse(dataLines.join("\n"));
        } catch {
          data = dataLines.join("\n");
        }
        events.push({ event, data });
        if (pred(events)) {
          clearTimeout(timer);
          ac.abort();
          try { await reader.cancel(); } catch { /* ignore */ }
          return events;
        }
      }
    }
  } catch (e) {
    if (e?.name === "AbortError" && events.length) {
      clearTimeout(timer);
      return events;
    }
    clearTimeout(timer);
    throw e;
  }
  clearTimeout(timer);
  return events;
}


async function main() {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "iui-host-smoke-"));
  const sessionId = "s_hostsmoke001";
  const hostToken = `smoke_${randomBytes(16).toString("hex")}`;
  process.env.IUI_HOST_TOKEN = hostToken;

  const tree = {
    id: "root",
    type: "catalog.base/Stack",
    props: { direction: "vertical", gap: 12 },
    children: [
      {
        id: "t1",
        type: "catalog.base/Markdown",
        props: { text: "## Host smoke" },
      },
      {
        id: "go",
        type: "catalog.shadcn/Button",
        props: { label: "确认" },
        actions: {
          onClick: { actionType: "submit", payload: { intent: "ok" } },
        },
      },
      {
        id: "unk",
        type: "catalog.custom/NoSuch",
        props: {},
      },
    ],
  };

  const snapshot = {
    protocolVersion: "0.1",
    sessionId,
    status: "idle",
    revision: 2,
    tree,
    state: { tipPercent: 15 },
    partial: false,
    title: "host-smoke",
    density: "full",
    preferPlainText: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActionId: null,
    lastError: null,
  };

  fs.writeFileSync(
    path.join(sessionDir, `${sessionId}.snapshot.json`),
    JSON.stringify(snapshot, null, 2),
  );
  fs.writeFileSync(
    path.join(sessionDir, `${sessionId}.ndjson`),
    [
      JSON.stringify({
        protocolVersion: "0.1",
        type: "ui.open",
        sessionId,
        ts: new Date().toISOString(),
        state: {},
      }),
      JSON.stringify({
        protocolVersion: "0.1",
        type: "ui.replace",
        sessionId,
        ts: new Date().toISOString(),
        revision: 2,
        partial: false,
        tree,
      }),
      JSON.stringify({
        protocolVersion: "0.1",
        type: "ui.done",
        sessionId,
        ts: new Date().toISOString(),
        revision: 2,
      }),
    ].join("\n") + "\n",
  );
  fs.writeFileSync(path.join(sessionDir, `${sessionId}.actions.ndjson`), "");
  fs.writeFileSync(
    path.join(sessionDir, "current.json"),
    JSON.stringify(
      {
        latestSessionId: sessionId,
        revision: 2,
        updatedAt: new Date().toISOString(),
        sessionDir,
        eventsPath: path.join(sessionDir, `${sessionId}.ndjson`),
        actionsPath: path.join(sessionDir, `${sessionId}.actions.ndjson`),
        snapshotPath: path.join(sessionDir, `${sessionId}.snapshot.json`),
      },
      null,
      2,
    ),
  );

  process.env.IUI_SESSION_DIR = sessionDir;
  const api = await startSessionApiServer({ sessionDir, port: 0, hostToken });
  const base = `http://127.0.0.1:${api.port}`;
  console.log("HOST_SMOKE api", base, "sessionDir", sessionDir);

  try {
    // health stays public
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    assert(health.ok === true, "health failed");
    assert(health.sessionDir === sessionDir, "sessionDir mismatch");

    // no token → 401 on protected routes
    const unauthCur = await fetch(`${base}/api/current`);
    assert(unauthCur.status === 401, `expected 401 current, got ${unauthCur.status}`);
    const unauthSnap = await fetch(`${base}/api/snapshot/${sessionId}`);
    assert(unauthSnap.status === 401, `expected 401 snapshot, got ${unauthSnap.status}`);
    const unauthEv = await fetch(`${base}/api/events/${sessionId}?since=0`);
    assert(unauthEv.status === 401, `expected 401 events, got ${unauthEv.status}`);
    const unauthAct = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionId: "a_unauth",
        sessionId,
        type: "submit",
        nodeId: "go",
      }),
    });
    assert(unauthAct.status === 401, `expected 401 action, got ${unauthAct.status}`);
    console.log("HOST_SMOKE auth-deny OK");

    // CORS: evil Origin → 403
    const corsRes = await fetch(`${base}/api/current`, {
      headers: {
        ...authHeaders(hostToken),
        Origin: "https://evil.example",
      },
    });
    assert(corsRes.status === 403, `expected 403 CORS, got ${corsRes.status}`);
    const corsBody = await corsRes.json();
    assert(corsBody.error === "CORS_ORIGIN_DENIED", "CORS error code");
    console.log("HOST_SMOKE cors-deny OK");

    // loopback Origin allowed
    const loopOrigin = await fetch(`${base}/api/current`, {
      headers: {
        ...authHeaders(hostToken),
        Origin: "http://127.0.0.1:5173",
      },
    });
    assert(loopOrigin.status === 200, `loopback origin failed: ${loopOrigin.status}`);
    assert(
      loopOrigin.headers.get("access-control-allow-origin") === "http://127.0.0.1:5173",
      "ACAO loopback",
    );

    const cur = await fetch(`${base}/api/current`, {
      headers: authHeaders(hostToken),
    }).then((r) => r.json());
    assert(cur.ok && cur.current?.latestSessionId === sessionId, "current failed");
    assert(cur.current.revision === 2, "revision mismatch");

    const snap = await fetch(`${base}/api/snapshot/${sessionId}`, {
      headers: authHeaders(hostToken),
    }).then((r) => r.json());
    assert(snap.ok && snap.snapshot?.tree?.id === "root", "snapshot tree missing");
    assert(
      snap.snapshot.tree.children.some((c) => c.type === "catalog.shadcn/Button"),
      "Button node missing",
    );

    const events = await fetch(`${base}/api/events/${sessionId}?since=0`, {
      headers: authHeaders(hostToken),
    }).then((r) => r.json());
    assert(events.ok && events.lines.length >= 3, "events missing");
    const types = events.lines.map((e) => e.type);
    assert(types.includes("ui.open") && types.includes("ui.replace"), "event types");

    const actionId = "a_hostsmoke_click_1";
    const posted = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: authHeaders(hostToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        actionId,
        sessionId,
        type: "submit",
        nodeId: "go",
        componentType: "catalog.shadcn/Button",
        payload: { intent: "ok" },
        ts: new Date().toISOString(),
      }),
    }).then((r) => r.json());
    assert(posted.ok && posted.actionId === actionId, "post action failed");
    assert(!posted.duplicate, "first post should not be duplicate");

    const dup = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: authHeaders(hostToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        actionId,
        sessionId,
        type: "submit",
        nodeId: "go",
      }),
    }).then((r) => r.json());
    assert(dup.ok && dup.duplicate === true, "idempotent duplicate expected");

    // Substring-trap: actionId that would false-positive with includes()
    const trapId = "a_hostsmoke_click_1_extra";
    const trap = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: authHeaders(hostToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        actionId: trapId,
        sessionId,
        type: "click",
        nodeId: "go",
      }),
    }).then((r) => r.json());
    assert(trap.ok && !trap.duplicate, "trap id should not be treated as duplicate");

    // Direct helper idempotency (parsed NDJSON, not includes)
    const directDup = appendAction(sessionDir, {
      actionId: trapId,
      sessionId,
      type: "click",
      nodeId: "go",
    });
    assert(directDup.ok && directDup.duplicate === true, "direct appendAction dedupe");

    const aPath = actionsPath(sessionDir, sessionId);
    const actionLines = fs
      .readFileSync(aPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    assert(
      actionLines.length === 2,
      `expected 2 action lines, got ${actionLines.length}`,
    );
    const parsed = JSON.parse(actionLines[0]);
    assert(parsed.actionId === actionId, "actionId in file");
    assert(parsed.nodeId === "go", "nodeId in file");
    assert(parsed.type === "submit", "type in file");


    // --- SSE: GET /api/stream ---
    const unauthSse = await fetch(`${base}/api/stream`, {
      headers: { Accept: "text/event-stream" },
    });
    assert(unauthSse.status === 401, `expected 401 SSE, got ${unauthSse.status}`);
    try { unauthSse.body?.cancel(); } catch { /* ignore */ }

    const sseEvents = await readSseUntil(
      `${base}/api/stream`,
      authHeaders(hostToken),
      (evs) => {
        const kinds = new Set(evs.map((e) => e.event));
        return kinds.has("ready") && kinds.has("current") && kinds.has("snapshot") && kinds.has("ui");
      },
      5000,
    );
    const kinds = sseEvents.map((e) => e.event);
    assert(kinds.includes("ready"), "SSE missing ready");
    assert(kinds.includes("current"), "SSE missing current");
    assert(kinds.includes("snapshot"), "SSE missing snapshot");
    assert(kinds.includes("ui"), "SSE missing ui");
    const ready = sseEvents.find((e) => e.event === "ready");
    assert(ready?.data?.transport === "sse", "ready.transport");
    const uiTypes = sseEvents.filter((e) => e.event === "ui").map((e) => e.data?.type);
    assert(uiTypes.includes("ui.open"), "SSE ui.open");
    console.log("HOST_SMOKE sse-bootstrap OK", { frames: sseEvents.length });

    // Live push: append ui.delta and expect SSE ui event
    const live = await new Promise(async (resolve, reject) => {
      const ac = new AbortController();
      const timer = setTimeout(() => {
        ac.abort();
        reject(new Error("SSE live push timeout"));
      }, 5000);
      try {
        const res = await fetch(`${base}/api/stream?since=999999`, {
          headers: {
            ...authHeaders(hostToken),
            Accept: "text/event-stream",
          },
          signal: ac.signal,
        });
        assert(res.ok, `live SSE ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let sawReady = false;
        // After ready, append a new event line
        const ndjsonPath = path.join(sessionDir, `${sessionId}.ndjson`);
        const appendLine = () => {
          fs.appendFileSync(
            ndjsonPath,
            JSON.stringify({
              protocolVersion: "0.1",
              type: "ui.delta",
              sessionId,
              ts: new Date().toISOString(),
              revision: 3,
              partial: true,
              ops: [{ op: "upsert", node: { id: "live", type: "catalog.base/Markdown", props: { text: "sse-live" } } }],
            }) + "\n",
          );
          // bump current revision pointer
          const cur = JSON.parse(fs.readFileSync(path.join(sessionDir, "current.json"), "utf8"));
          cur.revision = 3;
          cur.updatedAt = new Date().toISOString();
          fs.writeFileSync(path.join(sessionDir, "current.json"), JSON.stringify(cur, null, 2));
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep;
          while ((sep = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            let event = "message";
            const dataLines = [];
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
            }
            if (!dataLines.length) continue;
            let data;
            try { data = JSON.parse(dataLines.join("\n")); } catch { data = null; }
            if (event === "ready" && !sawReady) {
              sawReady = true;
              setTimeout(appendLine, 50);
            }
            if (event === "ui" && data?.type === "ui.delta" && data?.revision === 3) {
              clearTimeout(timer);
              ac.abort();
              try { await reader.cancel(); } catch { /* ignore */ }
              resolve(data);
              return;
            }
          }
        }
      } catch (e) {
        if (e?.name === "AbortError") return;
        clearTimeout(timer);
        reject(e);
      }
    });
    assert(live?.type === "ui.delta" && live?.revision === 3, "live SSE ui.delta");
    console.log("HOST_SMOKE sse-live OK");


    const hostPkg = path.join(root, "apps/host-window/package.json");
    assert(fs.existsSync(hostPkg), "host-window package missing");
    const viteConfig = path.join(root, "apps/host-window/vite.config.ts");
    assert(fs.existsSync(viteConfig), "vite.config.ts missing");

    console.log("HOST_SMOKE_OK", {
      sessionDir,
      sessionId,
      port: api.port,
      actionsPath: aPath,
      actionLines: actionLines.length,
      auth: "bearer+header",
      sse: true,
    });
  } finally {
    await api.close();
  }
}

main().catch((err) => {
  console.error("HOST_SMOKE_FAIL", err);
  process.exit(1);
});
