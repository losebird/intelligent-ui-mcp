#!/usr/bin/env node
/**
 * Host ② API smoke (no browser):
 * 1) temp IUI_SESSION_DIR + sample snapshot/ndjson/current
 * 2) start session API server with shared token
 * 3) GET current + snapshot tree (with token)
 * 4) POST action → actions.ndjson (idempotent on actionId)
 * 5) unauthenticated reads/writes → 401
 * 6) CORS: disallowed Origin → 403
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
    });
  } finally {
    await api.close();
  }
}

main().catch((err) => {
  console.error("HOST_SMOKE_FAIL", err);
  process.exit(1);
});
