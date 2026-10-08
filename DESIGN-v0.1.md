# Intelligent UI MCP — 架构与工具面设计 v0.1（完整对齐）

目标：**用户侧体验与能力对齐 OpenAI Intelligent UI，不打折**——流式原生控件、按题选型与布局、可交互小工具、纯文字回退、设计判断到位；以 MCP + 任意 harness 交付，不绑 ChatGPT。

对齐 ≠ 抄闭源：私有组件库 → 多套开源 `catalog.*`；私有编译器/训练 → 自建协议 + 策略层（可接裁判模型）。

**细节文档目录**：[`docs/00-INDEX.md`](./docs/00-INDEX.md)（工具 schema、事件、状态机、控件表、Host、manifest、评测、缺口处理方案均在 `docs/`）。

## 已拍板

1. 默认 **多库**（`catalog.base` + shadcn / radix / mui / antd / chakra / charts 等），非单库。
2. 自定义控件：**注册即渲染**（schema + 受信本地实现一并加载），不是只挂 schema。
3. 传输：先 **stdio MCP**。
4. 自定义包来源：v0.1 **仅 local path**（内置 catalog 打进仓库；npm/url 后开）。
5. 默认七包名单 **不动**；真渲染分期（见落地顺序）。
6. 文档补全优先于写代码；实现须用户明确启动 ①。

## 能力对齐清单（验收用）

| OpenAI Intelligent UI | 本 MCP 对齐方式 |
|----------------------|-----------------|
| 答案内嵌图表/按钮/表单/小工具 | 组件树 + Host 实时渲染 |
| 按问题选格式，简单题纯文字 | `get_prompt_fragment` + 可选 UI 裁判 + `prefer_plain_text` |
| 边生成边出界面 | `ui_propose` 增量 + 流式编译事件 |
| Native 组件、跨端一致 | 多 catalog + 各宿主适配器；禁止任意 HTML/JS |
| 可点可填可算 | `ui_report_action` → 再 patch / 再答 |
| 设计判断 | v0.1：强 prompt + lint；v0.1.1：可选第二模型打分 |

## 分层

Harness → MCP（Catalog / Schema / Compile / Session / Action / Policy）→ Host Renderer（内置包必带映射；自定义包带本地 renderer 入口）。

自定义注册：`manifest.json` + `propsSchema` + **受信** `renderer` 入口（如 `entry: "./render.tsx"`），仅 local path，宿主白名单加载。详见 [`docs/CUSTOM-PACKAGE-MANIFEST.md`](./docs/CUSTOM-PACKAGE-MANIFEST.md)。

## 工具面（摘要）

目录：`list_packages`、`list_components`、`set_enabled_*`、`register_package`、`register_component`、`unregister`、`get_prompt_fragment`、`get_json_schema`  
会话：`ui_open`、`ui_propose`、`ui_patch`、`ui_close`、`ui_get_state`、`ui_report_action`  
事件：`ui.open` / `ui.delta` / `ui.replace` / `ui.done` / `ui.error` / `ui.action`

字段级 schema → [`docs/TOOLS-SCHEMA.md`](./docs/TOOLS-SCHEMA.md)；事件 → [`docs/UI-DELTA-SCHEMA.md`](./docs/UI-DELTA-SCHEMA.md)。

## 默认包命名

`catalog.base` | `catalog.shadcn` | `catalog.radix` | `catalog.mui` | `catalog.antd` | `catalog.chakra` | `catalog.charts`

① 真渲染：base + shadcn（[`docs/CATALOG-BASE-SHADCN.md`](./docs/CATALOG-BASE-SHADCN.md)）。其余 ⑥ 前可 schema-only。

## 安全

- 无远程任意代码；自定义仅 local + 显式信任目录
- 模型仍不能吐裸 script；只出已注册 type
- Action payload 限大小
- 不 `eval` 模型 JS（见 G4 方案）

## 落地顺序（已拍板 2026-10-08）

1. stdio MCP + `catalog.base` / `catalog.shadcn` **真渲染**
2. Host 参考窗（把 `ui.delta` 画出来）— [`docs/HOST-WINDOW.md`](./docs/HOST-WINDOW.md)
3. session / 流式 / action 闭环 — [`docs/SESSION-STATE.md`](./docs/SESSION-STATE.md)
4. 自定义包受信加载（注册即渲染，仅 local path）
5. policy / 裁判（设计判断）
6. 其余 catalog（radix/mui/antd/chakra/charts）真映射 + 评测集 — [`docs/EVAL-SET-V0.md`](./docs/EVAL-SET-V0.md)

验收原则：七包名单保留；除 base/shadcn 外可先 schema 齐、映射后补，避免七套同时真渲染拖死「完整对齐」主路径。

缺口处理方案（每个 G 的可执行对策）→ [`docs/GAPS-REMEDIATION.md`](./docs/GAPS-REMEDIATION.md)。

---

## 缺口与前置文档（2026-10-08）

> 实现暂停：先文档后代码。下列「缺口」是完整对齐仍缺的能力；「C 清单」为写代码前文档——**现已全部勾完，细节见 `docs/`**。

### A. 能力缺口（相对 OpenAI / 完整对齐）

| ID | 缺口 | 为何重要 | 拟归入步骤 | 验收线索 |
|----|------|----------|------------|----------|
| G1 | **设计判断**弱（无训练权重，仅靠 prompt） | 否则满屏卡片或该交互不出 | ⑤ | 固定题集上「该纯文字 / 该 UI」准确率可测 |
| G2 | **Host 嵌入**：多数 harness 只显示 tool 文本 | 用户看不见内嵌 UI = 未对齐 ChatGPT | ② | Cursor/本地参考窗能画 `ui.delta` |
| G3 | **流式编译 + 会话**：增量、骨架、中断、多轮 patch、可选 refresh | 对齐「边生成边出」与 widget 续刷 | ③ | 冒烟：分片 propose → 首控件时间；action 后局部更新；体感缺口见 [`docs/STREAMING-UX-GAP.md`](./docs/STREAMING-UX-GAP.md) |
| G4 | **注册即渲染的信任模型** | 本地加载 = 代码执行风险 | ④ | 仅信任目录；失败降级占位；无远程码 |
| G5 | **七包真映射成本** | 七套同时真渲染拖死主路径 | ① 真渲染 base+shadcn；⑥ 其余 | ① 两包可点；⑥ 前其余可 schema-only |
| G6 | **状态化小工具**（bind / reduce / 沙箱计算） | 否则只有静态表单，没有计算器级体验 | ③ 起骨架，可延至 ⑤ | 小费滑条改值 → 汇总更新 |
| G7 | **评测与回归集** | 无法证明「不打折」 | ⑥ | prompt 集 + 人工/模型打分表 |
| G8 | **Harness 分发**（mcp.json、DSH 说明、版本） | 否则只有仓库能跑 | ① README 起，② 补宿主 | 按文档 5 分钟接上 |
| G9 | **竞品边界**（OpenUI / A2UI / ChatKit / Vercel GenUI） | 避免重复造轮、范围膨胀 | 文档（本节下） | DESIGN 写清「做 / 不做」 |
| G10 | **无障碍 / 密度开关 / i18n / 移动** | 最终体验与官方开关对标 | ⑥ 后或平行小项 | 密度可关；基础 a11y |

处理方案全文：[`docs/GAPS-REMEDIATION.md`](./docs/GAPS-REMEDIATION.md)。

### B. 竞品边界（G9 写死）

**做**
- 多 catalog 可勾选；任意 harness 经 stdio MCP；注册即渲染（local 受信）；对齐 ChatGPT 内嵌流式交互体验。

**不做（至少 v0.1–v0.2）**
- 复刻 OpenAI 闭源视觉与权重；
- 在 MCP 内执行模型生成的任意 HTML/JS；
- 一上来做云端组件市场 / npm 自动安装；
- 取代完整设计系统或低代码平台。

### C. 写代码前文档清单（细节见 `docs/`）

- [x] 架构与工具面（本文前半）
- [x] 落地顺序 ①–⑥（已拍板）
- [x] 缺口表 G1–G10（本节）
- [x] **工具 JSON Schema 草案** → [`docs/TOOLS-SCHEMA.md`](./docs/TOOLS-SCHEMA.md)
- [x] **`ui.delta` 事件 schema** → [`docs/UI-DELTA-SCHEMA.md`](./docs/UI-DELTA-SCHEMA.md)
- [x] **Session 状态机** → [`docs/SESSION-STATE.md`](./docs/SESSION-STATE.md)
- [x] **catalog.base / catalog.shadcn 控件清单 + props 表** → [`docs/CATALOG-BASE-SHADCN.md`](./docs/CATALOG-BASE-SHADCN.md)
- [x] **Host 参考窗需求一页** → [`docs/HOST-WINDOW.md`](./docs/HOST-WINDOW.md)
- [x] **信任目录与自定义包 manifest 规范** → [`docs/CUSTOM-PACKAGE-MANIFEST.md`](./docs/CUSTOM-PACKAGE-MANIFEST.md)
- [x] **评测题集 v0 大纲** → [`docs/EVAL-SET-V0.md`](./docs/EVAL-SET-V0.md)
- [x] **缺口处理方案 G1–G10** → [`docs/GAPS-REMEDIATION.md`](./docs/GAPS-REMEDIATION.md)
- [x] **文档索引** → [`docs/00-INDEX.md`](./docs/00-INDEX.md)

### D. 当前状态

- 实现：**①–⑥ 已落地**（含 charts 真渲染、schema-only 余包、eval harness；`catalog-smoke` / `eval`）。
- 文档：C 清单已全部勾完；G1/G4/G6 验收见 `docs/GAPS-REMEDIATION.md`。
- **设计判断 = prompt + lint + 可选裁判，≠ OpenAI RL 权重。**
- 下一步：⑥ 后体验抛光（G10 a11y/i18n 完整项）；真模型标定 ≤20% 误判。

### E. 落地进度勾选（①–⑥）

- [x] ① stdio MCP + base/shadcn 真渲染
- [x] ② Host 参考窗
- [x] ③ session / 流式 / action 闭环
- [x] ④ 自定义包受信加载
- [x] ⑤ policy / 裁判
- [x] ⑥ 其余 catalog（charts 真渲染 + radix/mui/antd/chakra schema-only）+ 评测集
