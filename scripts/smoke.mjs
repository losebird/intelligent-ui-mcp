#!/usr/bin/env node
/**
 * Smoke: spawn stdio MCP → ui_open → ui_propose → ui_get_state
 * assert events NDJSON + snapshot exist.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverEntry = path.join(root, "packages/mcp-server/dist/index.js");
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "iui-smoke-"));

function parseToolJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

async function main() {
  if (!fs.existsSync(serverEntry)) {
    console.error("Missing built server:", serverEntry, "— run npm run build first");
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: { ...process.env, IUI_SESSION_DIR: sessionDir },
  });

  const client = new Client({ name: "iui-smoke", version: "0.1.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  console.log("tools:", names.join(", "));

  const required = [
    "list_packages",
    "list_components",
    "set_enabled_packages",
    "get_prompt_fragment",
    "get_json_schema",
    "ui_open",
    "ui_propose",
    "ui_get_state",
    "ui_close",
  ];
  for (const r of required) {
    if (!names.includes(r)) throw new Error(`Missing tool: ${r}`);
  }

  const pkgs = parseToolJson(await client.callTool({ name: "list_packages", arguments: {} }));
  if (!pkgs.ok) throw new Error("list_packages failed");
  const ids = pkgs.packages.map((p) => p.id);
  if (!ids.includes("catalog.base") || !ids.includes("catalog.shadcn")) {
    throw new Error("Expected catalog.base + catalog.shadcn");
  }
  console.log("packages:", ids.join(", "));

  const opened = parseToolJson(
    await client.callTool({
      name: "ui_open",
      arguments: { title: "smoke", initialState: { tipPercent: 15 } },
    }),
  );
  if (!opened.ok) throw new Error("ui_open failed: " + JSON.stringify(opened));
  const sessionId = opened.sessionId;
  console.log("sessionId:", sessionId);
  console.log("eventsPath:", opened.eventsPath);

  const tree = {
    id: "root",
    type: "catalog.base/Stack",
    props: { direction: "vertical", gap: 12 },
    children: [
      {
        id: "t1",
        type: "catalog.base/Markdown",
        props: { text: "## 账单分摊\n测试 **Intelligent UI** MCP ①" },
      },
      {
        id: "tip",
        type: "catalog.shadcn/Slider",
        props: { label: "小费 %", min: 0, max: 30, step: 1, value: 15 },
        bind: "tipPercent",
      },
      {
        id: "tbl",
        type: "catalog.shadcn/DataTable",
        props: {
          columns: [
            { id: "name", header: "姓名" },
            { id: "amt", header: "金额", align: "right" },
          ],
          rows: [
            { name: "Ace", amt: 120 },
            { name: "Bob", amt: 80 },
          ],
        },
      },
      {
        id: "go",
        type: "catalog.shadcn/Button",
        props: { label: "确认分摊" },
        actions: {
          onClick: { actionType: "submit", payload: { intent: "confirm_split" } },
        },
      },
    ],
  };

  const proposed = parseToolJson(
    await client.callTool({
      name: "ui_propose",
      arguments: { sessionId, mode: "tree", tree },
    }),
  );
  if (!proposed.ok) throw new Error("ui_propose failed: " + JSON.stringify(proposed));
  console.log("propose revision:", proposed.revision, "decision:", proposed.decision);

  const state = parseToolJson(
    await client.callTool({
      name: "ui_get_state",
      arguments: { sessionId },
    }),
  );
  if (!state.ok || state.revision < 1 || !state.tree) {
    throw new Error("ui_get_state unexpected: " + JSON.stringify(state));
  }

  const eventsPath = path.join(sessionDir, `${sessionId}.ndjson`);
  const snapshotPath = path.join(sessionDir, `${sessionId}.snapshot.json`);
  const currentPath = path.join(sessionDir, "current.json");
  if (!fs.existsSync(eventsPath)) throw new Error("missing events ndjson");
  if (!fs.existsSync(snapshotPath)) throw new Error("missing snapshot");
  if (!fs.existsSync(currentPath)) throw new Error("missing current.json");

  const lines = fs
    .readFileSync(eventsPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const types = lines.map((e) => e.type);
  console.log("events:", types.join(" → "));
  if (!types.includes("ui.open") || !types.includes("ui.replace") || !types.includes("ui.done")) {
    throw new Error("Expected ui.open → ui.replace → ui.done");
  }

  // actions bypass file convention (empty ok for ①)
  const actionsPath = path.join(sessionDir, `${sessionId}.actions.ndjson`);
  if (!fs.existsSync(actionsPath)) {
    fs.writeFileSync(actionsPath, "", "utf8");
  }
  console.log("actionsPath (② bypass):", actionsPath);

  await client.callTool({
    name: "ui_close",
    arguments: { sessionId, reason: "completed" },
  });

  // ④: untrusted / missing path must not succeed (full coverage in custom-smoke)
  const reg = parseToolJson(
    await client.callTool({
      name: "register_package",
      arguments: { path: "/tmp/nope-iui-untrusted" },
    }),
  );
  if (reg.ok) {
    throw new Error("register_package on untrusted path should fail");
  }
  if (!["PATH_NOT_TRUSTED", "MANIFEST_INVALID"].includes(reg.error?.code)) {
    throw new Error("expected PATH_NOT_TRUSTED (or MANIFEST_INVALID), got " + reg.error?.code);
  }

  await client.close();
  console.log("SMOKE_OK", { sessionDir, sessionId, revision: proposed.revision });
}

main().catch((err) => {
  console.error("SMOKE_FAIL", err);
  process.exit(1);
});
