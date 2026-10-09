# 流式 Generative UI UX 缺口报告（vs OpenAI / OpenUI / OpenGenerativeUI）

> 日期：2026-10-08（Asia/Shanghai）  
> 范围：`intelligent-ui-mcp` 相对「边输出边生成」体感；可执行 P0/P1。  
> 对照源：OpenAI Intelligent UI 公开说明；[thesysdev/openui](https://github.com/thesysdev/openui)；[CopilotKit/OpenGenerativeUI](https://github.com/CopilotKit/OpenGenerativeUI)；本仓 `DESIGN-v0.1.md` / G3 / G2 / Host 旁路。

> **P0 本机落地（2026-10-08）**：`proposeChunks` 已 JSONL 即 apply；Host 有「生成中」条 + `ui.delta` 日志；prompt 强制对比类 `mode=ops`；`npm run stream-phone-compare` 验收渐进帧（无截图）。  
> **P0 默认强化（2026-10-09）**：`ui_propose` 工具描述/推断默认走 ops；`chunkDone` 省略=partial；prompt 示例改为手机对比分片；`live-demo` 改为 ops 边画；`stream-phone-compare` 用 SSE+Host snapshot 证明分片可见。见 [`AUDIT-P0-OPS-DEFAULT.md`](./AUDIT-P0-OPS-DEFAULT.md)。

> **相关决策文档**：Ace 进一步目标「任意无 Renderer harness 也要气泡内 Intelligent UI」——结论见 [`HARNESSLESS-FEASIBILITY.md`](./HARNESSLESS-FEASIBILITY.md)（MCP-only 不可达原生气泡；默认押自动薄壳 Host）。


---

## Executive summary（可贴给 Ace）

- **OpenAI 体感核心**：原生 streamable 组件库 + **编译器边生成边画**；UI **嵌在聊天气泡内**；首控件出现 ≈ token 到达，不是整树写完再弹。
- **我们今天的体感**：agent 先在脑子里拼完整 JSON → 一次 `ui_propose mode=tree` → MCP 写 NDJSON → Host **150ms 轮询** → **独立窗口**才出图；联调还叠了桌面截图，体感更钝。
- **协议上「有流式」≠ 产品上「像流式」**：`mode=ops` 与 `ui.delta` 已落地（`stream-smoke`）；但 `streaming_chunks` **仅在 `chunkDone=true` 时整段 `JSON.parse`**，中间 chunk **不画子树**（README「③ 已知简化」）。
- **OpenUI 怎么做**：OpenUI Lang（非 JSON）+ `createStreamingParser` **token 级增量解析** → React `<Renderer isStreaming>` **同气泡渐进渲染**；LangChain 经 **AG-UI SSE**（`@openuidev/langchain`）。
- **OpenGenerativeUI 怎么做**：Chat 内嵌；`generateSandboxedUi` **按字段顺序流式**（height→placeholder→css→html→js）；`OpenGenerativeUIMiddleware` → activity 事件；Idiomorph **无闪烁** morph iframe。
- **P0-1**：Harness 默认改「边想边 `mode=ops` upsert」或真 partial JSON 抽出；禁止「整表想完再 tree」当唯一路径。
- **P0-2**：Host 对 `partial`/`ui.delta` **立刻 paint**（骨架/占位行）；可选 WebSocket 推送替代纯 150ms 轮询。
- **P0-3**：关键路径 **禁止桌面截图验收**；聊天气泡只贴 Host URL / 一句话「已开窗」，截图不挡首屏。
- **P1**：同屏共址——Cursor 旁栏 Webview / 浏览器面板嵌 `renderer-react`（仍非气泡原生）；Host 启动与 `ui_open` 绑定。
- **P1**：借鉴 OpenUI：紧凑 DSL 或 **可流式 JSON Lines ops**（每行一条 upsert），避免整棵 JSON 未闭合无法 parse。
- **非目标**：在无 Cursor/ChatGPT 产品改动下 **复刻气泡内嵌像素体验**；换更大模型（如 Opus）**解决不了**旁路延迟与批处理 propose。
- **验收**：固定题「对比三款手机」——首控件可见时间 ≤ 首个 upsert 后 300ms；用户眼见行/列逐步出现，而非空白→满表。

---

## 1. OpenAI-like UX 需要什么

依据 OpenAI 公开描述（GPT-6 Intelligent UI，2026-10-07 起）：*「library of native, streamable components」+「compiler that processes the interface as the model generates it」→「appear progressively … without waiting for the entire response」*；答案含图/按钮/表单/小工具，**直接在对话里**可用（The Verge / OpenAI 博文转述）。

| 维度 | 要求 | 用户可感知信号 |
|------|------|----------------|
| Progressive paint | 模型还在生成时已有控件上屏 | 骨架→列→行逐步出现 |
| Co-located | UI 与文字同气泡或紧贴气泡 | 无需切窗找 Host |
| Low latency feedback | 首字节/首控件延迟低 | 提问后立刻「有东西在动」 |
| Partial trees | 不完整树也可渲染 | `partial=true` 仍可点已完成节点 |
| Interleaved text+UI | 文字与界面交错 | 不是先全文再弹窗 |
| Native catalog | 固定设计语言，禁止任意 HTML（OpenAI）；开源侧可沙箱 | 一致、可交互、可续刷 |

---

## 2. 竞品如何做到「边输出边生成」

### 2.1 OpenUI（thesysdev/openui）

| 机制 | 路径 / 证据 | 要点 |
|------|-------------|------|
| 流式语言 | `packages/lang-core`：`createStreamingParser`；README「Parse … one-shot or streaming」 | 模型吐 **OpenUI Lang**（比 JSON 更省 token），**未闭合也可增量 `set(chunk)`** |
| 同框渲染 | `packages/react-lang`：`<Renderer isStreaming={…}>` | 流式过程中禁表单交互，完成后可点 |
| Agent 传输 | `packages/langchain`：`openUIStreamTransformer` → **AG-UI SSE**（`text/event-stream`） | 浏览器只接 AG-UI adapter，token→事件→渲染一条链 |
| 产品形态 | CLI scaffold + chat surfaces / playground | **生成即在 chat/app 表面**，不是旁路第二窗 |

关键代码意象（`lang-core/README.md`）：

```ts
const sp = createStreamingParser(libraryJsonSchema);
sp.set("root = Stack([header])\n");
sp.set("root = Stack([header])\nheader = CardHeader(\"Hello\")\n");
// 第二次已能 resolve 前向引用并出树
```

### 2.2 OpenGenerativeUI（CopilotKit/OpenGenerativeUI）

| 机制 | 路径 / 证据 | 要点 |
|------|-------------|------|
| 聊天气泡内 GenUI | `docs/generative-ui.md`；`useComponent` / activity rail | UI **画在 chat**，非外挂窗 |
| 有序参数流 | `generateSandboxedUi`：`initialHeight` → `placeholderMessages` → `css` → `html` → `jsFunctions` → `jsExpressions` | **先占位高度与文案，再 CSS，再 HTML**，避免空白闪 |
| 中间件 | `OpenGenerativeUIMiddleware` → `open-generative-ui` activity | 工具参数流式 → 前端可订阅的活动事件 |
| 无闪烁更新 | Idiomorph morph 预览 iframe → 完成后再 websandbox | 边流边 morph，不是整页替换 |
| MCP 角色 | `apps/mcp`：`assemble_document` + skills | MCP 偏 **设计系统/文档组装**；流式主路径在 CopilotKit runtime，不在 MCP stdio |

架构摘要见 `docs/architecture.md`：Browser ↔ Next `/api/copilotkit` ↔ LangGraph agent；状态双向同步。

### 2.3 对照一句话

| | OpenAI | OpenUI | OpenGenerativeUI | **我们** |
|--|--------|--------|------------------|----------|
| 载体 | Chat 气泡 | Chat/Renderer | Chat + iframe | **独立 Host 窗** |
| 流式单位 | 私有编译器 chunk | Lang 语句 | 工具参数字段 | JSON 整树 / ops 批；chunks **等 done** |
| 传输 | 产品内嵌 | AG-UI SSE | CopilotKit activity | **stdio MCP + NDJSON 文件轮询** |

---

## 3. 我们已有 vs「假流式」

### 3.1 已有（真能力，但未接到用户眼皮）

- 事件协议：`ui.open` / `ui.delta` / `ui.replace` / `ui.done` / `ui.error` / `ui.action`（`docs/UI-DELTA-SCHEMA.md`）。
- `ui_propose mode=ops`：upsert / patch_props / remove…；`stream-smoke` 连续 5× upsert → ≥5 `ui.delta`（`docs/GAPS-REMEDIATION.md` G3）。
- Session 状态机含 `streaming` + `partial`（`docs/SESSION-STATE.md`）。
- Host：`apps/host-window`，`POLL_MS = 150`，读 `current.json` + snapshot + events（`App.tsx`）。
- Action 闭环：`actions.ndjson` + `ui_drain_actions`。

### 3.2 「假流式」/ 体感杀手（联调实锤）

| 现象 | 根因 | 证据 |
|------|------|------|
| 等很久才突然满表 | ~~Agent 默认整树 `mode=tree`~~ → **已改为 ops 默认路径**（工具描述+prompt+chunkDone partial） | 仍可能被模型显式 `mode=tree`；靠 prompt/lint 约束 |
| `streaming_chunks` 名不副实 | **仅 `chunkDone` 时 `JSON.parse`**；未 done 只 buffer，**Host 无增量树** | `packages/mcp-server/src/session/store.ts` `proposeChunks`；README「③ 已知简化」 |
| UI 不在聊天里 | Host 刻意解耦（stdio 占用）；文档已写「不是 Cursor 气泡插件」 | `docs/HOST-WINDOW.md` |
| 更钝 | 执行子 agent **桌面截图 / 硬刷新**进关键路径 | 父对话联调记录 |
| 轮询上限 | ~~文件旁路 + 150ms poll；无 SSE~~ → **Host SSE `/api/stream` 已落地**；JSON 轮询仅回退 | `AUDIT-P1-SSE.md`；WS 仍未做 |
| 空表误伤 | props 字段别名等（已修）会放大「慢+坏」印象 | 联调 rev1→rev2 |

**结论**：G3 勾选「流式已落地」指的是 **协议与 smoke**；对 Ace 说的「不像 OpenAI」指的是 **端到端 progressive paint + 同框**。两者不矛盾——缺口在 **harness 用法 + Host 呈现面 + chunks 语义**。

---

## 4. 分级整改（按「边输出边生成」体感排序）

### P0 — 必须做（本周可验收，不依赖 Cursor 产品改）

| ID | 动作 | Owner 提示 | 验收 |
|----|------|------------|------|
| **P0-a** | ✅ Harness / prompt：对比类 **强制 `mode=ops` 分片**；工具描述+示例+`live-demo` 不再整树演示 | `prompt.ts` 0.2.0 / `server.ts` / `stream-phone-compare` | 「对比三款手机」空壳→表头→逐行；SSE 可见 |
| **P0-b** | 真流式 chunks：**要么** 实现 partial JSON / JSONL ops 抽出（每完整 `op` 立即 `ui.delta`），**要么** 文档降级改名 `buffer_until_done` 并停止宣称 streaming | `store.ts` `proposeChunks` | 未 `chunkDone` 时 Host 已有节点 |
| **P0-c** | Host：收到 `partial`/`ui.delta` **立即 paint**；流式中显示「生成中」条；revision 抖动不整页白屏 | `App.tsx` + renderer key 策略 | 连续 upsert 无空白闪烁 |
| **P0-d** | **关键路径杀掉桌面截图**：agent 只回 Host URL + sessionId；截图改异步/可选 | Grok Bot 联调 playbook | 首屏延迟不再含 Computer 子任务 |
| **P0-e** | `ui_open` 时保证 Host 已起；失败则 tool 返回醒目 `hostHint`（一键 `npm run host`） | MCP + README | 用户不问「窗在哪」 |

### P1 — 明显拉近体感（1–2 周）

| ID | 动作 | 说明 |
|----|------|------|
| **P1-a** | Host **SSE 推送** ✅（`/api/stream`；失败回退轮询） | WS 仍可选；见 `AUDIT-P1-SSE.md` |
| **P1-b** | **同屏共址**：Cursor 简单浏览器面板 / 本地 `iframe` 嵌同一 `renderer-react`（仍非原生气泡） | 对齐 OpenGenerativeUI「在对话旁看见」 |
| **P1-c** | 借鉴 OpenUI：**JSONL ops 流**（一行一个 upsert）或可选 OpenUI Lang 适配器 | 避开「整段 JSON 未闭合无法 parse」 |
| **P1-d** | Placeholder / skeleton 组件进 `catalog.base` | 对标 OGUI `placeholderMessages` + initialHeight |
| **P1-e** | 首控件时间指标写入 `stream-smoke` / eval | TTFC（time-to-first-control）回归 |

### P2 — 体验抛光

- Idiomorph 类局部 morph（大树 patch 不闪）。
- 文字答案与 UI 交错策略（先 Markdown 一句再出表）。
- 设计判断（G1）降低「乱出满屏卡片」干扰流式观感。

---

## 5. 明确非目标（写给 Ace，避免期望错位）

1. **不承诺** Cursor / Grok 聊天气泡内原生嵌控件——无宿主官方 API；`HOST-WINDOW.md` 已写死。要气泡级 = **产品侧改 harness**，不是 MCP 单独能补齐。「无 Renderer 也要气泡内」的完整论证与选项排序见 [`HARNESSLESS-FEASIBILITY.md`](./HARNESSLESS-FEASIBILITY.md)。
2. **不复刻** OpenAI 闭源视觉与 RL 权重（`DESIGN` §B / G9）。
3. **不靠换 Opus / 更大模型** 解决旁路延迟、批处理 propose、截图路径——模型只影响树质量；**丝滑度 = 流式协议 + 同框渲染**。
4. **不在 MCP 内**执行模型任意 HTML/JS（与 OpenGenerativeUI 沙箱路线不同；我们走 catalog + 受信 local）。
5. **不做** 兼容 OpenAI 私有 GenUI 二进制协议（G3 退路已写）。

---

## 6. 建议本周最小切片（可直接开 PR）

1. Prompt + 示例：`examples/stream-phone-compare.mjs` —— 5 次 `mode=ops` upsert，Host 肉眼逐步出现。  
2. `proposeChunks`：支持 **NDJSON ops 行流**（每行完整 JSON op 立即 apply）；保留旧「整段 parse」为 fallback。  
3. Host：streaming banner + 禁止联调截图进 P0 路径。  
4. 本文链回 `DESIGN` G3 / `GAPS-REMEDIATION` G2–G3。

---

## 7. 文档交叉引用

- 能力对齐「边生成边出界面」：[`../DESIGN-v0.1.md`](../DESIGN-v0.1.md)  
- G2 Host / G3 流式方案：[`GAPS-REMEDIATION.md`](./GAPS-REMEDIATION.md)  
- Host 边界「不是气泡」：[`HOST-WINDOW.md`](./HOST-WINDOW.md)  
- 无壳 / 任意 harness 气泡内目标可行性：[`HARNESSLESS-FEASIBILITY.md`](./HARNESSLESS-FEASIBILITY.md)
- 选项 A 宿主嵌 renderer 契约：[`HOST-RENDERER-ADAPTER.md`](./HOST-RENDERER-ADAPTER.md)  
- `streaming_chunks` 字段：[`TOOLS-SCHEMA.md`](./TOOLS-SCHEMA.md)  
- 事件 `partial`：[`UI-DELTA-SCHEMA.md`](./UI-DELTA-SCHEMA.md)

