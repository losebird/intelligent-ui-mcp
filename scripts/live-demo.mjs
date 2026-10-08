#!/usr/bin/env node
/**
 * True MCP live demo (stdio → real mcp-server), NOT a hand-written snapshot.
 *
 * 1) Spawn packages/mcp-server/dist/index.js over MCP stdio
 * 2) ui_open → ui_propose (tip calculator + LineChart)
 * 3) Assert NDJSON / snapshot / current were written by the server
 * 4) POST /api/action via session API (same path Host uses) → actions.ndjson
 * 5) Optionally leave files in $HOME/.intelligent-ui-mcp/live-demo for Host
 *
 * Usage:
 *   node scripts/live-demo.mjs
 *   IUI_SESSION_DIR=... node scripts/live-demo.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startSessionApiServer,
  actionsPath,
  appendAction,
} from "../apps/host-window/server/sessionApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverEntry = path.join(root, "packages/mcp-server/dist/index.js");

const sessionDir =
  process.env.IUI_SESSION_DIR ??
  path.join(os.homedir(), ".intelligent-ui-mcp", "live-demo");

function parseToolJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function mtimeMs(p) {
  return fs.statSync(p).mtimeMs;
}

async function main() {
  if (!fs.existsSync(serverEntry)) {
    console.error("Missing built server:", serverEntry, "— run npm run build first");
    process.exit(1);
  }

  fs.rmSync(sessionDir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  console.log("IUI_SESSION_DIR:", sessionDir);
  console.log("mcp-server:", serverEntry);

  const before = Date.now();

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      IUI_SESSION_DIR: sessionDir,
    },
  });

  const client = new Client({ name: "iui-live-demo", version: "0.1.0" });
  await client.connect(transport);
  console.log("MCP connected (stdio)");

  const opened = parseToolJson(
    await client.callTool({
      name: "ui_open",
      arguments: {
        title: "live-demo tip + chart",
        density: "full",
        initialState: { bill: "120", tipPercent: 15, people: "3" },
      },
    }),
  );
  assert(opened.ok, "ui_open failed: " + JSON.stringify(opened));
  const sessionId = opened.sessionId;
  console.log("sessionId:", sessionId);
  console.log("eventsPath (from MCP):", opened.eventsPath);

  const tree = {
    id: "root",
    type: "catalog.base/Stack",
    props: { direction: "vertical", gap: 16 },
    children: [
      {
        id: "title",
        type: "catalog.base/Markdown",
        props: {
          text: "## Intelligent UI **真 MCP** 联调\n本树由 stdio `ui_propose` 写出，不是手写 snapshot。",
        },
      },
      {
        id: "card",
        type: "catalog.shadcn/Card",
        props: { title: "小费计算器" },
        children: [
          {
            id: "bill",
            type: "catalog.shadcn/Input",
            props: { label: "账单金额", value: "120", inputType: "number" },
            bind: "bill",
          },
          {
            id: "tip",
            type: "catalog.shadcn/Slider",
            props: { label: "小费 %", min: 0, max: 30, step: 1, value: 15 },
            bind: "tipPercent",
          },
          {
            id: "people",
            type: "catalog.shadcn/Input",
            props: { label: "人数", value: "3", inputType: "number" },
            bind: "people",
          },
          {
            id: "total",
            type: "catalog.shadcn/Badge",
            props: { text: "人均约 ¥46.00（含小费）" },
          },
          {
            id: "yes",
            type: "catalog.shadcn/Button",
            props: { label: "满意", variant: "default" },
            actions: {
              onClick: { actionType: "submit", payload: { intent: "satisfied" } },
            },
          },
          {
            id: "go",
            type: "catalog.shadcn/Button",
            props: { label: "重新计算", variant: "outline" },
            actions: {
              onClick: { actionType: "click", payload: { intent: "recalc" } },
            },
          },
        ],
      },
      {
        id: "chart",
        type: "catalog.charts/LineChart",
        props: {
          title: "Q1–Q4 营收示意",
          data: [
            { x: "Q1", y: 42 },
            { x: "Q2", y: 55 },
            { x: "Q3", y: 48 },
            { x: "Q4", y: 70 },
          ],
          xKey: "x",
          yKey: "y",
        },
      },
    ],
  };

  // Ensure charts package is enabled for LineChart
  await client.callTool({
    name: "set_enabled_packages",
    arguments: {
      packageIds: ["catalog.base", "catalog.shadcn", "catalog.charts"],
    },
  });

  const proposed = parseToolJson(
    await client.callTool({
      name: "ui_propose",
      arguments: { sessionId, mode: "tree", tree },
    }),
  );
  assert(proposed.ok, "ui_propose failed: " + JSON.stringify(proposed));
  console.log("propose revision:", proposed.revision, "decision:", proposed.decision);

  const eventsFile = path.join(sessionDir, `${sessionId}.ndjson`);
  const snapshotFile = path.join(sessionDir, `${sessionId}.snapshot.json`);
  const currentFile = path.join(sessionDir, "current.json");

  assert(fs.existsSync(eventsFile), "MCP did not write events ndjson");
  assert(fs.existsSync(snapshotFile), "MCP did not write snapshot");
  assert(fs.existsSync(currentFile), "MCP did not write current.json");
  assert(mtimeMs(eventsFile) >= before - 1000, "events mtime predates this run");
  assert(mtimeMs(snapshotFile) >= before - 1000, "snapshot mtime predates this run");

  const snap = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
  assert(snap.sessionId === sessionId, "snapshot sessionId mismatch");
  assert(snap.tree?.id === "root", "snapshot missing tree");
  assert(
    JSON.stringify(snap.tree).includes("catalog.charts/LineChart"),
    "snapshot missing LineChart",
  );

  const eventTypes = fs
    .readFileSync(eventsFile, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).type);
  console.log("events:", eventTypes.join(" → "));
  assert(eventTypes.includes("ui.open"), "missing ui.open");
  assert(
    eventTypes.includes("ui.replace") || eventTypes.includes("ui.done"),
    "missing ui.replace/ui.done",
  );

  const current = JSON.parse(fs.readFileSync(currentFile, "utf8"));
  assert(current.latestSessionId === sessionId, "current.json not pointing at session");

  // Prove Host POST path against the same session dir (no hand-written actions).
  const api = await startSessionApiServer({ sessionDir, port: 0 });
  const actionId = `a_live_${Date.now().toString(36)}`;
  const postOnce = async (id) => {
    const res = await fetch(`http://127.0.0.1:${api.port}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionId: id,
        sessionId,
        type: "submit",
        nodeId: "yes",
        componentType: "catalog.shadcn/Button",
        payload: { intent: "satisfied" },
        ts: new Date().toISOString(),
      }),
    });
    return res.json();
  };

  const r1 = await postOnce(actionId);
  assert(r1.ok && !r1.duplicate, "first action post failed: " + JSON.stringify(r1));
  const r2 = await postOnce(actionId);
  assert(r2.ok && r2.duplicate, "idempotent duplicate expected: " + JSON.stringify(r2));

  const actionsFile = actionsPath(sessionDir, sessionId);
  assert(fs.existsSync(actionsFile), "actions.ndjson not written");
  const actionLines = fs
    .readFileSync(actionsFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  assert(actionLines.length === 1, `expected 1 action line, got ${actionLines.length}`);
  console.log("actions.ndjson:", actionsFile);
  console.log("action line:", actionLines[0]);

  // Also exercise appendAction helper directly (same as middleware)
  const direct = appendAction(sessionDir, {
    actionId: `${actionId}_b`,
    sessionId,
    type: "click",
    nodeId: "go",
    componentType: "catalog.shadcn/Button",
    payload: { intent: "recalc" },
  });
  assert(direct.ok, "direct appendAction failed");

  await api.close();

  // Leave session open for Host (do not ui_close)
  await client.close();

  console.log(
    "LIVE_OK",
    JSON.stringify(
      {
        sessionDir,
        sessionId,
        revision: proposed.revision,
        eventsFile,
        snapshotFile,
        currentFile,
        actionsFile,
        source: "mcp-stdio ui_open+ui_propose (not hand-written snapshot)",
        hostHint: `IUI_SESSION_DIR=${sessionDir} npm run host`,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("LIVE_FAIL", err);
  process.exit(1);
});
