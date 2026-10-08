# Intelligent UI MCP — 文档索引

> 文档为单一事实来源；①–⑥ 已落地。技术标识符保持英文。

## 阅读顺序（建议）

1. [`../DESIGN-v0.1.md`](../DESIGN-v0.1.md) — 目标、已拍板项、对齐清单、落地顺序 ①–⑥、缺口总表 G1–G10、竞品边界。
2. [`GAPS-REMEDIATION.md`](./GAPS-REMEDIATION.md) — **每个缺口怎么处理**（可执行方案 + 与 ①–⑥ 映射）。先读这个再谈开工。
3. [`TOOLS-SCHEMA.md`](./TOOLS-SCHEMA.md) — MCP tools 字段级 schema。
4. [`UI-DELTA-SCHEMA.md`](./UI-DELTA-SCHEMA.md) — 流式事件与 node 形状。
5. [`SESSION-STATE.md`](./SESSION-STATE.md) — Session 状态机。
6. [`CATALOG-BASE-SHADCN.md`](./CATALOG-BASE-SHADCN.md) — ① 真渲染的两包控件表。
7. [`HOST-WINDOW.md`](./HOST-WINDOW.md) — ② 参考 Host 窗需求。
8. [`CUSTOM-PACKAGE-MANIFEST.md`](./CUSTOM-PACKAGE-MANIFEST.md) — ④ 自定义包 manifest / 信任模型。
9. [`EVAL-SET-V0.md`](./EVAL-SET-V0.md) — ⑥ 评测题集 v0 大纲。

## 文件一览

| 文件 | 对应缺口 / 步骤 | 用途 |
|------|-----------------|------|
| `GAPS-REMEDIATION.md` | G1–G10 → ①–⑥ | 处理方案与验收 |
| `TOOLS-SCHEMA.md` | ① 起 | Tool input/output |
| `UI-DELTA-SCHEMA.md` | G3 / ③ | 事件协议 |
| `SESSION-STATE.md` | G3 / ③ | 状态机 |
| `CATALOG-BASE-SHADCN.md` | G5 / ① | base + shadcn 控件 |
| `HOST-WINDOW.md` | G2 / ② | 参考渲染窗 |
| `CUSTOM-PACKAGE-MANIFEST.md` | G4 / ④ | 注册即渲染规范 |
| `EVAL-SET-V0.md` | G7 / ⑥ | ≥20 题意图 |

## 与代码的关系

- **① 已落地**：`packages/mcp-server`（stdio）、`catalog-base` / `catalog-shadcn`、`renderer-react`；`npm run build && npm run smoke`。
- **② 已落地**：`apps/host-window`（Vite Host 参考窗 + 文件旁路 API）；`npm run host` / `npm run host-smoke`。
- **③ 已落地**：`mode=ops` / `streaming_chunks`、`ui_patch` / `ui_report_action`、actions watch + `ui_drain_actions`、状态机 + G6 骨架；`npm run stream-smoke`。
- **④ 已落地**：`register_package` / `register_component` / `unregister` + 信任目录 + `examples/custom-packages/acme-gauges` + Host 动态 import；`npm run custom-smoke`。
- **⑤ 已落地**：设计判断 = prompt + lint + 可选裁判（≠ OpenAI RL）；`policy_check` / `evaluate_expr`；G6 安全 expr + reducers；`npm run policy-smoke`。
- **⑥ 已落地**：`catalog.charts` 真渲染（Line/Bar/Pie）；`catalog.radix|mui|antd|chakra` schema-only + Host 别名；`evals/cases/*.json`（≥20）+ `npm run eval` / `eval:validate`；`npm run catalog-smoke`。G10 密度预留（Host 选择器 + prompt 一句偏好）。

## 术语速查

| 术语 | 含义 |
|------|------|
| `catalog.*` | 内置组件包 id |
| Host | 真正把组件树画出来的进程/窗 |
| Harness | 任意 agent 运行时（Cursor、Claude Code、DSH…） |
| `ui.delta` | 流式增量事件 |
| Session | 一次 UI 会话（`ui_open` … `ui_close`） |
| 注册即渲染 | schema + 受信本地 renderer entry 一并加载 |
