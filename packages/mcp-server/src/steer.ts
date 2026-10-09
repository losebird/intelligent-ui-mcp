/**
 * Always-on Intelligent UI steer.
 * Injected as MCP initialize `instructions` so harnesses (dsh-mcp-client,
 * Cursor, etc.) see selection rules without calling `get_prompt_fragment`.
 * Also prepended to the full prompt fragment.
 */

import {
  RECIPE_INTAKE_FORM,
  RECIPE_RESOURCE_BOARD,
  RECIPE_WEATHER_CARD,
} from "./recipes.js";

export const STEER_VERSION = "0.4.0-auto-steer";

export function buildAlwaysOnInstructions(
  opts: { locale?: string; includeRecipes?: boolean } = {},
): string {
  const zh = (opts.locale ?? "zh-CN").startsWith("zh");
  const includeRecipes = opts.includeRecipes ?? true;
  const lines: string[] = [];

  lines.push(
    zh
      ? `# Intelligent UI 自动选用（无需口头禅）<!-- steerVersion=${STEER_VERSION} -->`
      : `# Intelligent UI auto-steer (no magic phrases) <!-- steerVersion=${STEER_VERSION} -->`,
  );
  lines.push("");
  lines.push(
    zh
      ? "用户**不必**说「必须用 Intelligent UI / 用 ui_open」。自然问句只要属于下面意图，默认 **同一回合** `ui_open` → `ui_propose`（真实 tree/ops，禁止空壳、禁止 `plainTextFallback`）。先写 1–3 句散文，再出气泡控件。"
      : "Users do **not** need to say “use Intelligent UI / ui_open”. For the intents below, default **same-turn** `ui_open` → `ui_propose` (real tree/ops; no empty shell; no `plainTextFallback`). 1–3 sentences of prose, then bubble UI.",
  );
  lines.push("");
  lines.push(zh ? "## 默认用 UI（强制）" : "## Default to UI (mandatory)");
  lines.push(
    zh
      ? [
          "- **资源 / 系统看板**：内存、CPU、磁盘、负载、电脑/Mac 状态 → 指标磁贴（`Grid`+`Card`+`Progress`+数字）。缺真实数据可用示意数字。",
          "- **天气**：某地今天/预报 → 天气卡（当前况 + 逐小时 `LineChart` + 未来几天条/表）。",
          "- **多字段采集**：论文/毕业写作、问卷、缺参才能开工 → `Form`+`ButtonGroup`（单选/分段）+`Input`，不要用 Markdown 列表代替表单。",
          "- **A vs B / 对比表**：`Comparison` 或 `DataTable`，`mode=ops` 分片。",
          "- **计算器 / 可调参 / 步骤 / 图表 / 需点击确认**：照旧建树。",
        ].join("\n")
      : [
          "- **Resource / system board**: memory, CPU, disk, load, computer status → metric tiles (`Grid`+`Card`+`Progress`+figures). Placeholder numbers OK.",
          "- **Weather**: place + today/forecast → weather card (now + hourly `LineChart` + next-days bars/table).",
          "- **Multi-field intake**: thesis/writing, surveys, missing params → `Form`+`ButtonGroup`+`Input`. Do not replace the form with a Markdown list.",
          "- **A vs B / compare**: `Comparison` or `DataTable`, `mode=ops` shards.",
          "- **Calculator / sliders / steps / charts / click-to-confirm**: still UI.",
        ].join("\n"),
  );
  lines.push("");
  lines.push(zh ? "## 才用纯文字" : "## Plain text only when");
  lines.push(
    zh
      ? "事实题、是非题、单句定义、简单算术、用户明确「只要说明」且不要原型。短问「怎么样」若是资源/天气/看板 → 仍是 UI，不是 plain_text。"
      : "Facts, yes/no, one-sentence definitions, simple arithmetic, or explicit “just explain” with no prototype. Short “how is X” for resources/weather/dashboards is still UI, not plain_text.",
  );
  lines.push("");
  lines.push(zh ? "## 同回合协议" : "## Same-turn protocol");
  lines.push(
    zh
      ? [
          "1. `ui_open`（可带 `query`）后**立刻** `ui_propose`，不要只开空 session。",
          "2. 看板/天气/表单：`mode=tree` 一次出齐也可；对比/多行表必须 `mode=ops` 分片。",
          "3. 禁止 `ui.done reason=plain_text` / 空壳等超时。Host 鉴权与 empty-shell / mustPropose **不得削弱**。",
          "4. 不要用「必须用 Intelligent UI」之类口头禅当开关；意图本身就是开关。",
          "5. `get_prompt_fragment` 可选（完整目录）；本说明已在 MCP `instructions` 里，不必先调。",
        ].join("\n")
      : [
          "1. After `ui_open` (optional `query`), **immediately** `ui_propose` — never leave an empty session.",
          "2. Board/weather/form: one-shot `mode=tree` is OK; compare/multi-row must use `mode=ops` shards.",
          "3. Do not `ui.done reason=plain_text` or idle empty shells. Do not weaken Host auth / empty-shell / mustPropose.",
          "4. Magic phrases are not the switch; intent is.",
          "5. `get_prompt_fragment` is optional (full catalog); this text is already in MCP `instructions`.",
        ].join("\n"),
  );

  if (includeRecipes) {
    lines.push("");
    lines.push(zh ? "## 窄食谱（现有 catalog）" : "## Narrow recipes (existing catalog)");
    lines.push(
      zh
        ? "资源看板 → `RECIPE_RESOURCE_BOARD`；天气卡 → `RECIPE_WEATHER_CARD`；论文采集 → `RECIPE_INTAKE_FORM`。数字可虚构。"
        : "Resource board → `RECIPE_RESOURCE_BOARD`; weather → `RECIPE_WEATHER_CARD`; thesis intake → `RECIPE_INTAKE_FORM`. Figures may be fake.",
    );
    lines.push("");
    lines.push("### resource_board");
    lines.push("```json");
    lines.push(JSON.stringify(RECIPE_RESOURCE_BOARD));
    lines.push("```");
    lines.push("### weather_card");
    lines.push("```json");
    lines.push(JSON.stringify(RECIPE_WEATHER_CARD));
    lines.push("```");
    lines.push("### intake_form");
    lines.push("```json");
    lines.push(JSON.stringify(RECIPE_INTAKE_FORM));
    lines.push("```");
  }

  return lines.join("\n");
}
