#!/usr/bin/env node
/**
 * ⑤ policy-smoke:
 * - lint: short Card → CARD_OVERWRAP warn; chart missing data → reject
 * - policy_check default OFF → enabled:false
 * - mock CMD ON → plain→plain_text, UI→ui
 * - expr: tip formula ok; malicious rejected
 * - EVAL heuristic ≥5 cases accuracy report
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverEntry = path.join(root, "packages/mcp-server/dist/index.js");
const policyModPath = path.join(root, "packages/mcp-server/dist/policy.js");
const mockCmd = `node ${path.join(root, "scripts/mock-policy-referee.mjs")}`;
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "iui-policy-smoke-"));

function parseToolJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

async function withClient(env, fn) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...process.env,
      IUI_SESSION_DIR: sessionDir,
      IUI_REPO_ROOT: root,
      IUI_AUTO_HOST: "0",
      IUI_AUTO_OPEN_BROWSER: "0",
      ...env,
    },
  });
  const client = new Client({ name: "iui-policy-smoke", version: "0.1.0" });
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
  if (!fs.existsSync(policyModPath)) {
    console.error("Missing dist/policy.js — run npm run build first");
    process.exit(1);
  }

  const policy = await import(policyModPath);

  // --- expr unit ---
  {
    const ok = policy.evaluateExpr("round(bill * (1 + tip/100), 2)", {
      bill: 100,
      tip: 15,
    });
    if (!ok.ok || ok.value !== 115) {
      throw new Error(`expr tip expected 115 got ${JSON.stringify(ok)}`);
    }
    console.log("expr tip ok:", ok.value);

    for (const bad of [
      "process.exit(1)",
      "Function('x')",
      "eval(1)",
      "require('fs')",
      'bill; process.exit()',
    ]) {
      const r = policy.evaluateExpr(bad, { bill: 1 });
      if (r.ok) throw new Error(`malicious expr should fail: ${bad}`);
      console.log("expr reject:", bad, "→", r.code);
    }
  }

  // --- heuristic EVAL subset ---
  {
    const cases = policy.EVAL_HEURISTIC_CASES;
    let correct = 0;
    for (const c of cases) {
      const r = policy.classifyFormat(c.query);
      const hit = r.decision === c.expect;
      if (hit) correct++;
      console.log(
        `heuristic #${c.id}: expect=${c.expect} got=${r.decision} ${hit ? "OK" : "MISS"}`,
      );
    }
    const acc = correct / cases.length;
    console.log(`heuristic accuracy: ${correct}/${cases.length} = ${(acc * 100).toFixed(1)}%`);
    if (correct < 5) throw new Error("Need ≥5 correct heuristic cases");
    // Plain-leaning: all plain expects should mostly hit
    const plainCases = cases.filter((c) => c.expect === "plain_text");
    const plainOk = plainCases.filter(
      (c) => policy.classifyFormat(c.query).decision === "plain_text",
    ).length;
    if (plainOk < plainCases.length) {
      console.warn(`plain misses: ${plainOk}/${plainCases.length}`);
    }

    const stayPlain = [
      "巴黎是哪个国家的首都？",
      "今天星期几？",
      "列出登录表单该有的字段（只要说明）",
      "我要自定义仪表盘控件（无包时）怎么 register_package？",
    ];
    for (const q of stayPlain) {
      const r = policy.classifyFormat(q);
      if (r.decision !== "plain_text") {
        throw new Error(`expected plain_text for ${JSON.stringify(q)} got ${r.decision} ${r.reasons}`);
      }
    }
    const mustUi = [
      "现在我的电脑内存怎么样",
      "今天北京天气怎么样",
      "给我写一篇博士生的毕业论文",
      "A 方案和 B 方案比哪个好",
    ];
    for (const q of mustUi) {
      const r = policy.classifyFormat(q);
      if (r.decision !== "ui") {
        throw new Error(`expected ui for ${JSON.stringify(q)} got ${r.decision} ${r.reasons}`);
      }
    }
    console.log("classify natural-ask overrides ok");

    const steer = policy.buildAlwaysOnInstructions({ locale: "zh-CN" });
    for (const needle of [
      "ui_open",
      "ui_propose",
      "内存",
      "天气",
      "Form",
      "plainTextFallback",
      policy.STEER_VERSION,
    ]) {
      if (!steer.includes(needle)) {
        throw new Error(`always-on instructions missing ${needle}`);
      }
    }
    if (steer.length < 400) {
      throw new Error(`always-on instructions too short: ${steer.length}`);
    }
    console.log("always-on instructions ok", policy.STEER_VERSION, "chars", steer.length);
  }

  // --- lint via MCP + direct ---
  {
    const cardLint = policy.lintTree(
      {
        id: "root",
        type: "catalog.shadcn/Card",
        props: { title: "Note" },
        children: [
          {
            id: "m1",
            type: "catalog.base/Markdown",
            props: { text: "巴黎是法国的首都。" },
          },
        ],
      },
      () => true,
    );
    if (!cardLint.issues.some((i) => i.code === "CARD_OVERWRAP")) {
      throw new Error("expected CARD_OVERWRAP: " + JSON.stringify(cardLint));
    }
    console.log("lint CARD_OVERWRAP (direct) ok");

    const chartLint = policy.lintTree(
      {
        id: "root",
        type: "catalog.base/LineChart",
        props: { title: "Revenue" },
      },
      () => true,
    );
    if (!chartLint.issues.some((i) => i.code === "CHART_MISSING_DATA")) {
      throw new Error("expected CHART_MISSING_DATA: " + JSON.stringify(chartLint));
    }
    if (chartLint.passed) throw new Error("chart lint should not pass");
    console.log("lint CHART_MISSING_DATA (direct) ok");
  }

  await withClient({}, async (client) => {
    const injected =
      typeof client.getInstructions === "function" ? client.getInstructions() : "";
    if (!injected || !injected.includes("ui_open") || !injected.includes("0.4.0-auto-steer")) {
      throw new Error(
        "MCP initialize instructions missing always-on steer: " +
          JSON.stringify(injected)?.slice(0, 200),
      );
    }
    console.log("MCP initialize instructions ok", injected.length);

    const frag = parseToolJson(
      await client.callTool({
        name: "get_prompt_fragment",
        arguments: { locale: "zh-CN", includeExamples: true },
      }),
    );
    if (!frag.ok || !String(frag.fragment || "").includes("resource_board")) {
      throw new Error("get_prompt_fragment missing recipes: " + JSON.stringify(frag).slice(0, 240));
    }
    console.log("get_prompt_fragment recipes ok", frag.version);

    const open = parseToolJson(
      await client.callTool({
        name: "ui_open",
        arguments: { sessionId: "pol_lint", title: "lint" },
      }),
    );
    if (!open.ok) throw new Error("ui_open failed: " + JSON.stringify(open));

    const card = parseToolJson(
      await client.callTool({
        name: "ui_propose",
        arguments: {
          sessionId: "pol_lint",
          mode: "tree",
          forceUi: true,
          tree: {
            id: "root",
            type: "catalog.shadcn/Card",
            props: { title: "Note" },
            children: [
              {
                id: "m1",
                type: "catalog.base/Markdown",
                props: { text: "巴黎是法国的首都。" },
              },
            ],
          },
        },
      }),
    );
    if (!card.ok) throw new Error("card propose should ok with warn: " + JSON.stringify(card));
    const lintCodes = (card.lint?.issues || []).map((i) => i.code);
    const warns = (card.warnings || []).join(" ");
    if (!lintCodes.includes("CARD_OVERWRAP") && !warns.includes("CARD_OVERWRAP")) {
      throw new Error("expected CARD_OVERWRAP warn via MCP: " + JSON.stringify(card));
    }
    console.log("lint CARD_OVERWRAP (MCP) ok");

    // Chart reject via MCP: LineChart may be UNKNOWN_TYPE — still error. Prefer CHART on enabled type.
    // Propose with force enabled check: use a type ending in Chart that we mark enabled by
    // temporarily accepting via isTypeEnabled — UNKNOWN_TYPE also rejects which is ok for smoke
    // if message includes either. Better: open new session and propose catalog.shadcn doesn't have chart.
    // Use direct lint above as authoritative; MCP path: propose missing-data on type that exists.
    // If LineChart unknown, ok:false with UNKNOWN_TYPE — also create chartLint via evaluate_expr N/A.
    const openC = parseToolJson(
      await client.callTool({
        name: "ui_open",
        arguments: { sessionId: "pol_chart" },
      }),
    );
    if (!openC.ok) throw new Error("open pol_chart failed");
    // Use DataTable? No — must be chart. Register isn't needed: unknown LineChart → LINT_FAILED with UNKNOWN_TYPE.
    // To get CHART_MISSING_DATA through MCP, type must be enabled. Check catalogs for Chart.
    const comps = parseToolJson(
      await client.callTool({
        name: "list_components",
        arguments: { enabledOnly: false },
      }),
    );
    let chartType = (comps.components || [])
      .map((c) => c.type)
      .find((t) => /Chart/i.test(t));
    if (chartType) {
      const pkgId = chartType.split("/")[0];
      await client.callTool({
        name: "set_enabled_packages",
        arguments: { packages: { [pkgId]: true } },
      });
      const badChart = parseToolJson(
        await client.callTool({
          name: "ui_propose",
          arguments: {
            sessionId: "pol_chart",
            mode: "tree",
            forceUi: true,
            tree: { id: "root", type: chartType, props: {} },
          },
        }),
      );
      if (badChart.ok) throw new Error("chart without data should fail via MCP");
      const blob = JSON.stringify(badChart);
      if (!blob.includes("CHART_MISSING_DATA")) {
        throw new Error("MCP chart reject missing CHART_MISSING_DATA: " + blob);
      }
      console.log("lint CHART_MISSING_DATA (MCP) ok");
    } else {
      console.log("lint CHART_MISSING_DATA (MCP) skipped — no chart types in catalog (direct covered)");
    }
  });

  // --- policy_check disabled ---
  await withClient({ IUI_POLICY_ENABLED: "0" }, async (client) => {
    const r = parseToolJson(
      await client.callTool({
        name: "policy_check",
        arguments: { query: "巴黎是哪个国家的首都？" },
      }),
    );
    if (!r.ok) throw new Error("policy_check failed");
    if (r.enabled !== false) throw new Error("expected enabled:false");
    console.log("policy_check disabled ok, decision hint=", r.decision);
  });

  // --- policy_check via CMD mock ---
  await withClient(
    {
      IUI_POLICY_ENABLED: "1",
      IUI_POLICY_CMD: mockCmd,
      IUI_POLICY_TIMEOUT_MS: "5000",
    },
    async (client) => {
      const plain = parseToolJson(
        await client.callTool({
          name: "policy_check",
          arguments: { query: "巴黎是哪个国家的首都？" },
        }),
      );
      if (!plain.ok || !plain.enabled) throw new Error("plain policy not enabled");
      if (plain.decision !== "plain_text") {
        throw new Error("plain query should be plain_text: " + JSON.stringify(plain));
      }
      console.log("policy CMD plain ok", plain.source);

      const ui = parseToolJson(
        await client.callTool({
          name: "policy_check",
          arguments: { query: "帮我做一个小费计算器：账单金额、小费比例、人数" },
        }),
      );
      if (ui.decision !== "ui") {
        throw new Error("ui query should be ui: " + JSON.stringify(ui));
      }
      console.log("policy CMD ui ok", ui.source);

      // Gate on ui_propose
      await client.callTool({
        name: "ui_open",
        arguments: { sessionId: "pol_gate", query: "2+2 等于几？" },
      });
      const gated = parseToolJson(
        await client.callTool({
          name: "ui_propose",
          arguments: {
            sessionId: "pol_gate",
            mode: "tree",
            query: "2+2 等于几？",
            tree: {
              id: "root",
              type: "catalog.shadcn/Card",
              children: [
                {
                  id: "m",
                  type: "catalog.base/Markdown",
                  props: { text: "4" },
                },
              ],
            },
          },
        }),
      );
      if (!gated.ok) throw new Error("gated propose should ok plain path");
      if (gated.decision !== "plain_text") {
        throw new Error("expected plain_text gate: " + JSON.stringify(gated));
      }
      console.log("ui_propose policy gate → plain_text ok");
    },
  );

  // --- policy via HTTP mock endpoint ---
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let input = {};
      try {
        input = JSON.parse(body || "{}");
      } catch {
        /* ignore */
      }
      const r = policy.classifyFormat(String(input.query ?? ""));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          decision: r.decision,
          score: r.score,
          reasons: ["http-mock", ...r.reasons],
          suggested_types: r.suggested_types,
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  await withClient(
    {
      IUI_POLICY_ENABLED: "1",
      IUI_POLICY_ENDPOINT: `http://127.0.0.1:${port}/policy`,
      IUI_POLICY_TIMEOUT_MS: "5000",
    },
    async (client) => {
      const r = parseToolJson(
        await client.callTool({
          name: "policy_check",
          arguments: { query: "对比三款手机续航" },
        }),
      );
      if (r.decision !== "ui" || r.source !== "endpoint") {
        throw new Error("endpoint mock failed: " + JSON.stringify(r));
      }
      console.log("policy ENDPOINT ui ok");
    },
  );
  server.close();

  // --- expr via MCP tool + session reducers ---
  await withClient({}, async (client) => {
    const ev = parseToolJson(
      await client.callTool({
        name: "evaluate_expr",
        arguments: {
          expr: "round(bill * (1 + tip/100), 2)",
          state: { bill: 200, tip: 10 },
        },
      }),
    );
    if (!ev.ok || ev.value !== 220) throw new Error("evaluate_expr failed: " + JSON.stringify(ev));

    const bad = parseToolJson(
      await client.callTool({
        name: "evaluate_expr",
        arguments: { expr: "process.exit(1)", state: {} },
      }),
    );
    if (bad.ok) throw new Error("evaluate_expr should reject process.exit");
    console.log("evaluate_expr tool ok");

    const open = parseToolJson(
      await client.callTool({
        name: "ui_open",
        arguments: {
          sessionId: "pol_expr",
          initialState: { bill: 100, tipPercent: 15 },
          reducers: { total: "round(bill * (1 + tipPercent/100), 2)" },
        },
      }),
    );
    if (!open.ok) throw new Error("open reducers failed: " + JSON.stringify(open));
    if (open.state.total !== 115) {
      throw new Error("expected total 115 on open, got " + JSON.stringify(open.state));
    }

    await client.callTool({
      name: "ui_propose",
      arguments: {
        sessionId: "pol_expr",
        mode: "tree",
        forceUi: true,
        tree: {
          id: "root",
          type: "catalog.base/Stack",
          children: [
            {
              id: "badge",
              type: "catalog.shadcn/Badge",
              props: { text: "x" },
              expr: { text: "round(bill * (1 + tipPercent/100), 2)" },
            },
          ],
        },
      },
    });

    const act = parseToolJson(
      await client.callTool({
        name: "ui_report_action",
        arguments: {
          sessionId: "pol_expr",
          action: { type: "state.set", path: "tipPercent", value: 20 },
        },
      }),
    );
    if (!act.ok) throw new Error("report_action failed");
    if (act.state.total !== 120) {
      throw new Error("expected total 120 after tip change, got " + JSON.stringify(act.state));
    }
    const st = parseToolJson(
      await client.callTool({
        name: "ui_get_state",
        arguments: { sessionId: "pol_expr" },
      }),
    );
    const badge = st.tree?.children?.[0];
    if (badge?.props?.text !== 120 && badge?.props?.text !== "120") {
      // text may stay number 120
      if (Number(badge?.props?.text) !== 120) {
        throw new Error("badge expr not updated: " + JSON.stringify(badge));
      }
    }
    console.log("session reducers + node.expr ok");

    // malicious reducer on open
    const badOpen = parseToolJson(
      await client.callTool({
        name: "ui_open",
        arguments: {
          sessionId: "pol_bad",
          reducers: { x: "process.exit(1)" },
        },
      }),
    );
    if (badOpen.ok) throw new Error("malicious reducer should be rejected on open");
    console.log("malicious reducer rejected:", badOpen.error?.code);
  });

  // prompt fragment version
  await withClient({}, async (client) => {
    const frag = parseToolJson(
      await client.callTool({
        name: "get_prompt_fragment",
        arguments: { locale: "zh-CN", includeExamples: false },
      }),
    );
    if (!frag.ok || !frag.version) throw new Error("prompt missing version");
    if (!String(frag.fragment).includes("prefer_plain_text")) {
      throw new Error("prompt missing prefer_plain_text rules");
    }
    console.log("prompt fragment version:", frag.version);
  });

  console.log("POLICY_SMOKE_OK");
}

main().catch((e) => {
  console.error("POLICY_SMOKE_FAIL", e);
  process.exit(1);
});
