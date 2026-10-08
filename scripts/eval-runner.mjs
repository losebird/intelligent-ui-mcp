#!/usr/bin/env node
/**
 * ⑥ eval-runner (G7):
 * - --validate-only: schema/field checks (CI hard gate)
 * - default: validate + heuristic classifyFormat round → evals/results/latest.{json,md}
 * Auto UI scores are NOT a hard failure.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const casesDir = path.join(root, "evals/cases");
const resultsDir = path.join(root, "evals/results");
const policyModPath = path.join(root, "packages/mcp-server/dist/policy.js");

const ALLOWED_FORMATS = new Set(["plain_text", "plain", "ui", "ui+state"]);
const FORMAT_NORM = {
  plain_text: "plain_text",
  plain: "plain_text",
  ui: "ui",
  "ui+state": "ui",
};

function loadCases() {
  if (!fs.existsSync(casesDir)) {
    throw new Error(`Missing cases dir: ${casesDir}`);
  }
  const files = fs
    .readdirSync(casesDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const cases = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(casesDir, f), "utf8");
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid JSON ${f}: ${e.message}`);
    }
    cases.push({ file: f, ...obj });
  }
  return cases;
}

function validateCase(c) {
  const errs = [];
  if (!c.id || typeof c.id !== "string") errs.push("missing id");
  if (c.file && !c.file.startsWith(c.id)) {
    errs.push(`filename ${c.file} should start with id ${c.id}`);
  }
  if (typeof c.prompt !== "string") errs.push("prompt must be string");
  if (!c.expect || typeof c.expect !== "object") {
    errs.push("missing expect");
    return errs;
  }
  const fmt = c.expect.format;
  if (!ALLOWED_FORMATS.has(fmt)) {
    errs.push(`expect.format invalid: ${fmt}`);
  }
  if (!Array.isArray(c.expect.tags)) errs.push("expect.tags must be array");
  if (!Array.isArray(c.expect.anyOfTypes)) errs.push("expect.anyOfTypes must be array");
  if (c.expect.forbidTypes != null && !Array.isArray(c.expect.forbidTypes)) {
    errs.push("expect.forbidTypes must be array when present");
  }
  if (c.expect.needsAction != null && typeof c.expect.needsAction !== "boolean") {
    errs.push("expect.needsAction must be boolean when present");
  }
  for (const t of c.expect.anyOfTypes ?? []) {
    if (typeof t !== "string" || !t.includes("/")) {
      errs.push(`anyOfTypes entry must look like package/Name: ${t}`);
    }
  }
  for (const t of c.expect.forbidTypes ?? []) {
    if (typeof t !== "string" || !t.includes("/")) {
      errs.push(`forbidTypes entry must look like package/Name: ${t}`);
    }
  }
  if (c.locale != null && typeof c.locale !== "string") {
    errs.push("locale must be string");
  }
  return errs;
}

function validateAll(cases) {
  const allErrs = [];
  if (cases.length < 20) {
    allErrs.push(`Need ≥20 cases, found ${cases.length}`);
  }
  const ids = new Set();
  for (const c of cases) {
    if (ids.has(c.id)) allErrs.push(`duplicate id: ${c.id}`);
    ids.add(c.id);
    for (const e of validateCase(c)) {
      allErrs.push(`${c.id}: ${e}`);
    }
  }
  return allErrs;
}

function toMdTable(rows) {
  const header =
    "| id | expect | heuristic | match | suggested_types | reasons |\n|----|--------|-----------|-------|-----------------|---------|\n";
  const body = rows
    .map((r) => {
      const sug = (r.suggested_types ?? []).slice(0, 4).join(", ") || "—";
      const reasons = (r.reasons ?? []).slice(0, 3).join("; ").replace(/\|/g, "/") || "—";
      return `| ${r.id} | ${r.expect} | ${r.got} | ${r.match ? "OK" : "MISS"} | ${sug} | ${reasons} |`;
    })
    .join("\n");
  return header + body + "\n";
}

async function main() {
  const validateOnly = process.argv.includes("--validate-only");
  const cases = loadCases();
  const errs = validateAll(cases);
  if (errs.length) {
    console.error("EVAL_VALIDATE_FAIL");
    for (const e of errs) console.error(" -", e);
    process.exit(1);
  }
  console.log(`eval validate: ${cases.length} cases OK`);
  if (validateOnly) {
    console.log("EVAL_VALIDATE_OK");
    return;
  }

  if (!fs.existsSync(policyModPath)) {
    console.error("Missing dist/policy.js — run npm run build first");
    process.exit(1);
  }
  const policy = await import(policyModPath);
  if (typeof policy.classifyFormat !== "function") {
    throw new Error("policy.classifyFormat missing");
  }

  const rows = [];
  let matched = 0;
  let scored = 0;
  for (const c of cases) {
    if (c.meta?.hostEmpty) {
      rows.push({
        id: c.id,
        expect: c.expect.format,
        got: "(host empty — skipped)",
        match: true,
        suggested_types: [],
        reasons: ["hostEmpty skip"],
        skipped: true,
      });
      continue;
    }
    const expectNorm = FORMAT_NORM[c.expect.format] ?? c.expect.format;
    const r = policy.classifyFormat(c.prompt);
    const hit = r.decision === expectNorm;
    if (hit) matched++;
    scored++;
    rows.push({
      id: c.id,
      expect: expectNorm,
      got: r.decision,
      match: hit,
      score: r.score,
      suggested_types: r.suggested_types,
      reasons: r.reasons,
    });
    console.log(
      `${c.id}: expect=${expectNorm} got=${r.decision} ${hit ? "OK" : "MISS"}`,
    );
  }

  const accuracy = scored ? matched / scored : 0;
  fs.mkdirSync(resultsDir, { recursive: true });
  const payload = {
    version: "0.1",
    generatedAt: new Date().toISOString(),
    note: "Heuristic format_choice only — not OpenAI official benchmark; UI scores are manual (TEMPLATE.md)",
    casesTotal: cases.length,
    scored,
    matched,
    accuracy,
    rows,
  };
  const jsonPath = path.join(resultsDir, "latest.json");
  const mdPath = path.join(resultsDir, "latest.md");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + "\n");
  const md = [
    "# Eval heuristic results (auto)",
    "",
    `Generated: ${payload.generatedAt}`,
    "",
    `Format accuracy: **${matched}/${scored}** = ${(accuracy * 100).toFixed(1)}% (heuristic only; not a CI hard fail for MISS).`,
    "",
    "Auto scores ≠ OpenAI official benchmark. Fill `TEMPLATE.md` for full dimensions.",
    "",
    toMdTable(rows),
  ].join("\n");
  fs.writeFileSync(mdPath, md);
  console.log(`wrote ${jsonPath}`);
  console.log(`wrote ${mdPath}`);
  console.log(
    `EVAL_OK format_accuracy=${matched}/${scored} (${(accuracy * 100).toFixed(1)}%)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
