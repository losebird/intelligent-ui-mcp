# 「无 Renderer 壳也能气泡内 Intelligent UI」可行性判断

> 日期：2026-10-08（Asia/Shanghai）  
> 受众：Ace / losebird · `intelligent-ui-mcp`  
> 问题陈述：任意 agent harness **只装本 MCP**，即使宿主 **没有 Renderer 壳**，也要得到接近 OpenAI Intelligent UI 的 **聊天气泡内、边输出边画** 体验。  
> 相关：[`STREAMING-UX-GAP.md`](./STREAMING-UX-GAP.md)（流式体感缺口）；[`HOST-WINDOW.md`](./HOST-WINDOW.md)（Host ≠ 气泡）；[`../DESIGN-v0.1.md`](../DESIGN-v0.1.md) G9 竞品边界。
> **决策（2026-10-08）**：Ace 已选定 **选项 A**（宿主嵌 renderer）。适配契约见 [`HOST-RENDERER-ADAPTER.md`](./HOST-RENDERER-ADAPTER.md)。选项 B 仍作未接入宿主前的默认演示面。

---

## Executive summary（一页可贴）

- **结论（硬）**：**单靠 MCP 协议，无法在「没有 Renderer 的任意 harness」聊天气泡里画出可交互、渐进式 UI。** MCP 工具结果对宿主来说是 **文本 / 图片 / 资源链接**，不是「请宿主把这段组件树嵌进气泡」的一等公民 API。
- **Ace 目标拆开后**：
  1. 「装了 MCP 就有流式组件树」→ **我们已能做**（session + `ui.delta` + catalog）。
  2. 「树出现在聊天气泡里、像 OpenAI 宣传片」→ **需要有人画像素**；那个人要么是 **宿主产品**（Cursor / Grok Bot / Claude Code 内嵌 renderer），要么是 **我们另起的壳**（Host / 浏览器窗 / 旁栏 Webview）。**没有第三条「纯 MCP、零壳」魔法路径。**
- **OpenUI / OpenGenerativeUI 看起来「不需要 harness」是错觉**：它们各自 **自带聊天壳 + Renderer**（React Renderer / CopilotKit + iframe）。那一层 **就是** harness 的呈现面；MCP 在它们体系里多半是辅路，不是「只装 MCP 就气泡内画 UI」的主路径。
- **选项按「接近 Ace 目标」排序**（详见 §4）：
  1. **宿主产品适配器**（Cursor/Grok 官方嵌我们的 renderer 或认 A2UI/AG-UI）— 体感最近，**我们控不了发版**。
  2. **MCP 自动拉起的极薄通用壳**（本仓 Host / 浏览器窗，可选同屏旁栏）— **今天就能发**，体感次优（旁路/旁栏，非原生气泡）。
  3. **协议标准对齐**（A2UI / OpenUI Lang / AG-UI）— 降低「每个宿主各写一套」成本，**仍要宿主或壳认协议**。
  4. **Markdown / 静态图回退**— MCP-only 可做，**交互与渐进感差一截**，勿当主叙事。
- **本仓可单独交付的**：catalog + 流式 ops + Host + 文档化「装 MCP + 起 Host」安装体验；可选「`ui_open` 时尽量自动打开浏览器」把壳摩擦压到最低。
- **本仓不可单独交付的**：在 Cursor/Grok **原生气泡 DOM** 里无宿主配合地插入控件；「任意无 Renderer harness 开箱即 Intelligent UI」。
- **建议产品立场**：对外叙事改为 **「Universal Generative UI *protocol + reference Host*」**，而不是 **「Drop-in MCP = OpenAI Intelligent UI in any chat」**。对 Ace 的目标：把「气泡内」标为 **宿主合作里程碑**；把「装 MCP 就有渐进 UI」标为 **Host 自动拉起 + 流式 P0（已部分落地）**。

---

## 1. Ace 目标的精确含义

| 子句 | 字面要求 | 实际隐含 |
|------|----------|----------|
| 任意 agent harness | Cursor、Claude Code、DSH、自建… | 宿主 UI 能力差异巨大 |
| 装了这个 MCP | 通常 = `mcp.json` / stdio spawn | 只多了 **工具调用通道**，不改宿主聊天渲染管线 |
| OpenAI Intelligent UI 一样 | 气泡内、token/控件级渐进、可点 | 需要 **同框 Renderer + 流式编译** |
| 哪怕没有 Renderer 壳 | 宿主聊天区**不会**调用任何组件库 | **没有绘制面**仍要出 UI → 逻辑矛盾，除非另起绘制面 |

**一句话**：目标要求「无绘制面却有绘制结果」。可行解只能是 **偷偷换一个绘制面**（自动开 Host / 浏览器），或 **说服宿主提供绘制面**——两者都不是「纯 MCP、零壳」。

---

## 2. MCP 协议硬限制（为什么「只装 MCP」不够）

依据 Model Context Protocol 常见能力边界（tools / resources / prompts；结果以文本与结构化 content 块为主；无「Chat UI widget」标准类型）：

| 能力 | MCP 能做 | MCP 不能做 |
|------|----------|------------|
| 让模型调工具 | `ui_open` / `ui_propose` / … | 规定宿主 **如何** 展示 tool result |
| 返回内容 | text、image、（部分实现）resource link | 强制宿主把 JSON 树 **编译成原生控件嵌进气泡** |
| 进程模型 | stdio / SSE server 由 harness spawn | 占用 stdio 后 **不能** 再把同一进程当 GUI；GUI 必须旁路 |
| 跨 harness 一致 UI | 同一套 tool schema | 各 harness 对 tool result 的 **渲染政策** 自行决定（多半当 Markdown/JSON） |
| 渐进 paint | server 可流式写 session / 推事件 | **气泡像素** 仍由宿主决定何时、是否重绘 |

本仓已遵守这些限制：`HOST-WINDOW.md` 写明 **Host 与 MCP 解耦**（stdio 已被协议占用）；`STREAMING-UX-GAP.md` §5 **不承诺** Cursor/Grok 气泡内嵌。

**推论**：任何宣传「安装即 Intelligent UI、无需任何壳」若指 **原生气泡**，在现行 MCP 下 **不可行**；若指 **装 MCP 后自动有一个绘制面**，则可行，但必须承认 **壳存在**（哪怕是我们自动弹的浏览器窗）。

---

## 3. 为什么 OpenUI / OpenGenerativeUI「看起来不需要 harness」

### 3.1 thesysdev/openui

- **自带**：OpenUI Lang + `createStreamingParser` + React `<Renderer isStreaming>` + chat/playground 表面；LangChain 路径走 **AG-UI SSE**。
- **角色拆分**：模型吐 DSL → **自家 Renderer** 画在 **自家（或集成方提供的）聊天面**。
- **MCP**：不是「只装一个 MCP server 就进 Cursor 气泡」的故事；主路径是 **带 Renderer 的应用/脚手架**。

### 3.2 CopilotKit/OpenGenerativeUI

- **自带**：Next.js + CopilotKit 聊天；`generateSandboxedUi` 参数流 → activity → iframe morph。
- **MCP（若有）**：偏设计系统 / 文档组装辅路；**流式 GenUI 主路径在 CopilotKit runtime**，不在「任意 harness 的 stdio MCP」。
- **用户感知「开箱即用」**：因为 clone 下来的 **整个 app 就是 harness**。

### 3.3 对照本仓

| | OpenUI | OpenGenerativeUI | intelligent-ui-mcp（今天） |
|--|--------|------------------|---------------------------|
| 谁提供聊天壳 | 自家 / 集成方 | CopilotKit app | **外部** Cursor/Grok/… |
| 谁提供 Renderer | 包内 React Renderer | iframe + morph | `renderer-react` + **Host 窗** |
| MCP 地位 | 非主叙事 | 辅路 | **主分发形态** |
| 「无壳」假象来源 | 壳打进 npm/app | 壳打进 Next 模板 | 用户只看见 mcp.json，**忘了还必须 `npm run host`** |

**结论**：竞品不是「无 harness」；它们是 **「harness + renderer 打包售卖」**。我们选了 **MCP-first**，呈现面默认外包给 Host——摩擦更明显，但协议更可插到任意 agent；**不能**用竞品营销话术直接平移到「零壳 MCP」。

---

## 4. 选项排序（接近 Ace 目标 → 现实可发）

### 选项 A — 宿主产品适配器（体感最佳 / 日历不可控）

- **做法**：Cursor / Grok Bot / Claude Code 等在 tool result 或专用 channel 上识别我们的 `ui.delta`（或 A2UI/AG-UI），用内嵌 Webview/原生控件 **画在气泡或紧贴气泡**。
- **优点**：最接近宣传片；无第二窗心智。
- **缺点**：依赖各产品路线图；开源仓 **无法单方交付「任意 harness」**。
- **本仓可做的准备**：稳定 schema、reference renderer、适配器文档、官方「嵌入指南」；对 1–2 家宿主做 PoC PR（若对方开放）。
- **契约文档**：[`HOST-RENDERER-ADAPTER.md`](./HOST-RENDERER-ADAPTER.md)（open/stream/action、最小 `IntelligentUiHostSurface`、我们 vs 宿主分工、M0–M4）。
- **判定**：**Ace 已选为战略主路径**；日历仍依赖宿主发版，本仓先交契约与 renderer。

### 选项 B — MCP 自动拉起的极薄通用壳（今天可发 / 体感次优）

- **做法**：`ui_open`（或安装后首次）自动 `open http://127.0.0.1:5173` / 系统浏览器 / 可选 Electron 小窗；流式仍走现有 Host；文档宣称「装 MCP = 自动有画布」，**明确画布不是气泡**。
- **变体 B′**：同屏旁栏 / 分屏嵌 Host（此前 P1-embed）——仍是壳，只是空间更近。
- **优点**：不改宿主；任意能跑 MCP+本机浏览器的 harness 行为一致；P0 流式已可用。
- **缺点**：**不是**原生气泡；焦点切换、窗口管理、与文字交错仍弱于 OpenAI。
- **判定**：**推荐作为「Universal MCP」的诚实默认产品**。

### 选项 C — 协议标准（A2UI / OpenUI Lang / AG-UI）（中长期杠杆）

| 标准 | 作用 | 与「无壳」关系 |
|------|------|----------------|
| **AG-UI** | agent↔前端 SSE/事件总线（OpenUI LangChain 已用） | 前端仍要 AG-UI adapter + Renderer |
| **OpenUI Lang** | 更易流式的 DSL + 官方 Renderer | 集成方仍要挂 Renderer |
| **A2UI**（及同类 agent-to-UI 提案） | 跨栈声明式 UI 消息 | 宿主/壳认协议后才有像素 |
| **ChatKit / Vercel GenUI** | 产品或框架内组件映射 | 绑死特定栈，非「任意 harness」 |

- **优点**：一次协议、多宿主复用；减少「每个产品私有 GenUI」。
- **缺点**：**标准 ≠ 绘制**；无认协议的壳/宿主，照样空白。
- **本仓姿态**：可提供 **导出/适配适配器**（DESIGN G9：借鉴不重复造轮）；主 schema 仍以本仓为准，除非 Ace 改目标为「兼容某标准」。
- **判定**：**放大器**，不能单独满足「无 Renderer」。

### 选项 D — Markdown / 图片回退（MCP-only 真·零壳 / 体验下限）

- **做法**：工具结果返回 Markdown 表、ASCII、或服务端渲染的 PNG/GIF「伪渐进」；可选每次 patch 重出一张图。
- **优点**：任何只渲染 Markdown/图片的 harness **立刻可见**；无 Host。
- **缺点**：弱交互（按钮≈让用户打字）；真渐进难；与 catalog 可点 UI 目标冲突；带宽与闪烁差。
- **判定**：**降级演示 / 无 Host 环境兜底**，禁止当主 slogan。

### 排序汇总

| 排名 | 选项 | 接近宣传片 | MCP-only 可发 | 建议 |
|------|------|------------|---------------|------|
| 1 | A 宿主适配器 | ★★★★★ | ✗ | 对外列为合作里程碑 |
| 2 | B 自动薄壳（+B′ 同屏） | ★★★☆☆ | ✓（需本机 GUI） | **默认产品路径** |
| 3 | C 协议对齐 | ★★★★☆（有宿主时） | 仅协议件 | 适配器，非替换 Host |
| 4 | D MD/图回退 | ★☆☆☆☆ | ✓ | 仅 fallback |

---

## 5. 作为「纯 MCP」我们能发 / 不能发

### 能发（且应写进 README 诚实边界）

- 统一 tool schema、`ui.delta`、session 状态机、catalog（base/shadcn/charts…）。
- 流式 `mode=ops` / JSONL chunks → Host 渐进 paint（P0 本机已落地，见 `STREAMING-UX-GAP`）。
- Reference Host + `hostHint` / 一键脚本；未来：**`ui_open` 尽力自动打开浏览器**。
- 自定义包「注册即渲染」（受信 local entry）。
- 给 **自带 Webview 的 harness** 提供「嵌同一 `renderer-react`」的集成文档（此时壳来自对方，我们提供组件）。
- 可选：tool result 里附 **短 Markdown 摘要 + Host URL**（气泡里有字、真 UI 在壳里）。

### 不能发（勿写进对外承诺）

- 「任意无 Renderer 的 harness，安装后 **气泡内** 原生控件渐进出现」。
- 劫持 Cursor/Electron DOM、伪造官方 Intelligent UI。
- 不经沙箱/catalog 在 MCP 内执行模型任意 HTML/JS（与 OGUI 路线不同；DESIGN 已否）。
- 单靠换更大模型（Opus 等）消除「无绘制面」缺口。

---

## 6. 建议产品立场（losebird / intelligent-ui-mcp）

1. **定位一句话**：  
   **Agent 侧的 Generative UI 协议与参考实现（MCP + catalog + streaming + Host）**；  
   **不是**「ChatGPT Intelligent UI 的 Cursor 插件替代品（零壳）」。

2. **对 Ace 目标的改写（可对外）**：  
   - **现在**：任意支持 MCP 的 harness → 装 server → **自动/半自动 Host** → OpenAI-**like 渐进可点 UI**（旁路画布）。  
   - **下一阶段**：1–N 个宿主产品嵌 renderer → **气泡或旁栏同框**。  
   - **远期**：若行业收敛到 AG-UI/A2UI/OpenUI，本仓做 **最佳 MCP 源 + 适配器**，而不是再绑死一家私有气泡 API。

3. **叙事禁止项**：  
   - 「不需要任何 UI 壳」；  
   - 「和 OpenAI 宣传片像素级一样且任意 IDE 开箱」；  
   - 把 OpenUI/OGUI 说成「证明 MCP-only 即可」。

4. **叙事鼓励项**：  
   - 「协议可插、呈现可换」；  
   - 「参考 Host 保证今天就能演示」；  
   - 「宿主一接 renderer，同一 session 立刻升格为同框」。

5. **与现有路线图关系**：  
   - **P0 流式**（已做）：解决「Host 上是否像边生成边画」。  
   - **P1 同屏嵌 Host**：空间靠近，**仍不满足**「无壳气泡」——Ace 已否偏离目标；可降为可选 DX，不主推。  
   - **本文（可行性）**：把「无 Renderer 也要气泡内」标为 **需选项 A 或改目标**；默认押 **选项 B**。

6. **决策问 Ace 的唯一分叉**（若以后要拍板）：  
   - **押 B**：打磨自动开壳 + 流式 + 安装 UX（推荐）。  
   - **押 A（Ace 已选）**：以 [`HOST-RENDERER-ADAPTER.md`](./HOST-RENDERER-ADAPTER.md) 为合作入口；Host 窗保留为对照/未接入前默认面，不主推旁栏当终态。  
   - **押 D**：只要「聊天里看得见」，接受表/图降级。  
   - **不可选**：坚持「A 的体感 + 纯 MCP 零配合」作为承诺。

---

## 7. 风险与常见误解

| 误解 | 澄清 |
|------|------|
| 「MCP 新版本会加 widget 类型」 | 即便未来有，仍要 **每个宿主实现**；在标准化落地前不能当计划依赖。 |
| 「tool 返回 HTML，宿主会渲染」 | 多数 harness **转义** HTML；且任意 HTML ≠ 安全 catalog。 |
| 「Resources / App 链接算气泡 UI」 | 最多打开外链/面板，仍是壳，且通常非渐进组件树。 |
| 「做了 P1 旁栏就等于宣传片」 | 旁栏 ≠ 气泡内编译器；Ace 已指出差距。 |
| 「换 Opus 写 MCP 就能丝滑」 | 模型影响树质量；**丝滑度 = 绘制面位置 + 流式路径**。 |

---

## 8. 文档交叉引用

- 流式体感与 P0/P1：[`STREAMING-UX-GAP.md`](./STREAMING-UX-GAP.md)  
- Host 边界「不是气泡插件」：[`HOST-WINDOW.md`](./HOST-WINDOW.md)  
- 竞品边界 G9：[`../DESIGN-v0.1.md`](../DESIGN-v0.1.md)、[`GAPS-REMEDIATION.md`](./GAPS-REMEDIATION.md)  
- 事件与 tools：[`UI-DELTA-SCHEMA.md`](./UI-DELTA-SCHEMA.md)、[`TOOLS-SCHEMA.md`](./TOOLS-SCHEMA.md)  
- 选项 A 宿主适配契约：[`HOST-RENDERER-ADAPTER.md`](./HOST-RENDERER-ADAPTER.md)
- 索引：[`00-INDEX.md`](./00-INDEX.md)

---

## 9. 一句话给工程排期

> **协议与 Host 流式继续本机打磨（选项 B）；「任意无 Renderer harness 气泡内 Intelligent UI」不进承诺，只进「宿主适配器」合作清单（选项 A）。**
