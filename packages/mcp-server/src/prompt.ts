import type { CatalogRegistry } from "./catalog/registry.js";

/** Versioned prompt rules for design judgment (G1 Phase A). Not OpenAI RL weights. */
export const PROMPT_FRAGMENT_VERSION = "0.3.0-hf-templates";

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
  lines.push("- 表格数据 / 对比列 → 优先 `catalog.shadcn/Comparison`（手机/商品对比可点选）；也可用 `DataTable`；columns 用 `{id,header}`");
  lines.push("- 趋势 / 时序 → `LineChart`/`catalog.charts/*`（若启用）否则 `DataTable` + 说明；**Chart 必须带 data**");
  lines.push("- 二选一 → `catalog.shadcn/ButtonGroup` 或两枚 `Button`");
  lines.push("- 计算器 / 键入运算 → `catalog.shadcn/Calculator`（本地算，勿拼一堆 Button）");
  lines.push("- 填参计算 → `Form` + `Input`/`Slider` + `Button`；衍生值可用 session `reducers` / 节点 `expr`");
  lines.push("- 分步流程 → `catalog.shadcn/Stepper`；待办勾选 → `catalog.shadcn/Checklist`");
  lines.push("- 地点/标记示意 → `catalog.shadcn/MapStub`；轻量对战小游戏 → `catalog.shadcn/GameShell`");
  lines.push("- 警告确认 → `Callout` / `AlertDialog`");
  lines.push("");
  lines.push("## Protocol rules");
  lines.push("1. Only use enabled ComponentTypes listed below.");
  lines.push(
    zh
      ? "2. 先 `ui_open`，再 `ui_propose`。**默认路径 = `mode=ops` 分片**（对比/表/列表强制）；`mode=tree` 仅极小单次表单；`streaming_chunks` = JSONL 逐行 ops。"
      : "2. `ui_open` then `ui_propose`. **Default path = `mode=ops` shards** (mandatory for compare/table/list); `mode=tree` only for tiny one-shot forms; `streaming_chunks` = JSONL ops.",
  );
  lines.push("3. Never emit executable HTML/JS; only registered component types.");
  lines.push("4. Optional: call `policy_check` before propose when unsure (if enabled).");
  lines.push(`5. Density preference: ${density}.`);
  lines.push(
    zh
      ? "6. `chunkDone`：分片时必须 `false`；**最后一次**才 `true`。省略 = 继续 streaming（Host 已上屏）。"
      : "6. `chunkDone`: false on shards; **true only on the last** call. Omit = keep streaming (Host already painted).",
  );
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
        ? "7. 用户偏好 plain_prefer：除非 UI 明显有助于交互/对比/计算，否则用纯文字。"
        : "7. User prefers plain_prefer: use plain text unless UI clearly helps interaction/compare/calc.",
    );
  } else if (density === "compact") {
    lines.push(
      zh
        ? "7. 用户偏好 compact：优先紧凑布局，少用大 Card/大图。"
        : "7. User prefers compact: prefer tight layout; avoid oversized Cards/charts.",
    );
  }
  lines.push("");
  lines.push(zh ? "## Data tool vs Render tool（防 remount）" : "## Data tool vs Render tool (anti-remount)");
  lines.push(
    zh
      ? "- **Render**：`ui_open` / `ui_propose` — 建壳、定类型、首次上树。贵；可能整卡/iframe remount。"
      : "- **Render**: `ui_open` / `ui_propose` — shell, types, first tree. Expensive; may remount card/iframe.",
  );
  lines.push(
    zh
      ? "- **Data**：`ui_patch`（`patch_props` / `statePatch`）— **保持 `node.id`**。刷新数字/文案/选中只用 Data。"
      : "- **Data**: `ui_patch` (`patch_props` / `statePatch`) — **keep `node.id`**. Refresh values with Data only.",
  );
  lines.push(
    zh
      ? "- 用户交互后：禁止 `ui_propose`+`replace_tree` 重画整卡；用 `ui_patch`。见 docs/DATA-VS-RENDER.md。"
      : "- After user interaction: no `ui_propose`+`replace_tree` rebuild; use `ui_patch`. See docs/DATA-VS-RENDER.md.",
  );
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
    lines.push(zh ? "## 示例（强制）：对比类 mode=ops 分片" : "## Example (mandatory): compare via mode=ops shards");
    lines.push(
      zh
        ? "禁止先想完整树再一次 `mode=tree`。按序多次 `ui_propose`："
        : "Do NOT build a full tree then one-shot `mode=tree`. Call `ui_propose` multiple times:",
    );
    lines.push("```json");
    lines.push(
      JSON.stringify(
        {
          step: 1,
          mode: "ops",
          chunkDone: false,
          ops: [
            {
              op: "replace_tree",
              tree: {
                id: "root",
                type: "catalog.base/Stack",
                props: { direction: "vertical", gap: 12 },
                children: [
                  {
                    id: "title",
                    type: "catalog.base/Markdown",
                    props: { text: "## 对比三款手机\n生成中…" },
                  },
                ],
              },
            },
          ],
        },
        null,
        2,
      ),
    );
    lines.push("```");
    lines.push("```json");
    lines.push(
      JSON.stringify(
        {
          step: 2,
          mode: "ops",
          chunkDone: false,
          ops: [
            {
              op: "upsert",
              parentId: "root",
              nodeId: "phone_table",
              node: {
                id: "phone_table",
                type: "catalog.shadcn/DataTable",
                props: {
                  caption: "旗舰对比",
                  columns: [
                    { id: "model", header: "机型" },
                    { id: "chip", header: "芯片" },
                    { id: "price", header: "价格" },
                  ],
                  rows: [],
                },
              },
            },
          ],
        },
        null,
        2,
      ),
    );
    lines.push("```");
    lines.push(
      zh
        ? "然后对 `phone_table` 多次 `patch_props` 追加 rows（每次 `chunkDone:false`），最后一次 `chunkDone:true`。或用 `catalog.shadcn/Comparison`：先壳+空 `items:[]`，再逐个 upsert item。"
        : "Then `patch_props` on `phone_table` to grow rows (`chunkDone:false` each time), final call `chunkDone:true`. Or use `catalog.shadcn/Comparison`: shell + empty `items:[]`, then upsert items one-by-one.",
    );
    lines.push("");
    lines.push(zh ? "## 示例（允许 tree）：极小表单" : "## Example (tree OK): tiny form");
    lines.push("```json");
    lines.push(
      JSON.stringify(
        {
          mode: "tree",
          tree: {
            id: "root",
            type: "catalog.base/Stack",
            props: { direction: "vertical", gap: 12 },
            children: [
              {
                id: "tip",
                type: "catalog.shadcn/Slider",
                props: { min: 0, max: 30, label: "小费 %", value: 15 },
                bind: "tipPercent",
              },
              {
                id: "go",
                type: "catalog.shadcn/Button",
                props: { label: "确认" },
                actions: {
                  onClick: { actionType: "submit", payload: { intent: "confirm" } },
                },
              },
            ],
          },
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
