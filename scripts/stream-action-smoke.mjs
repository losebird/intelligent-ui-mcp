#!/usr/bin/env node
/**
 * Step ③ stream/action smoke:
 * 1) open → 5× ops upsert → 5 ui.delta + idle/done
 * 2) report_action → action_pending → ui_patch → idle (props changed)
 * 3) write actions.ndjson → drain → pending/action event
 * 4) G6: state.set tip → patch Label
 * 5) streaming_chunks simplified parse on chunkDone
 * 6) Host SSE /api/stream sees MCP-written events
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { startSessionApiServer } from "../apps/host-window/server/sessionApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverEntry = path.join(root, "packages/mcp-server/dist/index.js");
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "iui-stream-smoke-"));

function parseToolJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

function readEvents(sessionId) {
  const p = path.join(sessionDir, `${sessionId}.ndjson`);
  return fs
    .readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function findNode(tree, id) {
  if (!tree) return null;
  if (tree.id === id) return tree;
  for (const c of tree.children ?? []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  if (!fs.existsSync(serverEntry)) {
    console.error("Missing built server:", serverEntry);
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      IUI_SESSION_DIR: sessionDir,
      IUI_ACTION_TIMEOUT_MS: "60000",
    },
  });

  const client = new Client({ name: "iui-stream-smoke", version: "0.1.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  console.log("tools:", names.join(", "));
  for (const r of [
    "ui_patch",
    "ui_report_action",
    "ui_drain_actions",
    "ui_get_pending_actions",
  ]) {
    assert(names.includes(r), `Missing tool: ${r}`);
  }

  // --- 1) open + skeleton root via ops replace_tree, then 5 upserts ---
  const opened = parseToolJson(
    await client.callTool({
      name: "ui_open",
      arguments: { title: "stream-smoke", initialState: { tipPercent: 10 } },
    }),
  );
  assert(opened.ok, "ui_open failed: " + JSON.stringify(opened));
  const sessionId = opened.sessionId;
  console.log("sessionId:", sessionId);

  const rootPropose = parseToolJson(
    await client.callTool({
      name: "ui_propose",
      arguments: {
        sessionId,
        mode: "ops",
        chunkDone: false,
        ops: [
          {
            op: "replace_tree",
            tree: {
              id: "root",
              type: "catalog.base/Stack",
              props: { direction: "vertical", gap: 8 },
              children: [],
            },
          },
        ],
      },
    }),
  );
  assert(rootPropose.ok, "root ops failed: " + JSON.stringify(rootPropose));
  assert(rootPropose.status === "streaming", "expected streaming after chunkDone:false");

  const labels = ["A", "B", "C", "D", "E"];
  for (let i = 0; i < 5; i++) {
    const done = i === 4;
    const r = parseToolJson(
      await client.callTool({
        name: "ui_propose",
        arguments: {
          sessionId,
          mode: "ops",
          chunkDone: done,
          ops: [
            {
              op: "upsert",
              parentId: "root",
              nodeId: `n_${labels[i]}`,
              node: {
                id: `n_${labels[i]}`,
                type: "catalog.base/Markdown",
                props: { text: `## Item ${labels[i]}` },
              },
            },
          ],
        },
      }),
    );
    assert(r.ok, `upsert ${i} failed: ` + JSON.stringify(r));
    console.log(`upsert ${labels[i]} revision=${r.revision} status=${r.status}`);
  }

  let events = readEvents(sessionId);
  const deltas = events.filter((e) => e.type === "ui.delta");
  assert(deltas.length >= 5, `expected >=5 ui.delta, got ${deltas.length}`);
  // root + 5 upserts = 6 deltas if root counted; at least 5 from upserts
  const upsertDeltas = deltas.filter((e) =>
    (e.ops ?? []).some((o) => o.op === "upsert"),
  );
  assert(upsertDeltas.length === 5, `expected 5 upsert deltas, got ${upsertDeltas.length}`);
  assert(
    upsertDeltas.every((e, i) => e.revision === i + 2), // rev1=root, then 2..6
    "revisions not strictly increasing as expected",
  );

  let state = parseToolJson(
    await client.callTool({ name: "ui_get_state", arguments: { sessionId } }),
  );
  assert(state.ok && state.status === "idle", "expected idle after final chunkDone");
  assert(state.tree?.children?.length === 5, "expected 5 children on root");
  console.log("phase1 OK: 5 upserts → idle, revision=", state.revision);

  // --- 2) report_action → patch props ---
  // First add a badge + slider for G6
  const setup = parseToolJson(
    await client.callTool({
      name: "ui_propose",
      arguments: {
        sessionId,
        mode: "ops",
        ops: [
          {
            op: "upsert",
            parentId: "root",
            node: {
              id: "tip",
              type: "catalog.shadcn/Slider",
              props: { label: "小费 %", min: 0, max: 30, value: 10 },
              bind: "tipPercent",
              actions: {
                onChange: {
                  actionType: "state.set",
                  payload: { path: "tipPercent" },
                },
              },
            },
          },
          {
            op: "upsert",
            parentId: "root",
            node: {
              id: "total",
              type: "catalog.shadcn/Badge",
              props: { text: "合计 ¥100" },
            },
          },
        ],
      },
    }),
  );
  assert(setup.ok, "setup tip/total failed: " + JSON.stringify(setup));

  const reported = parseToolJson(
    await client.callTool({
      name: "ui_report_action",
      arguments: {
        sessionId,
        action: {
          type: "state.set",
          nodeId: "tip",
          path: "tipPercent",
          value: 20,
          componentType: "catalog.shadcn/Slider",
        },
      },
    }),
  );
  assert(reported.ok, "report_action failed: " + JSON.stringify(reported));
  assert(reported.status === "action_pending", "expected action_pending");
  assert(reported.state.tipPercent === 20, "state.tipPercent should be 20");
  console.log("report_action OK:", reported.actionId);

  const patched = parseToolJson(
    await client.callTool({
      name: "ui_patch",
      arguments: {
        sessionId,
        ops: [
          {
            op: "patch_props",
            nodeId: "total",
            props: { text: "合计 ¥120" },
          },
        ],
      },
    }),
  );
  assert(patched.ok, "ui_patch failed: " + JSON.stringify(patched));
  assert(patched.status === "idle", "expected idle after patch");

  state = parseToolJson(
    await client.callTool({ name: "ui_get_state", arguments: { sessionId } }),
  );
  const totalNode = findNode(state.tree, "total");
  assert(totalNode?.props?.text === "合计 ¥120", "total label not updated");
  console.log("phase2 OK: action → patch Label");

  // --- 3) Host actions.ndjson bypass → watch ingest + drain ---
  const actionsPath = path.join(sessionDir, `${sessionId}.actions.ndjson`);
  const bypassActionId = "a_bypass_smoke_001";
  fs.appendFileSync(
    actionsPath,
    JSON.stringify({
      actionId: bypassActionId,
      sessionId,
      ts: new Date().toISOString(),
      action: {
        type: "click",
        nodeId: "n_A",
        componentType: "catalog.base/Markdown",
        payload: { intent: "host_click" },
      },
    }) + "\n",
  );

  // Give watcher a moment; drain polls synchronously
  await new Promise((r) => setTimeout(r, 300));

  const drained = parseToolJson(
    await client.callTool({
      name: "ui_drain_actions",
      arguments: { sessionId },
    }),
  );
  assert(drained.ok, "drain failed: " + JSON.stringify(drained));
  const ids = drained.actions.map((a) => a.actionId);
  assert(
    ids.includes(bypassActionId) || drained.lastActionId === bypassActionId,
    "bypass action not seen: " + JSON.stringify(drained),
  );
  console.log("phase3 OK: actions.ndjson → drain", { count: drained.count, ids });

  events = readEvents(sessionId);
  const actionEvents = events.filter((e) => e.type === "ui.action");
  assert(actionEvents.length >= 2, "expected >=2 ui.action events");
  assert(
    actionEvents.some((e) => e.actionId === bypassActionId),
    "ui.action for bypass missing",
  );

  // duplicate actionId should be ignored
  fs.appendFileSync(
    actionsPath,
    JSON.stringify({
      actionId: bypassActionId,
      action: { type: "click", nodeId: "n_A" },
    }) + "\n",
  );
  await new Promise((r) => setTimeout(r, 250));
  const drained2 = parseToolJson(
    await client.callTool({
      name: "ui_drain_actions",
      arguments: { sessionId },
    }),
  );
  assert(drained2.ok, "drain2 failed");
  assert(
    !drained2.actions.some((a) => a.actionId === bypassActionId && !a.drained),
    "duplicate should not reappear as new pending",
  );
  console.log("phase3b OK: actionId dedupe");

  // --- 4) streaming_chunks simplified ---
  const opened2 = parseToolJson(
    await client.callTool({
      name: "ui_open",
      arguments: { title: "chunk-smoke" },
    }),
  );
  assert(opened2.ok, "open2 failed");
  const sid2 = opened2.sessionId;

  const treeJson = JSON.stringify({
    id: "root",
    type: "catalog.base/Stack",
    props: { direction: "vertical", gap: 4 },
    children: [
      {
        id: "m1",
        type: "catalog.base/Markdown",
        props: { text: "from chunks" },
      },
    ],
  });
  const half = Math.floor(treeJson.length / 2);
  const c1 = parseToolJson(
    await client.callTool({
      name: "ui_propose",
      arguments: {
        sessionId: sid2,
        mode: "streaming_chunks",
        chunk: treeJson.slice(0, half),
        chunkIndex: 0,
        chunkDone: false,
      },
    }),
  );
  assert(c1.ok, "chunk1 failed: " + JSON.stringify(c1));
  assert(c1.status === "streaming", "expected streaming while buffering");

  const c2 = parseToolJson(
    await client.callTool({
      name: "ui_propose",
      arguments: {
        sessionId: sid2,
        mode: "streaming_chunks",
        chunk: treeJson.slice(half),
        chunkIndex: 1,
        chunkDone: true,
      },
    }),
  );
  assert(c2.ok, "chunkDone failed: " + JSON.stringify(c2));
  assert(c2.status === "idle", "expected idle after chunkDone parse");
  const st2 = parseToolJson(
    await client.callTool({ name: "ui_get_state", arguments: { sessionId: sid2 } }),
  );
  assert(st2.tree?.children?.[0]?.props?.text === "from chunks", "chunk tree missing");
  console.log("phase4 OK: streaming_chunks parse on chunkDone");


  // --- phase5: Host SSE receives MCP-written session events ---
  const hostToken = `stream_sse_${randomBytes(8).toString("hex")}`;
  const api = await startSessionApiServer({ sessionDir, port: 0, hostToken });
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const res = await fetch(`http://127.0.0.1:${api.port}/api/stream?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: {
        Authorization: `Bearer ${hostToken}`,
        "X-IUI-Host-Token": hostToken,
        Accept: "text/event-stream",
      },
      signal: ac.signal,
    });
    assert(res.ok, `SSE status ${res.status}`);
    assert(String(res.headers.get("content-type") || "").includes("text/event-stream"), "SSE content-type");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let sawUi = false;
    let sawSnap = false;
    let sawReady = false;
    while (!(sawUi && sawSnap && sawReady)) {
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
        if (event === "ready") sawReady = true;
        if (event === "snapshot") sawSnap = true;
        if (event === "ui") sawUi = true;
        if (sawUi && sawSnap && sawReady) break;
      }
    }
    clearTimeout(timer);
    ac.abort();
    try { await reader.cancel(); } catch { /* ignore */ }
    assert(sawReady && sawSnap && sawUi, `SSE frames incomplete ready=${sawReady} snap=${sawSnap} ui=${sawUi}`);
    console.log("phase5 OK: Host SSE stream sees MCP session");
  } finally {
    await api.close();
  }

  // closed write should fail
  await client.callTool({
    name: "ui_close",
    arguments: { sessionId: sid2, reason: "completed" },
  });
  const closedPatch = parseToolJson(
    await client.callTool({
      name: "ui_patch",
      arguments: {
        sessionId: sid2,
        ops: [{ op: "patch_props", nodeId: "m1", props: { text: "nope" } }],
      },
    }),
  );
  assert(!closedPatch.ok && closedPatch.error?.code === "SESSION_CLOSED", "closed write should fail");

  await client.callTool({
    name: "ui_close",
    arguments: { sessionId, reason: "completed" },
  });
  await client.close();
  console.log("STREAM_SMOKE_OK", { sessionDir, sessionId, sid2 });
}

main().catch((err) => {
  console.error("STREAM_SMOKE_FAIL", err);
  process.exit(1);
});
