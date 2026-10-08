/**
 * Phase A local heuristic: query → plain_text | ui (+ suggested types).
 * Used by get_prompt guidance, mock referee, and EVAL format smoke.
 * Not OpenAI RL — just rules.
 */

export type FormatDecision = "plain_text" | "ui";

export interface ClassifyResult {
  decision: FormatDecision;
  score: number;
  reasons: string[];
  suggested_types: string[];
}

const PLAIN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /是哪个国家|capital of|等于几|等于多少|what is \d|星期几|what day/i, reason: "factual / arithmetic" },
  { re: /一句话解释|一句话说明|用一句话|in one sentence|define (what|tcp|http)/i, reason: "one-sentence definition" },
  { re: /^(yes|no|是|否|对|错)[?？]?$|只回答\s*(yes|no)|true or false|是非题/i, reason: "yes/no" },
  { re: /地球绕着|是否.*\?$|吗[？?]\s*$/i, reason: "boolean / closed question" },
  { re: /只要说明|列出.*字段.*说明|如何 register_package|怎么注册包/i, reason: "explanation-only" },
];

const UI_PATTERNS: Array<{ re: RegExp; reason: string; types: string[] }> = [
  {
    re: /对比|compare|vs\.?|versus|三款|续航与售价/i,
    reason: "comparison",
    types: ["catalog.shadcn/DataTable", "catalog.shadcn/Card", "catalog.shadcn/Tabs"],
  },
  {
    re: /趋势|折线|营收|chart|line chart|画一个.*图/i,
    reason: "trend / chart",
    types: ["catalog.shadcn/DataTable", "catalog.charts/LineChart"],
  },
  {
    re: /小费|计算器|账单|AA\s*制|分摊|可调|slider|计算/i,
    reason: "calculator / adjustable params",
    types: [
      "catalog.shadcn/Form",
      "catalog.shadcn/Slider",
      "catalog.shadcn/Input",
      "catalog.shadcn/Button",
    ],
  },
  {
    re: /二选一|是否加班|ButtonGroup|两[个]?按钮/i,
    reason: "binary choice",
    types: ["catalog.shadcn/ButtonGroup", "catalog.shadcn/Button"],
  },
  {
    re: /步骤|更换.*内胎|下一步|accordion|流程/i,
    reason: "step / process",
    types: ["catalog.shadcn/Accordion", "catalog.shadcn/Card", "catalog.shadcn/Button"],
  },
  {
    re: /登录页|表单原型|Form\b|原型/i,
    reason: "form prototype",
    types: ["catalog.shadcn/Card", "catalog.shadcn/Form", "catalog.shadcn/Input", "catalog.shadcn/Button"],
  },
  {
    re: /对照表|DataTable|格式化显示|CodeBlock|标签页|Tabs|进度|Progress|开关|Switch|下拉|Select|警告|Callout|AlertDialog/i,
    reason: "explicit UI widget ask",
    types: [],
  },
  {
    re: /schema_only|antd.*按钮|做按钮|mui.*Button|启用.*antd/i,
    reason: "schema-only / vendor button UI",
    types: ["catalog.antd/Button", "catalog.shadcn/Button"],
  },
  {
    re: /光照强度|可调.*看|示意/i,
    reason: "interactive demo",
    types: ["catalog.shadcn/Slider", "catalog.base/Markdown", "catalog.shadcn/Badge"],
  },
];

/** Map explicit widget keywords to types when types[] left empty above. */
function explicitTypes(query: string): string[] {
  const out: string[] = [];
  if (/对照表|DataTable|表格/i.test(query)) out.push("catalog.shadcn/DataTable");
  if (/CodeBlock|格式化.*JSON|代码块/i.test(query)) out.push("catalog.base/CodeBlock");
  if (/Tabs|标签页/i.test(query)) out.push("catalog.shadcn/Tabs");
  if (/Progress|进度/i.test(query)) out.push("catalog.shadcn/Progress");
  if (/Switch|开关/i.test(query)) out.push("catalog.shadcn/Switch");
  if (/Select|下拉/i.test(query)) out.push("catalog.shadcn/Select");
  if (/警告|Callout|AlertDialog|不可恢复/i.test(query))
    out.push("catalog.base/Callout", "catalog.shadcn/AlertDialog");
  return out;
}

export function classifyFormat(query: string): ClassifyResult {
  const q = (query ?? "").trim();
  if (!q) {
    return {
      decision: "plain_text",
      score: 0.5,
      reasons: ["empty query → prefer plain"],
      suggested_types: [],
    };
  }

  const reasons: string[] = [];
  const suggested = new Set<string>();

  let uiHits = 0;
  let plainHits = 0;

  for (const p of UI_PATTERNS) {
    if (p.re.test(q)) {
      uiHits++;
      reasons.push(`ui: ${p.reason}`);
      for (const t of p.types) suggested.add(t);
    }
  }
  for (const t of explicitTypes(q)) suggested.add(t);

  for (const p of PLAIN_PATTERNS) {
    if (p.re.test(q)) {
      plainHits++;
      reasons.push(`plain: ${p.reason}`);
    }
  }

  // Short factual-looking questions without UI cues
  if (
    uiHits === 0 &&
    (q.length < 40 || /[？?]\s*$/.test(q)) &&
    !/对比|表单|计算|步骤|开关|进度|图表|标签/i.test(q)
  ) {
    plainHits++;
    reasons.push("plain: short closed question heuristic");
  }

  if (uiHits > plainHits) {
    return {
      decision: "ui",
      score: Math.min(0.95, 0.55 + uiHits * 0.12),
      reasons: reasons.length ? reasons : ["ui pattern matched"],
      suggested_types: [...suggested],
    };
  }
  if (plainHits > 0 && uiHits === 0) {
    return {
      decision: "plain_text",
      score: Math.min(0.95, 0.6 + plainHits * 0.1),
      reasons,
      suggested_types: [],
    };
  }
  if (uiHits > 0 && plainHits > 0) {
    // Prefer UI when both fire but UI is stronger intent words
    const preferUi = /对比|计算|表单|步骤|滑|开关|图表/i.test(q);
    return preferUi
      ? {
          decision: "ui",
          score: 0.65,
          reasons,
          suggested_types: [...suggested],
        }
      : {
          decision: "plain_text",
          score: 0.6,
          reasons,
          suggested_types: [],
        };
  }

  return {
    decision: "plain_text",
    score: 0.55,
    reasons: reasons.length ? reasons : ["default prefer plain_text"],
    suggested_types: [],
  };
}

/** EVAL-SET-V0 subset for heuristic smoke (≥5). */
export const EVAL_HEURISTIC_CASES: Array<{
  id: string;
  query: string;
  expect: FormatDecision;
}> = [
  { id: "1", query: "巴黎是哪个国家的首都？", expect: "plain_text" },
  { id: "2", query: "用一句话解释什么是 TCP", expect: "plain_text" },
  { id: "3", query: "2+2 等于几？", expect: "plain_text" },
  { id: "21", query: "只回答 yes 或 no：地球绕着太阳转吗？", expect: "plain_text" },
  { id: "6", query: "对比 iPhone 16 / Pixel 9 / Galaxy S25 的续航与售价", expect: "ui" },
  { id: "8", query: "帮我做一个小费计算器：账单金额、小费比例、人数", expect: "ui" },
  { id: "11", query: "给我一个是否加班的二选一", expect: "ui" },
  { id: "10", query: "用可点步骤说明怎么更换自行车内胎", expect: "ui" },
];
