#!/usr/bin/env node
/**
 * ⑥ catalog-smoke (G5):
 * - list charts full types
 * - list schema-only packages
 * - propose LineChart with data → lint pass
 * - propose LineChart missing data → CHART_MISSING_DATA reject
 * - enable antd → propose Button → ok (type enabled; Host aliases separately)
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
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "iui-catalog-smoke-"));

function parseToolJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

async function withClient(fn) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: { ...process.env, IUI_SESSION_DIR: sessionDir, IUI_REPO_ROOT: root },
  });
  const client = new Client({ name: "iui-catalog-smoke", version: "0.1.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function main() {
  if (!fs.existsSync(serverEntry)) {
    console.error("Missing built server — run npm run build first");
    process.exit(1);
  }

  await withClient(async (client) => {
    const pkgs = parseToolJson(
      await client.callTool({
        name: "list_packages",
        arguments: { includeDisabled: true, includeSchemaOnly: true },
      }),
    );
    if (!pkgs.ok) throw new Error("list_packages failed");
    const byId = Object.fromEntries(pkgs.packages.map((p) => [p.id, p]));
    for (const id of [
      "catalog.charts",
      "catalog.radix",
      "catalog.mui",
      "catalog.antd",
      "catalog.chakra",
    ]) {
      if (!byId[id]) throw new Error(`missing package ${id}`);
    }
    if (byId["catalog.charts"].renderStatus !== "full") {
      throw new Error("catalog.charts should be full");
    }
    for (const id of ["catalog.radix", "catalog.mui", "catalog.antd", "catalog.chakra"]) {
      if (byId[id].renderStatus !== "schema_only") {
        throw new Error(`${id} should be schema_only`);
      }
    }
    console.log(
      "packages:",
      pkgs.packages.map((p) => `${p.id}(${p.renderStatus},en=${p.enabled})`).join(", "),
    );

    const comps = parseToolJson(
      await client.callTool({
        name: "list_components",
        arguments: { packageId: "catalog.charts", enabledOnly: true },
      }),
    );
    const chartTypes = comps.components.map((c) => c.type);
    for (const t of [
      "catalog.charts/LineChart",
      "catalog.charts/BarChart",
      "catalog.charts/PieChart",
    ]) {
      if (!chartTypes.includes(t)) throw new Error(`missing chart type ${t}`);
    }
    console.log("charts types:", chartTypes.join(", "));

    const frag = parseToolJson(
      await client.callTool({
        name: "get_prompt_fragment",
        arguments: { density: "compact", includeExamples: false },
      }),
    );
    if (!frag.ok) throw new Error("get_prompt_fragment failed");
    if (!/Density preference: compact/.test(frag.fragment)) {
      throw new Error("prompt missing compact density");
    }
    console.log("prompt density compact ok, version", frag.version);

    // enable antd for propose + schema-only note
    const en = parseToolJson(
      await client.callTool({
        name: "set_enabled_packages",
        arguments: { packages: { "catalog.antd": true } },
      }),
    );
    if (!en.ok) throw new Error("enable antd failed");
    const frag2 = parseToolJson(
      await client.callTool({
        name: "get_prompt_fragment",
        arguments: { includeExamples: false },
      }),
    );
    if (!/schema-only|Schema-only|降级/i.test(frag2.fragment)) {
      throw new Error("prompt missing schema-only degradation note");
    }
    console.log("schema-only prompt note ok");

    const opened = parseToolJson(
      await client.callTool({
        name: "ui_open",
        arguments: { title: "catalog-smoke", density: "compact" },
      }),
    );
    if (!opened.ok) throw new Error("ui_open failed");
    const sid = opened.sessionId;

    const good = parseToolJson(
      await client.callTool({
        name: "ui_propose",
        arguments: {
          sessionId: sid,
          mode: "tree",
          tree: {
            id: "root",
            type: "catalog.base/Stack",
            props: { direction: "vertical", gap: 8 },
            children: [
              {
                id: "line1",
                type: "catalog.charts/LineChart",
                props: {
                  title: "Q1–Q4",
                  data: [
                    { label: "Q1", value: 10 },
                    { label: "Q2", value: 14 },
                    { label: "Q3", value: 12 },
                    { label: "Q4", value: 18 },
                  ],
                },
              },
            ],
          },
        },
      }),
    );
    if (!good.ok) throw new Error(`LineChart with data should pass: ${JSON.stringify(good)}`);
    console.log("LineChart+data lint pass");

    const bad = parseToolJson(
      await client.callTool({
        name: "ui_propose",
        arguments: {
          sessionId: sid,
          mode: "tree",
          tree: {
            id: "root2",
            type: "catalog.charts/LineChart",
            props: { title: "empty" },
          },
        },
      }),
    );
    if (bad.ok) throw new Error("LineChart missing data should reject");
    const issues = bad.lint?.issues ?? bad.issues ?? [];
    const hit = JSON.stringify(bad).includes("CHART_MISSING_DATA");
    if (!hit) {
      throw new Error(`expected CHART_MISSING_DATA, got ${JSON.stringify(bad)}`);
    }
    console.log("LineChart missing data → CHART_MISSING_DATA");

    const antdBtn = parseToolJson(
      await client.callTool({
        name: "ui_propose",
        arguments: {
          sessionId: sid,
          mode: "tree",
          tree: {
            id: "btn",
            type: "catalog.antd/Button",
            props: { label: "确定", type: "primary" },
          },
        },
      }),
    );
    if (!antdBtn.ok) {
      throw new Error(`antd Button propose should pass when enabled: ${JSON.stringify(antdBtn)}`);
    }
    console.log("antd Button propose ok (Host will alias → shadcn)");

    await client.callTool({ name: "ui_close", arguments: { sessionId: sid } });
  });

  // renderer aliases unit check via built package if present
  const rendererDist = path.join(root, "packages/renderer-react/dist/index.js");
  if (fs.existsSync(rendererDist)) {
    const r = await import(rendererDist);
    const mapped = r.listMappedTypes();
    for (const t of [
      "catalog.charts/LineChart",
      "catalog.charts/BarChart",
      "catalog.charts/PieChart",
    ]) {
      if (!mapped.includes(t)) throw new Error(`renderer missing ${t}`);
    }
    if (r.resolveAlias("catalog.antd/Button") !== "catalog.shadcn/Button") {
      throw new Error("antd Button alias broken");
    }
    if (r.resolveAlias("catalog.mui/Button") !== "catalog.shadcn/Button") {
      throw new Error("mui Button alias broken");
    }
    console.log(
      "renderer charts:",
      mapped.filter((t) => t.startsWith("catalog.charts/")).join(", "),
    );
    console.log("aliases sample ok, count", r.listAliasTypes().length);
  }

  console.log("CATALOG_SMOKE_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
