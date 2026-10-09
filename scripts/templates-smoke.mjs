#!/usr/bin/env node
/**
 * High-frequency Intelligent UI templates smoke:
 * Calculator / Comparison (ops stream) / Stepper / Checklist / MapStub / GameShell
 * + Host action POST roundtrip for select/toggle/press.
 *
 * Usage:
 *   npm run templates-smoke
 *   IUI_SESSION_DIR=~/.intelligent-ui-mcp/templates-demo npm run templates-smoke
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

const keepDir = Boolean(process.env.IUI_SESSION_DIR);
const sessionDir =
  process.env.IUI_SESSION_DIR ??
  fs.mkdtempSync(path.join(os.tmpdir(), "iui-templates-smoke-"));

function parseToolJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function readSnapshot(sessionId) {
  return JSON.parse(
    fs.readFileSync(path.join(sessionDir, `${sessionId}.snapshot.json`), "utf8"),
  );
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

function tokenFromEnvOrFile() {
  if (process.env.IUI_HOST_TOKEN) return process.env.IUI_HOST_TOKEN;
  const p = path.join(os.homedir(), ".intelligent-ui-mcp", "host-token");
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  return "";
}

async function main() {
  if (!fs.existsSync(serverEntry)) {
    console.error("Missing built server — run npm run build first");
    process.exit(1);
  }
  if (keepDir) fs.mkdirSync(sessionDir, { recursive: true });

  console.log("IUI_SESSION_DIR:", sessionDir);

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      IUI_SESSION_DIR: sessionDir,
      IUI_AUTO_HOST: "0",
      IUI_AUTO_OPEN_BROWSER: "0",
    },
  });
  const client = new Client({ name: "iui-templates-smoke", version: "0.1.0" });
  await client.connect(transport);

  const comps = parseToolJson(
    await client.callTool({ name: "list_components", arguments: { enabledOnly: true } }),
  );
  const types = new Set((comps.components ?? comps.items ?? []).map((c) => c.type ?? `${c.packageId}/${c.name}`));
  // list_components shape may be {ok, components:[{type}]} or flat
  let typeList = [];
  if (Array.isArray(comps.components)) {
    typeList = comps.components.map((c) => c.type || `catalog.shadcn/${c.name}`);
  } else if (Array.isArray(comps.items)) {
    typeList = comps.items.map((c) => c.type);
  }
  const needed = [
    "catalog.shadcn/Calculator",
    "catalog.shadcn/Comparison",
    "catalog.shadcn/Stepper",
    "catalog.shadcn/Checklist",
    "catalog.shadcn/MapStub",
    "catalog.shadcn/GameShell",
  ];
  for (const t of needed) {
    assert(
      typeList.includes(t) || types.has(t),
      `missing component ${t}; got ${typeList.slice(0, 8).join(",")}…`,
    );
  }
  console.log("components: HF templates present");

  const opened = parseToolJson(
    await client.callTool({
      name: "ui_open",
      arguments: { title: "HF templates smoke" },
    }),
  );
  assert(opened.ok, "ui_open failed");
  const sessionId = opened.sessionId;
  console.log("sessionId:", sessionId);

  // 1) Shell + Calculator + Checklist + Stepper (tree OK for tiny widgets)
  const tree1 = parseToolJson(
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
              props: { direction: "vertical", gap: 16 },
              children: [
                {
                  id: "md",
                  type: "catalog.base/Markdown",
                  props: { text: "## 高频模板\nCalculator · Comparison · Stepper · Checklist" },
                },
                {
                  id: "calc",
                  type: "catalog.shadcn/Calculator",
                  props: { title: "计算器", expression: "0" },
                },
                {
                  id: "steps",
                  type: "catalog.shadcn/Stepper",
                  props: {
                    title: "开户流程",
                    current: 0,
                    steps: [
                      { id: "s1", title: "身份", description: "上传证件" },
                      { id: "s2", title: "资料", description: "填写信息" },
                      { id: "s3", title: "确认", description: "签字提交" },
                    ],
                  },
                },
                {
                  id: "todo",
                  type: "catalog.shadcn/Checklist",
                  props: {
                    title: "上线清单",
                    items: [
                      { id: "c1", label: "鉴权", checked: true },
                      { id: "c2", label: "SSE" },
                      { id: "c3", label: "模板" },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    }),
  );
  assert(tree1.ok, "propose shell failed: " + JSON.stringify(tree1));

  // 2) Comparison shell with empty items (ops progressive)
  const cmpShell = parseToolJson(
    await client.callTool({
      name: "ui_propose",
      arguments: {
        sessionId,
        mode: "ops",
        chunkDone: false,
        ops: [
          {
            op: "upsert",
            parentId: "root",
            nodeId: "cmp",
            node: {
              id: "cmp",
              type: "catalog.shadcn/Comparison",
              props: {
                title: "三款旗舰对比",
                layout: "cards",
                aspects: [
                  { id: "chip", label: "芯片" },
                  { id: "battery", label: "续航" },
                  { id: "price", label: "价格" },
                ],
                items: [],
              },
            },
          },
        ],
      },
    }),
  );
  assert(cmpShell.ok, "comparison shell failed");
  let snap = readSnapshot(sessionId);
  assert(findNode(snap.tree, "cmp")?.props?.items?.length === 0, "cmp items should start empty");

  const phones = [
    {
      id: "iphone",
      name: "iPhone 16 Pro",
      subtitle: "Apple",
      badge: "影像",
      values: { chip: "A18 Pro", battery: "约一天半", price: "¥9999" },
    },
    {
      id: "pixel",
      name: "Pixel 9 Pro",
      subtitle: "Google",
      values: { chip: "Tensor G4", battery: "约一天", price: "¥6999" },
    },
    {
      id: "galaxy",
      name: "Galaxy S25 Ultra",
      subtitle: "Samsung",
      badge: "S Pen",
      highlight: true,
      values: { chip: "8 Elite", battery: "约两天", price: "¥9699" },
    },
  ];

  for (let i = 0; i < phones.length; i++) {
    const prev = findNode(readSnapshot(sessionId).tree, "cmp")?.props?.items ?? [];
    const nextItems = [...prev, phones[i]];
    const r = parseToolJson(
      await client.callTool({
        name: "ui_propose",
        arguments: {
          sessionId,
          mode: "ops",
          chunkDone: false,
          ops: [
            {
              op: "patch_props",
              nodeId: "cmp",
              props: { items: nextItems },
            },
          ],
        },
      }),
    );
    assert(r.ok, `phone upsert ${i} failed`);
    snap = readSnapshot(sessionId);
    const n = findNode(snap.tree, "cmp")?.props?.items?.length ?? -1;
    assert(n === i + 1, `expected ${i + 1} items, got ${n}`);
    console.log(`comparison items → ${n}`);
  }

  // 3) Map + Game
  const extras = parseToolJson(
    await client.callTool({
      name: "ui_propose",
      arguments: {
        sessionId,
        mode: "ops",
        chunkDone: true,
        ops: [
          {
            op: "upsert",
            parentId: "root",
            nodeId: "map",
            node: {
              id: "map",
              type: "catalog.shadcn/MapStub",
              props: {
                title: "附近门店",
                caption: "示意地图（无瓦片）",
                center: { lat: 31.23, lng: 121.47 },
                markers: [
                  { id: "m1", lat: 31.23, lng: 121.47, label: "静安" },
                  { id: "m2", lat: 31.2, lng: 121.5, label: "陆家嘴" },
                ],
              },
            },
          },
          {
            op: "upsert",
            parentId: "root",
            nodeId: "game",
            node: {
              id: "game",
              type: "catalog.shadcn/GameShell",
              props: { title: "井字棋" },
            },
          },
        ],
      },
    }),
  );
  assert(extras.ok, "map/game upsert failed");
  snap = readSnapshot(sessionId);
  assert(findNode(snap.tree, "map"), "map missing");
  assert(findNode(snap.tree, "game"), "game missing");
  assert(findNode(snap.tree, "calc")?.type === "catalog.shadcn/Calculator", "calc type");
  assert(findNode(snap.tree, "steps")?.type === "catalog.shadcn/Stepper", "stepper type");
  assert(findNode(snap.tree, "todo")?.type === "catalog.shadcn/Checklist", "checklist type");
  assert((findNode(snap.tree, "cmp")?.props?.items?.length ?? 0) === 3, "cmp 3 items");

  // 4) Host API action roundtrip
  const hostToken = randomBytes(16).toString("hex");
  const api = await startSessionApiServer({
    sessionDir,
    port: 0,
    hostToken,
  });
  const tok = api.hostToken;
  assert(tok, "missing hostToken from session API");

  const actionId = `act_${randomBytes(4).toString("hex")}`;
  const actionRes = await fetch(`http://127.0.0.1:${api.port}/api/action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tok}`,
      Origin: "http://127.0.0.1",
    },
    body: JSON.stringify({
      actionId,
      sessionId,
      type: "select",
      nodeId: "cmp",
      componentType: "catalog.shadcn/Comparison",
      value: "galaxy",
      payload: { itemId: "galaxy", name: "Galaxy S25 Ultra" },
      ts: new Date().toISOString(),
    }),
  });
  const actionJson = await actionRes.json();
  assert(actionRes.ok && actionJson.ok, `action POST ${actionRes.status} ${JSON.stringify(actionJson)}`);
  await new Promise((r) => setTimeout(r, 350));
  const drained = parseToolJson(
    await client.callTool({
      name: "ui_drain_actions",
      arguments: { sessionId },
    }),
  );
  assert(drained.ok, "drain failed: " + JSON.stringify(drained));
  const actions = drained.actions ?? [];
  assert(
    actions.some(
      (a) =>
        a.actionId === actionId ||
        a.type === "select" ||
        a.action?.type === "select",
    ) || drained.lastActionId === actionId,
    "expected select action drained: " + JSON.stringify(drained).slice(0, 400),
  );
  console.log("action select drained OK", { count: drained.count, actionId });

  await api.close?.();
  await client.close().catch(() => undefined);

  // write a small marker for verify dir consumers
  const marker = {
    ok: true,
    sessionId,
    sessionDir,
    templates: needed,
    comparisonItems: 3,
  };
  const outMarker = path.join(sessionDir, "TEMPLATES_SMOKE.json");
  fs.writeFileSync(outMarker, JSON.stringify(marker, null, 2));
  console.log("TEMPLATES_SMOKE_OK", JSON.stringify(marker));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
