import type { CatalogRegistry } from "./catalog/registry.js";

/** Versioned prompt rules for design judgment (G1 Phase A). Not OpenAI RL weights. */
export const PROMPT_FRAGMENT_VERSION = "0.1.8-embed-p1";

export function buildPromptFragment(
  catalog: CatalogRegistry,
  opts: {
    locale?: string;
    density?: "full" | "compact" | "plain_prefer";
    includeExamples?: boolean;
    maxChars?: number;
  } = {},
): { fragment: string; enabledTypes: string[]; version: string } {
  const locale = opts.locale ?? "zh-CN";
  const density = opts.density ?? "full";
  const includeExamples = opts.includeExamples ?? true;
  const maxChars = opts.maxChars ?? 6000;
  const zh = locale.startsWith("zh");

  const enabled = catalog.listComponents({ enabledOnly: true });
  const enabledTypes = enabled.map((c) => c.type);

  const byPkg = new Map<string, string[]>();
  for (const c of enabled) {
    const list = byPkg.get(c.packageId) ?? [];
    list.push(`${c.name} — ${c.description}`);
    byPkg.set(c.packageId, list);
  }

  const lines: string[] = [];
  lines.push(zh ? "# Intelligent UI 使用说明" : "# Intelligent UI instructions");
  lines.push(`<!-- promptFragmentVersion=${PROMPT_FRAGMENT_VERSION} -->`);
  lines.push("");
  lines.push(
    zh
      ? "你可以通过 MCP tools 生成可交互界面，而不是只输出纯文字。设计判断 = 本 prompt + MCP lint + 可选 policy 裁判（≠ OpenAI RL 权重）。"
      : "You can produce interactive UI via MCP tools. Design judgment = this prompt + MCP lint + optional policy referee (≠ OpenAI RL weights).",
  );
  lines.push("");
  lines.push(zh ? "## 格式选择（强制）" : "## Format choice (mandatory)");
  lines.push(
    zh
      ? "1. **prefer_plain_text**：事实题、是非题、单句定义、简单算术、无需点击确认的短答 → 不要建树；用 `ui_propose` 的 `plainTextFallback`，或根本不调 UI tools。"
      : "1. **prefer_plain_text**: facts, yes/no, one-sentence definitions, simple arithmetic, short answers needing no click → skip the tree; use `plainTextFallback` or no UI tools.",
  );
  lines.push(
    zh
      ? "2. **用 UI**：对比、多步流程、可调参/计算器、需点击确认、表格/图表展示、表单原型 → 建 `UiNode` 树。"
      : "2. **Use UI**: comparisons, multi-step flows, adjustable params/calculators, click-to-confirm, tables/charts, form prototypes → build a `UiNode` tree.",
  );
  lines.push(
    zh
      ? "3. 禁止「短文包一层 Card」：单段 <80 字说明不要用 Card 装饰（lint 会 `CARD_OVERWRAP` warn）。"
      : "3. Do not wrap short prose in a lone Card (lint warns `CARD_OVERWRAP`).",
  );
  lines.push("");
  lines.push(zh ? "## 组件启发式" : "## Component heuristics");
  lines.push("- 表格数据 / 对比列 → `catalog.shadcn/DataTable`（或 Card+表，勿空壳）；columns 用 `{id,header}`（也认 `{key,label}`）");
  lines.push("- 趋势 / 时序 → `LineChart`/`catalog.charts/*`（若启用）否则 `DataTable` + 说明；**Chart 必须带 data**");
  lines.push("- 二选一 → `catalog.shadcn/ButtonGroup` 或两枚 `Button`");
  lines.push("- 填参计算 → `Form` + `Input`/`Slider` + `Button`；衍生值可用 session `reducers` / 节点 `expr`");
  lines.push("- 分步说明 → `Accordion` 或分步 Card +「下一步」Button");
  lines.push("- 警告确认 → `Callout` / `AlertDialog`");
  lines.push("");
  lines.push("## Protocol rules");
  lines.push("1. Only use enabled ComponentTypes listed below.");
  lines.push("2. Call `ui_open` then `ui_propose` (`mode=tree|ops|streaming_chunks`).");
  lines.push("3. Never emit executable HTML/JS; only registered component types.");
  lines.push("4. Optional: call `policy_check` before propose when unsure (if enabled).");
  lines.push(`5. Density preference: ${density}.`);
  lines.push("");
  lines.push(zh ? "## 流式生成（P0 强制）" : "## Progressive streaming (P0 mandatory)");
  lines.push(
    zh
      ? "- **对比 / 表格 / 多行列表**：禁止单次巨型 `mode=tree`。必须 `mode=ops` + `chunkDone:false` 分片 upsert：① Stack/壳 → ② DataTable 表头（空 rows）→ ③ 逐行 phone/商品 → ④ 最后一次 `chunkDone:true`。"
      : "- **Comparisons / tables / multi-row lists**: do NOT one-shot `mode=tree`. Use `mode=ops` with `chunkDone:false`: (1) Stack shell → (2) DataTable headers (empty rows) → (3) upsert rows one-by-one → (4) final `chunkDone:true`.",
  );
  lines.push(
    zh
      ? "- 或用 `mode=streaming_chunks` 发 **JSONL**（每行一个完整 upsert op，行末 `\n`）；Host 会边收边画，勿等整段 JSON 闭合。"
      : "- Or `mode=streaming_chunks` with **JSONL** (one complete upsert op per line + `\n`); Host paints each line; do not wait for a closed whole-tree JSON.",
  );
  lines.push(
    zh
      ? "- 联调验收只回 `embedUrl`（`ui_open` 返回，`?embed=1&sessionId=`）/ `hostUrl` / sessionId；优先让用户在旁栏 Simple Browser / iframe 打开 embed；**不要**用桌面截图挡首屏。"
      : "- For demos: return `embedUrl` from `ui_open` (`?embed=1&sessionId=`) / `hostUrl` / sessionId; prefer Simple Browser / iframe beside chat; do **not** block first paint on desktop screenshots.",
  );
  lines.push(
    zh
      ? "- 若 `hostReady=false`：提示用户先 `IUI_SESSION_DIR=… npm run host`，再打开 `embedUrl`。"
      : "- If `hostReady=false`: tell the user to run `IUI_SESSION_DIR=… npm run host`, then open `embedUrl`.",
  );
  if (density === "plain_prefer") {
    lines.push(
      zh
        ? "6. 用户偏好 plain_prefer：除非 UI 明显有助于交互/对比/计算，否则用纯文字。"
        : "6. User prefers plain_prefer: use plain text unless UI clearly helps interaction/compare/calc.",
    );
  } else if (density === "compact") {
    lines.push(
      zh
        ? "6. 用户偏好 compact：优先紧凑布局，少用大 Card/大图。"
        : "6. User prefers compact: prefer tight layout; avoid oversized Cards/charts.",
    );
  }
  lines.push("");
  lines.push("## Enabled components");
  for (const [pkg, comps] of byPkg) {
    lines.push(`### ${pkg}`);
    for (const line of comps) lines.push(`- ${line}`);
  }

  const schemaOnlyEnabled = catalog
    .listPackages({ includeDisabled: false, includeSchemaOnly: true })
    .filter((p) => p.renderStatus === "schema_only" && p.enabled);
  if (schemaOnlyEnabled.length) {
    lines.push("");
    lines.push(zh ? "## Schema-only 降级提示" : "## Schema-only degradation note");
    lines.push(
      zh
        ? `已启用 schema-only 包：${schemaOnlyEnabled.map((p) => p.id).join(", ")}。Host 可能映射到 base/shadcn 近似控件，或显示 Unknown 黄条；勿假设像素级原厂外观。`
        : `Enabled schema-only packages: ${schemaOnlyEnabled.map((p) => p.id).join(", ")}. Host may alias to base/shadcn or show Unknown; do not assume pixel-perfect vendor look.`,
    );
  }

  if (includeExamples) {
    lines.push("");
    lines.push("## Example tree (tip calculator skeleton)");
    lines.push("```json");
    lines.push(
      JSON.stringify(
        {
          id: "root",
          type: "catalog.base/Stack",
          props: { direction: "vertical", gap: 12 },
          children: [
            {
              id: "t1",
              type: "catalog.base/Markdown",
              props: { text: "## 账单分摊" },
            },
            {
              id: "tip",
              type: "catalog.shadcn/Slider",
              props: { min: 0, max: 30, label: "小费 %", value: 15 },
              bind: "tipPercent",
            },
            {
              id: "total",
              type: "catalog.shadcn/Badge",
              props: { text: "—" },
              expr: { text: "round(bill * (1 + tipPercent/100), 2)" },
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
        },
        null,
        2,
      ),
    );
    lines.push("```");
  }

  let fragment = lines.join("\n");
  if (fragment.length > maxChars) {
    fragment = fragment.slice(0, maxChars - 20) + "\n…[truncated]";
  }
  return { fragment, enabledTypes, version: PROMPT_FRAGMENT_VERSION };
}
