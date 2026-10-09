# 能力缺口处理方案（G1–G10）

> 对应 `DESIGN-v0.1.md` §A。每个缺口：问题 → 不处理的后果 → 推荐方案（可分阶段）→ 依赖步骤 → 验收 → 明确不做的退路。

## 与落地顺序 ①–⑥ 映射表

| 步骤 | 名称 | 本步必须消化的缺口 | 本步可顺带 / 部分消化 |
|------|------|-------------------|----------------------|
| ① | stdio MCP + base/shadcn 真渲染 | G5（两包真渲染）、G8（最小 mcp.json） | G9（范围已写死） |
| ② | Host 参考窗 | G2 | G8（Host 启动说明） |
| ③ | session / 流式 / action | G3；G6 骨架（bind + action → patch） | refresh = optional |
| ④ | 自定义包受信加载 | G4 | — |
| ⑤ | policy / 裁判 | G1 | G6 可加强（表达式策略） |
| ⑥ | 其余 catalog + 评测 | G5 余包、G7 | G10 开关设计预留 |
| ⑥ 后 | 体验抛光 | G10 | — |

**原则**：后步依赖前步交付物；不可为了「完整对齐」口号在 ① 并行做七包真渲染或云端市场。

---

## G1 — 设计判断弱

### 问题陈述
OpenAI 把「何时纯文字 / 何时出图 / 怎么排」训进模型。我们只有 schema + 通用 LLM，默认会「什么都做成卡片」或「该交互时不出」。

### 不处理的后果
固定题集上误判率高；用户体感明显弱于 ChatGPT Intelligent UI，无法声称「不打折」。

### 推荐方案（分阶段）

**Phase A（⑤ 前可先做最小版，挂在 ① 的 `get_prompt_fragment`）**
1. 维护一份版本化 `promptFragment`（按 enabled packages 生成）：
   - 强制规则：事实题 / 是非题 / 单句定义 → `prefer_plain_text`；对比、流程、可调参、需点击确认 → UI。
   - 组件选择启发式：表格数据 → `DataTable`；趋势 → `LineChart`；二选一 → `ButtonGroup`；填参计算 → `Form`+`Slider`。
2. **UI Lint（MCP 侧，`ui_propose` / `ui_patch` 之后）**：
   - 规则示例：单段 `<80` 字且无 list/table 意图却带 `Card` 包一层 → warn；`Chart` 缺 `data` → reject；未启用包的 type → reject。
   - Lint 结果进 tool 返回的 `warnings[]`，严重则 `ok: false` 要求模型改。

**Phase B（⑤ 主交付）**
3. 可选 **裁判模型 API**（用户自备 key，配置 `IUI_POLICY_ENDPOINT` 或本地 CLI）：
   - 输入：user query + 拟议组件树摘要 + 纯文字备选。
   - 输出：`{ decision: "plain_text"|"ui", score, reasons[], suggested_types[] }`。
   - 默认关闭；开启时 `ui_propose` 前可先 `policy_check`（内部或独立 tool，v0.1.1 定）。
4. 不把裁判做成强制付费云；失败时降级回 Phase A。

**Phase C（⑥ 后 / 未来）**
5. 用 `EVAL-SET-V0` 收集偏好对，导出微调或 reward 数据——**不宣称复制 OpenAI 权重**。

### 依赖步骤
⑤ 为主；① 交付 prompt 片与 lint 钩子接口。

### 验收标准
- 评测集中「期望纯文字」题：误出 UI ≤ 约定阈值（初定 ≤20%，⑥ 再标定）。
- 「期望 UI」题：缺关键控件类型 ≤20%。
- 文档明确写：设计判断 = prompt + lint + 可选裁判，≠ OpenAI RL 权重。

### ⑤ 验收勾选
- [x] `get_prompt_fragment` 版本化规则（prefer_plain_text / UI 启发式）
- [x] Lint：`CARD_OVERWRAP`（warn）、`CHART_MISSING_DATA`（error reject）、既有 `UNKNOWN_TYPE` 等
- [x] 可选裁判：`IUI_POLICY_ENABLED`（默认关）+ `IUI_POLICY_ENDPOINT` / `IUI_POLICY_CMD`；tool `policy_check`；失败降级 Phase A
- [x] mock 裁判：`scripts/mock-policy-referee.mjs` + smoke HTTP mock
- [x] `npm run policy-smoke` → `POLICY_SMOKE_OK`
- [ ] 接真模型后 ≤20% 误判（留给 ⑥）

### 明确不做 / 退路
- 不做：训练/发布「对齐 OpenAI 的」封闭权重当卖点。
- 退路：仅 Phase A；产品文案改为「结构化 Generative UI」，弱化「设计判断对齐」。

---

## G2 — Host 嵌入缺失

### 问题陈述
Cursor / 多数 MCP 宿主只把 tool result 当文本气泡。Intelligent UI 的核心是**答案内嵌可点界面**——没有 Host，协议再完整也只是 JSON dump。

### 不处理的后果
演示永远是「看 JSON」；无法对齐 ChatGPT 内嵌体验；G3/G6 无法目视验收。

### 推荐方案
1. **独立参考 Host 窗**（②）：Vite + React（或同等），进程与 MCP stdio **解耦**：
   - MCP server 在写 `ui.*` 事件时，同时：
     - 经 MCP **notifications/logging**（若宿主支持）发出；以及
     - **本地旁路**：Unix domain socket 或 `~/.intelligent-ui-mcp/sessions/<id>.ndjson` 追加写入（默认 ndjson 文件旁路，实现简单、可回放）。
   - Host 订阅旁路 + 可选 socket；`ui_open` 时 Host 可自动 focus 或提示 session id。
2. **为何 Cursor 聊天气泡不够**：无官方 API 把任意组件树嵌进气泡；强行 HTML 不安全且各客户端不一致。故 v0.1 **不承诺** Cursor 气泡内嵌，只承诺「旁路 Host 窗 + 文档说明如何在自有 harness 嵌 Webview」。
3. ② 交付物：`packages/renderer-react` 或 `apps/host-window` + 启动脚本 `pnpm host`；README 写「先起 MCP，再起 Host，用同一 `IUI_SESSION_DIR`」。

### 依赖步骤
②；依赖 ① 至少能 `ui_open`/`ui_propose` 写出事件（哪怕先非流式整树）。

### 验收标准
- 人工：对「对比三款手机」propose → Host 窗出现卡片/表格，可点按钮触发 `ui_report_action` 回写。
- 不要求进 Cursor 气泡。

### 明确不做 / 退路
- 不做：劫持 Cursor DOM / 注入扩展改气泡（越权且脆）。
- 退路：仅 CLI `iui-dump` 把最新树渲染成静态 HTML 文件用浏览器打开（体验打折，仅调试）。

---

## G3 — 流式编译与会话状态

### 问题陈述
要对齐「边生成边出」，需要增量事件、会话生命周期、中断与 action 后续刷。设计摘要有，字段与状态机未写死（现由 `UI-DELTA-SCHEMA` / `SESSION-STATE` 补）。

### 不处理的后果
只能整树替换 → 首控件延迟高；多轮 patch 乱序；action 后全量闪烁。

### 推荐方案
1. 实现 **事件协议**（见 `UI-DELTA-SCHEMA.md`）：`ui.open` / `ui.delta` / `ui.replace` / `ui.done` / `ui.error` / `ui.action`。
2. 实现 **状态机**（见 `SESSION-STATE.md`）。
3. `ui_propose`：允许 `mode: "streaming_chunks"`（多段 JSON 文本拼接）或 `mode: "ops"`（直接传 `ops[]`）。① 可先只做整树 `replace`；③ 必须上 `upsert` 增量。
4. **refresh（对标 ChatGPT widget 续刷）**：列为 **③ optional**。API 草案：`ui_refresh` 或 `ui_propose` 带 `refresh: true` + `nodeId`，由 harness/工具侧拉新数据再 `patch_props`。v0.1 可不实现，文档保留扩展点。
5. 中断：`ui_close` 或新会话 `ui_open` 时取消进行中的 stream；未 `done` 的树标记 `partial: true`。

### 依赖步骤
③ 为主；① 至少支持单次 `replace` 以便 Host 联调。

### 验收标准
- 分片 5 次 upsert，Host 上控件逐步出现，无整页白屏重绘（③）。
- action → `ui_report_action` → `ui_patch` 只更新目标节点 props（③）。
- refresh：若未做，验收表标 N/A，不算 ③ 失败。

### ③ 验收勾选
- [x] `ui_propose mode=ops`：upsert / patch_props / remove / replace_tree（及 append_child / replace_children / move / set_bind）；原子失败 + `ui.error`
- [x] 连续 5× upsert → ≥5 `ui.delta` + revision 递增 + idle/`ui.done`（`stream-smoke`）
- [x] `ui_patch` + `ui_report_action` + `action_pending` → patch → idle
- [x] actions.ndjson watch 入库 + `ui_drain_actions` / `ui_get_pending_actions`（A+B）
- [x] 状态机核心转换 + mutex + closed 禁写 + `IUI_ACTION_TIMEOUT_MS`
- [x] `streaming_chunks` 简化：chunkDone 整段 parse（见 README 已知简化）
- [x] refresh = optional（N/A / warnings 别名）

### 明确不做 / 退路
- 不做：兼容 OpenAI 私有 GenUI 二进制协议。
- 退路：永久整树 replace（体验弱于流式，但功能可用）。

---

## G4 — 注册即渲染的信任模型

### 问题陈述
自定义包要带本地 `renderer` entry = 在 Host 进程执行第三方代码。无信任边界则等于任意代码执行。

### 不处理的后果
安全事件；或因恐惧而退回「只注册 schema」→ 违反「不打折 / 注册即渲染」拍板。

### 推荐方案
详见 `CUSTOM-PACKAGE-MANIFEST.md`，摘要：
1. **仅 local path**；路径必须落在 `IUI_TRUSTED_DIRS` allowlist（默认：`./packages`、用户配置的绝对路径列表）。
2. Manifest 含 `id`、`version`、`components[]`、`renderer.entry`、可选 `renderer.hash`（sha256 of entry bundle）。
3. 加载前：路径规范化拒绝 `..` 逃逸；校验 hash（若提供）；Host 用动态 `import()` **仅加载该 entry**，**绝不** `eval` 模型输出的 JS，也绝不执行组件树里的字符串脚本。
4. 失败降级：加载失败 → 该 type 用 `catalog.base/Unknown` 占位 + Host 黄条警告；MCP `register_package` 返回 `ok: false` 与原因。
5. 权限：自定义包默认 **不能** 读任意文件系统；Host 以 **iframe 沙箱**加载（`allow-scripts` only + CSP `connect-src 'none'`）；文档仍要求作者勿外联（CSP 硬拦网络）。

### 依赖步骤
④；manifest 规范本阶段先写死。

### 验收标准
- [x] 信任目录外的 path → register 拒绝（`PATH_NOT_TRUSTED`）。
- [x] 篡改 entry 导致 hash 不匹配 → `HASH_MISMATCH`（`strictHash` 默认 true；缺 hash → `HASH_MISSING`）。
- [x] 信任目录内合法包 → Host 能渲染自定义 `acme.gauges/Gauge`（`custom-smoke` + Host `/@fs` import）。

### ④ 交付摘要
- MCP：`register_package` / `register_component`（同包 schema 热更新）/ `unregister`；旁路写 `IUI_SESSION_DIR/registry.json` + `packages.ndjson`。
- 默认信任：`packages/`、`examples/custom-packages/`、`~/.intelligent-ui-mcp/trusted`；可用 `IUI_TRUSTED_DIRS` 追加。
- Host：轮询 `/api/packages`，对 entry 做 Vite `/@fs` 动态 import；失败黄条 + Unknown。
- **永不** eval 模型 JS；无 npm/url。

### 明确不做 / 退路
- 不做：npm/url 远程装包；模型生成的 inline JS 组件；完整 OS 进程沙箱（iframe 为 Web 边界）。
- 退路：自定义仅 schema + 强制手写 Host 映射表（体验折扣，仅当用户放弃「注册即渲染」时启用）。

---

## G5 — 七包真映射成本

### 问题陈述
七个 catalog 全做真 React 适配 = 工作量爆炸，拖死主路径。

### 不处理的后果
要么永远做不完，要么每包都是空 schema「假对齐」。

### 推荐方案
1. **①**：仅 `catalog.base` + `catalog.shadcn` **真渲染**（控件表见 `CATALOG-BASE-SHADCN.md`）。
2. **①–⑤**：`radix` / `mui` / `antd` / `chakra` / `charts` 可进仓库为 **schema-only 占位**（`list_components` 能列出，`renderer` 标 `status: "schema_only"`，命中时 Host 用 base 近似映射或 Unknown）。
3. **⑥**：按优先级补真映射，建议顺序 `charts` → `antd` → `mui` → `chakra` → `radix`（charts 对「Intelligent UI」演示价值最高；radix 偏头less 可与 shadcn 合并叙事）。
4. 用户 `set_enabled_packages` 启用 schema-only 包时，`get_prompt_fragment` 应注明「这些类型可能降级显示」。

### 依赖步骤
① / ⑥。

### 验收标准
- ①：`base`+`shadcn` 文档中列出的控件均可在 Host 点击/填写。
- ⑥ 前：其余包 `list_*` 不报错；渲染可降级。
- ⑥：至少再完成 `catalog.charts` 真渲染（最低加码）；其余按里程碑。

### ⑥ 验收勾选（G5）
- [x] `catalog.charts` 真渲染：LineChart / BarChart / PieChart（轻量 SVG）
- [x] `catalog.radix` / `mui` / `antd` / `chakra` schema-only 占位，`list_*` 可见
- [x] Host 别名映射（antd/mui Button 等 → shadcn）；未映射 → Unknown 黄条
- [x] 启用 schema-only 时 `get_prompt_fragment` 注明可能降级
- [x] `npm run catalog-smoke` → `CATALOG_SMOKE_OK`

### 明确不做 / 退路
- 不做：① 并行七套像素级复刻。
- 退路：永久只维护 base+shadcn+charts，其他包移出默认启用列表（需再拍板改名单）。

---

## G6 — 状态化小工具（bind / reduce）

### 问题陈述
小费计算器、账单分摊需要：控件改值 → 汇总变。只有静态 Form 不够。

### 不处理的后果
「可交互小工具」停在表单收集，算不出、连不动，弱于 OpenAI 演示。

### 推荐方案（分阶段）

**③ 骨架（必做最小闭环）**
1. Session 级 `state: Record<string, JSONValue>`（`ui_open` 可带 `initialState`）。
2. 节点可选 `bind: "tipPercent"` —— Host 在用户改控件时本地更新显示，并 `ui_report_action`：`{ type: "state.set", path: "tipPercent", value }`。
3. Harness/模型收到 action 后调用 `ui_patch` 或再次 `ui_propose` 更新衍生节点（如 `total` Label）。  
   → **计算权威在 harness/模型侧**，MCP 不做通用脚本引擎。

**⑤ 增强（可选）**
4. 安全表达式子集：`expr: "round(bill * (1 + tip/100), 2)"`，仅允许数值/字段引用与白名单函数；MCP 或 Host 求值后写回 state。解析器用成熟库或手写递归下降；**禁止**任意 JS。
5. 或 `reduce` 声明：`{ "total": { "op": "sum", "from": "lineItems.*.amount" } }`。

### 依赖步骤
③ 骨架；⑤ 表达式可选。

### 验收标准
- ③：滑条改 tip → action → patch 后总额 Label 更新（允许一轮模型延迟）。
- ⑤（若做）：无模型往返时本地 expr 也能更新总额。

### ③ 骨架勾选
- [x] Session `state`；`state.set` 写入；harness `ui_patch` 更新衍生 Label（`stream-smoke` phase2）
- [x] ⑤ expr / reduce：`evaluateExpr` 白名单 + session `reducers` + node `expr`；`state.set`/`ui_patch` 后 MCP 侧求值写回（`policy-smoke`）

### 明确不做 / 退路
- 不做：在组件树里嵌 `Function("...")` / 任意 `onClick` 字符串脚本。
- 退路：仅 action 回 harness 再 patch（多一跳 LLM，但安全且对齐「agent 在环」）。

---

## G7 — 评测与回归

### 问题陈述
无固定题集与打分表，「对齐」无法证伪。

### 不处理的后果
回归靠感觉；G1/G5 改进不可测。

### 推荐方案
1. 维护 `EVAL-SET-V0.md`（≥20 题意图）+ 后续 `evals/cases/*.json`（⑥ 落地文件）。
2. 打分维：`format_choice`（plain vs ui）、`component_fit`、`stream_ok`、`action_ok`、`safety`（无非法 type）。
3. ⑥ 提供脚本：跑 harness mock 或人工填表；可选接裁判模型打分。
4. CI：至少校验「每个 case 的 expectation 字段完整」与 schema 自洽；全自动 UI 判断不作 ⑥ 硬门槛。

### 依赖步骤
⑥；题集大纲本阶段先写。

### 验收标准
- ≥20 题意图文档存在且每题有期望格式/控件。
- ⑥ 结束时至少人工跑通一轮并留下结果表模板。

### ⑥ 验收勾选（G7）
- [x] `evals/cases/*.json` ≥20 题（字段：id/locale/prompt/expect.*）
- [x] `npm run eval` 启发式 format 表 → `evals/results/latest.*`
- [x] `npm run eval:validate` CI 硬门槛（字段/schema）
- [x] 人工填表 `evals/results/TEMPLATE.md`
- [ ] 接真模型后 ≤20% 误判标定（非硬失败）

### 明确不做 / 退路
- 不做：宣称自动分数 = OpenAI 官方基准。
- 退路：仅人工 checklist。

---

## G8 — Harness 分发

### 问题陈述
只有仓库能跑 = 没有产品。

### 不处理的后果
用户无法 5 分钟接入 Cursor / Claude Code / DSH。

### 推荐方案
1. **①** 起：`examples/mcp.json`（stdio 命令、`env`：`IUI_TRUSTED_DIRS`、`IUI_SESSION_DIR`）。
2. README：Cursor `mcpServers` 片段、Claude Desktop 片段、本地 `npx`/`node dist/index.js`。
3. **②** 补：Host 与 MCP 共目录说明；「两个进程」架构图。
4. 版本：semver；破坏性变更改 tool 名或加 `protocolVersion` 字段（事件与 tool 返回均带 `protocolVersion: "0.1"`）。

### 依赖步骤
① / ②。

### 验收标准
- 按文档，干净机器（已装 Node）5 分钟内 MCP 出现在宿主 tool 列表。
- Host 按文档能连上同一 session 目录。

### 明确不做 / 退路
- 不做：一键装系统服务、GUI installer（可后做）。
- 退路：仅文档 + 手动 `node`。

---

## G9 — 竞品边界

### 问题陈述
OpenUI Lang、A2UI、ChatKit Widgets、Vercel AI SDK Generative UI 已有重叠能力，范围不清会重复造轮或无限膨胀。

### 不处理的后果
工具面失控；或和现成库硬刚失去焦点。

### 推荐方案
维持 DESIGN §B，并补充差异一句话：
- **我们**：多 catalog 可勾选 + **任意 harness 的 stdio MCP** + **注册即渲染（local）** + 以对齐 ChatGPT **内嵌流式交互** 为验收。
- **不做**：取代设计系统；云市场；MCP 内执行模型 HTML/JS；复刻闭源视觉。
- 实现时可 **借鉴** OpenUI 的 DSL/流式思想、Vercel 的组件映射模式，但协议以本仓库 schema 为准（可提供转换适配器，非 ① 范围）。

### 依赖步骤
文档（已完成）；实现中遇范围争议以本文为准。

### 验收标准
- PR / 新 tool 提案若越界「不做」列表，需先改本文再写代码。

### 明确不做 / 退路
- 退路：做 thin wrapper 调 OpenUI——仅当用户改目标为「兼容 OpenUI」时，另开项目。

---

## G10 — 无障碍 / 密度 / i18n / 移动

### 问题陈述
OpenAI 有减弱视觉等开关；长期无 a11y/密度会对不齐「可关炫技」。

### 不处理的后果
演示党尚可，严肃场景与无障碍用户受损。

### 推荐方案
1. **⑥ 后**（或平行小项）：Host 设置 `density: "full"|"compact"|"plain_prefer"`，写入 session 或全局 config；`get_prompt_fragment` 读取后加一句「用户偏好 compact/plain」。
2. a11y：语义 HTML、按钮可键盘、图表附 `aria-label` / 数据表降级；对照 WCAG 2.1 A 为先。
3. i18n：控件 `label` 由模型按用户语言生成；Host chrome 中英文案表。
4. 移动：Host 响应式 layout；不承诺原生 iOS SDK（v0.x）。

### ⑥ 轻量预留（G10 density）
- [x] Host 密度选择器 `full|compact|plain_prefer|session` + CSS `iui-density-*`
- [x] `get_prompt_fragment` / `ui_open` 已支持 density；prompt 追加一句偏好
- [ ] 完整 a11y / i18n / 移动 → ⑥ 后

### 依赖步骤
⑥ 后；①–⑤ 不阻塞。

### 验收标准
- 密度开关存在且影响 prompt 或默认是否出大图。
- 基础键盘可达（抽测 shadcn Button/Form）。

### 明确不做 / 退路
- 不做：v0.1 像素级无障碍认证。
- 退路：仅文档列出已知限制。

---

## 汇总：建议开工闸门

| 闸门 | 条件 |
|------|------|
| 启动 ① | 本文 + TOOLS / 两包 catalog 已阅；用户明确说启动 |
| 启动 ② | ① 能写出至少 `ui.replace` 事件到旁路 |
| 启动 ③ | Host 能画静态树 |
| 启动 ④ | Host 映射机制稳定 + `CUSTOM-PACKAGE-MANIFEST` 已实现侧对照 |
| 启动 ⑤ | ③ action 闭环可用 + EVAL 至少可手工跑 |
| 启动 ⑥ | **⑤ 已交付**（policy-smoke）；评测大纲已落文件 |

