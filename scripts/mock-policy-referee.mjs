#!/usr/bin/env node
/**
 * Mock policy referee for smoke tests (stdin JSON → stdout JSON).
 * Uses the same Phase A heuristics as the server — no API key.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.resolve(__dirname, "../packages/mcp-server/dist/policy.js");

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim() || "{}";
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stdout.write(
      JSON.stringify({
        decision: "plain_text",
        score: 0,
        reasons: ["mock: invalid JSON input"],
        suggested_types: [],
      }),
    );
    return;
  }

  if (!fs.existsSync(policyPath)) {
    // Fallback inline: ultra-simple
    const q = String(input.query ?? "");
    const ui = /对比|小费|计算器|步骤|二选一|表单|趋势|图表|开关|进度/i.test(q);
    process.stdout.write(
      JSON.stringify({
        decision: ui ? "ui" : "plain_text",
        score: 0.8,
        reasons: [ui ? "mock-inline: ui keywords" : "mock-inline: default plain"],
        suggested_types: [],
      }),
    );
    return;
  }

  const mod = await import(policyPath);
  const result = mod.classifyFormat(String(input.query ?? ""));
  process.stdout.write(
    JSON.stringify({
      decision: result.decision,
      score: result.score,
      reasons: ["mock-referee", ...result.reasons],
      suggested_types: result.suggested_types,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
