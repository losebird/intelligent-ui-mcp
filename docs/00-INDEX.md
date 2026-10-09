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
10. [`STREAMING-UX-GAP.md`](./STREAMING-UX-GAP.md) — 流式 UX vs OpenAI/OpenUI/OpenGenerativeUI 缺口与 P0/P1。
11. [`HARNESSLESS-FEASIBILITY.md`](./HARNESSLESS-FEASIBILITY.md) — 「无 Renderer 壳也要气泡内 Intelligent UI」可行性（MCP 硬限制 / 选项排序 / 产品立场）。
12. [`HOST-RENDERER-ADAPTER.md`](./HOST-RENDERER-ADAPTER.md) — **选项 A**：宿主产品嵌 `@intelligent-ui/renderer-react` 的契约（open/stream/action、最小 API、里程碑）。
13. [`HOST-ADAPTER-M0-CHECKLIST.md`](./HOST-ADAPTER-M0-CHECKLIST.md) — 选项 A **M0**：`packages/host-adapter` 对照清单 → Webview/气泡 PoC 步骤。
14. [`PRODUCT-BUBBLE-MOUNT.md`](./PRODUCT-BUBBLE-MOUNT.md) — **给 Cursor/Grok 产品+平台**：气泡挂载点 / 事件通道 / action 闭环需求（选项 A · M2）。

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
| `STREAMING-UX-GAP.md` | G2/G3 体验 | 边输出边生成 UX 缺口与整改 |
| `HARNESSLESS-FEASIBILITY.md` | G2/G9 产品边界 | 无壳气泡目标 vs MCP 硬限制；选项 A–D |
| `HOST-RENDERER-ADAPTER.md` | 选项 A 宿主合作 | 气泡内嵌 renderer 契约；我们交付 vs 宿主建设 |
| `HOST-ADAPTER-M0-CHECKLIST.md` | 选项 A / M0 | host-adapter 包验收；interim 泵 vs 产品通道；M1 Webview 预告 |
| `PRODUCT-BUBBLE-MOUNT.md` | 选项 A / M2 产品需求 | Cursor/Grok 气泡 slot、低延迟 ui.* 通道、ProductBubbleChannel |

## 与代码的关系

- **① 已落地**：`packages/mcp-server`（stdio）、`catalog-base` / `catalog-shadcn`、`renderer-react`；`npm run build && npm run smoke`。
- **② 已落地**：`apps/host-window`（Vite Host 参考窗 + 文件旁路 API）；`npm run host` / `npm run host-smoke`。`ui_open` 可自动 spawn Host + 打开一键 URL（见 `AUDIT-P1-AUTO-HOST.md`）。
- **③ 已落地**：`mode=ops` / `streaming_chunks`、`ui_patch` / `ui_report_action`、actions watch + `ui_drain_actions`、状态机 + G6 骨架；`npm run stream-smoke`。
- **④ 已落地**：`register_package` / `register_component` / `unregister` + 信任目录 + `examples/custom-packages/acme-gauges` + Host 动态 import；`npm run custom-smoke`。
- **⑤ 已落地**：设计判断 = prompt + lint + 可选裁判（≠ OpenAI RL）；`policy_check` / `evaluate_expr`；G6 安全 expr + reducers；`npm run policy-smoke`。
- **选项 A / M0 脚手架**：`packages/host-adapter`（`IntelligentUiHostSurface` + HTTP/NDJSON interim 泵 + `HostSurfaceView`）；产品气泡通道宿主自有。详见 `HOST-ADAPTER-M0-CHECKLIST.md`。
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

- [`AUDIT-P0-SANDBOX-CI.md`](./AUDIT-P0-SANDBOX-CI.md) — 自定义包 iframe 沙箱 + CI
- [`AUDIT-P1-AUTO-HOST.md`](./AUDIT-P1-AUTO-HOST.md) — ui_open 自动拉起 Host + strictHash 默认
