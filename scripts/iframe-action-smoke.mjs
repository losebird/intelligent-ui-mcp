#!/usr/bin/env node
/**
 * Iframe action alignment + data-vs-render smoke (no browser):
 * 1) Static: sandbox protocol has action_ack; slot filters requestId; bootstrap flattenAction
 * 2) normalizeRenderAction accepts flat + nested
 * 3) Host API: flat + nested POST /api/action → same shape in actions.ndjson
 * 4) MCP: propose tree → patch_props keeps node.id; replace_tree warns REMOUNT_RISK
 * 5) drain sees source=host
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startSessionApiServer } from "../apps/host-window/server/sessionApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverEntry = path.join(root, "packages/mcp-server/dist/index.js");
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "iui-iframe-action-"));
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseToolJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

function authHeaders(token, extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${token}`,
    "X-IUI-Host-Token": token,
  };
}

async function main() {
  if (!fs.existsSync(serverEntry)) {
    console.error("Missing built server — run npm run build first");
    process.exit(1);
  }

  // —— static protocol / slot ——
  const protocolSrc = fs.readFileSync(
    path.join(root, "apps/host-window/src/sandbox/protocol.ts"),
    "utf8",
  );
  assert(protocolSrc.includes("action_ack"), "protocol missing action_ack");
  assert(protocolSrc.includes("normalizeSandboxAction"), "normalizeSandboxAction missing");
  const slotSrc = fs.readFileSync(
    path.join(root, "apps/host-window/src/sandbox/SandboxedCustomSlot.tsx"),
    "utf8",
  );
  assert(slotSrc.includes("requestId !== requestId") || slotSrc.includes("data.requestId !== requestId"), "slot must filter requestId");
  assert(/sandbox=["']allow-scripts["']/.test(slotSrc), "sandbox allow-scripts only");
  assert(!/allow-same-origin/.test(slotSrc), "must not allow-same-origin");
  const bootSrc = fs.readFileSync(
    path.join(root, "apps/host-window/src/sandbox/bootstrapSrcdoc.ts"),
    "utf8",
  );
  assert(bootSrc.includes("flattenAction"), "bootstrap must flattenAction");
  assert(bootSrc.includes("action_ack"), "bootstrap must handle action_ack");
  const appSrc = fs.readFileSync(path.join(root, "apps/host-window/src/App.tsx"), "utf8");
  assert(appSrc.includes("iui.host.v1"), "Host bubble channel iui.host.v1");
  console.log("static iframe/action checks ok");

  // —— normalizeRenderAction (built dist) ——
  const normPath = path.join(root, "packages/renderer-react/dist/actionNormalize.js");
  assert(fs.existsSync(normPath), "build actionNormalize.js first");
  const { normalizeRenderAction } = await import(pathToFileURL(normPath).href);
  const flat = normalizeRenderAction({
    type: "equals",
    nodeId: "c1",
    componentType: "catalog.shadcn/Calculator",
    value: "42",
    payload: { expression: "6*7" },
  });
  assert(flat && flat.type === "equals" && flat.value === "42", "flat normalize");
  const nested = normalizeRenderAction({
    actionId: "a_x",
    action: {
      type: "press",
      nodeId: "c1",
      componentType: "catalog.shadcn/Calculator",
      payload: { key: "7" },
    },
  });
  assert(nested && nested.type === "press" && nested.payload.key === "7", "nested normalize");
  assert(normalizeRenderAction({}) === null, "empty → null");
  console.log("normalizeRenderAction ok");

  const hostToken = `iframe_${randomBytes(16).toString("hex")}`;
  process.env.IUI_HOST_TOKEN = hostToken;

  const api = await startSessionApiServer({
    sessionDir,
    hostToken,
    port: 0,
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      IUI_SESSION_DIR: sessionDir,
      IUI_AUTO_HOST: "0",
      IUI_AUTO_OPEN_BROWSER: "0",
      IUI_REPO_ROOT: root,
      IUI_HOST_TOKEN: hostToken,
    },
  });
  const client = new Client({ name: "iui-iframe-action-smoke", version: "0.1.0" });
  await client.connect(transport);

  const opened = parseToolJson(
    await client.callTool({
      name: "ui_open",
      arguments: { title: "iframe-action-smoke", density: "full" },
    }),
  );
  assert(opened.ok && opened.sessionId, "ui_open failed");
  const sessionId = opened.sessionId;

  const proposed = parseToolJson(
    await client.callTool({
      name: "ui_propose",
      arguments: {
        sessionId,
        mode: "tree",
        tree: {
          id: "root",
          type: "catalog.base/Stack",
          props: { direction: "vertical", gap: 8 },
          children: [
            {
              id: "calc1",
              type: "catalog.shadcn/Calculator",
              props: { title: "Smoke calc", expression: "0" },
            },
          ],
        },
      },
    }),
  );
  assert(proposed.ok, "ui_propose failed: " + JSON.stringify(proposed));

  // flat action
  const actionId1 = `a_flat_${randomBytes(4).toString("hex")}`;
  const flatRes = await fetch(`http://127.0.0.1:${api.port}/api/action`, {
    method: "POST",
    headers: authHeaders(hostToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      actionId: actionId1,
      sessionId,
      type: "equals",
      nodeId: "calc1",
      componentType: "catalog.shadcn/Calculator",
      value: "3",
      payload: { expression: "1+2", result: "3" },
      source: "host",
    }),
  });
  const flatJson = await flatRes.json();
  assert(flatJson.ok && flatJson.actionId === actionId1, "flat POST action");

  // nested action (legacy)
  const actionId2 = `a_nest_${randomBytes(4).toString("hex")}`;
  const nestRes = await fetch(`http://127.0.0.1:${api.port}/api/action`, {
    method: "POST",
    headers: authHeaders(hostToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      actionId: actionId2,
      sessionId,
      action: {
        type: "press",
        nodeId: "calc1",
        componentType: "catalog.shadcn/Calculator",
        payload: { key: "9" },
      },
    }),
  });
  const nestJson = await nestRes.json();
  assert(nestJson.ok && nestJson.actionId === actionId2, "nested POST action");

  // duplicate idempotent
  const dup = await fetch(`http://127.0.0.1:${api.port}/api/action`, {
    method: "POST",
    headers: authHeaders(hostToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      actionId: actionId1,
      sessionId,
      type: "equals",
      nodeId: "calc1",
      componentType: "catalog.shadcn/Calculator",
    }),
  });
  const dupJson = await dup.json();
  assert(dupJson.ok && dupJson.duplicate === true, "duplicate actionId");

  const actionsFile = path.join(sessionDir, `${sessionId}.actions.ndjson`);
  assert(fs.existsSync(actionsFile), "actions.ndjson missing");
  const lines = fs
    .readFileSync(actionsFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  assert(lines.length === 2, `expected 2 action lines, got ${lines.length}`);
  assert(lines.every((l) => l.source === "host"), "source=host on lines");
  assert(
    lines.every((l) => typeof l.type === "string" && l.nodeId === "calc1"),
    "flat canonical fields",
  );
  console.log("Host action flat/nested/idempotent ok");

  // Data tool: patch_props keeps id
  const patched = parseToolJson(
    await client.callTool({
      name: "ui_patch",
      arguments: {
        sessionId,
        ops: [
          {
            op: "patch_props",
            nodeId: "calc1",
            props: { expression: "1+2", result: "3" },
          },
        ],
        statePatch: { lastResult: "3" },
      },
    }),
  );
  assert(patched.ok, "ui_patch failed: " + JSON.stringify(patched));
  const remountOnPatch = (patched.warnings || []).filter((w) =>
    String(w).includes("REMOUNT_RISK"),
  );
  assert(
    remountOnPatch.length === 0,
    "patch_props should not warn REMOUNT_RISK: " + JSON.stringify(remountOnPatch),
  );

  const state = parseToolJson(
    await client.callTool({
      name: "ui_get_state",
      arguments: { sessionId, includeTree: true, includeState: true },
    }),
  );
  assert(state.ok && state.tree, "get_state");
  const calc = (state.tree.children || []).find((c) => c.id === "calc1");
  assert(calc && calc.id === "calc1", "calc1 id preserved");
  assert(calc.props?.expression === "1+2", "expression patched");
  assert(state.state?.lastResult === "3", "statePatch applied");
  console.log("data patch keeps node.id ok");

  // Render rebuild should warn
  const rebuilt = parseToolJson(
    await client.callTool({
      name: "ui_propose",
      arguments: {
        sessionId,
        mode: "tree",
        tree: {
          id: "root2",
          type: "catalog.base/Stack",
          children: [
            {
              id: "calc_NEW",
              type: "catalog.shadcn/Calculator",
              props: { expression: "0" },
            },
          ],
        },
      },
    }),
  );
  assert(rebuilt.ok, "rebuild propose failed");
  const risks = (rebuilt.warnings || []).filter((w) => String(w).includes("REMOUNT_RISK"));
  assert(risks.length >= 1, "expected REMOUNT_RISK on replace_tree rebuild");
  console.log("REMOUNT_RISK warning ok");

  await client.close().catch(() => {});
  await api.close();

  console.log("IFRAME_ACTION_SMOKE_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
