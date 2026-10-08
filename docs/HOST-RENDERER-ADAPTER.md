# 宿主渲染器适配器契约（选项 A）

> 日期：2026-10-08（Asia/Shanghai）  
> 受众：Cursor / Grok Bot / DSH / Claude Code 等 **harness 产品** 工程；本仓 maintainers。  
> 决策：Ace 选定 **选项 A**——宿主产品在聊天气泡（或紧贴气泡）内嵌本仓 renderer，以获得最接近 OpenAI Intelligent UI 的体感。  
> 前提论证：[`HARNESSLESS-FEASIBILITY.md`](./HARNESSLESS-FEASIBILITY.md)（纯 MCP 无法在无 Renderer 气泡内画像素）；流式体感：[`STREAMING-UX-GAP.md`](./STREAMING-UX-GAP.md)；事件：[`UI-DELTA-SCHEMA.md`](./UI-DELTA-SCHEMA.md)；tools：[`TOOLS-SCHEMA.md`](./TOOLS-SCHEMA.md)；参考 Host：[`HOST-WINDOW.md`](./HOST-WINDOW.md)。

---

## Executive summary

- **一句话**：MCP server 继续当 **session / catalog / 校验 / 事件源**；宿主产品负责 **在聊天面挂载绘制面**（推荐直接用 `@intelligent-ui/renderer-react`，或自研渲染器但认同一套 `ui.*` 事件）。
- **必接三面**：`open`（开 session 占位）、`stream`（边收到边画）、`action`（点击回写 → harness 续写）。
- **MCP 仍是真相源**：树、revision、state、pending actions 以 MCP session 为准；宿主是 **只读订阅 + action 上报**，不本地发明协议。
- **本仓交付**：稳定 schema、npm renderer、reference Host（对照实现）、本适配文档与 PoC checklist。  
- **宿主交付**：聊天气泡/旁栏挂载点、事件订阅通道、action 回传、产品级流式 UX（骨架/生成中）。
- **不做**：劫持宿主 DOM；承诺「只装 MCP、零产品改动」就气泡内 Intelligent UI。

---

## 1. 角色拆分

```
┌─────────────┐  stdio / MCP tools   ┌──────────────────┐
│  Harness    │ ───────────────────► │  mcp-server      │
│ (agent 环)  │ ◄── tool results ─── │  (真相源)        │
└──────┬──────┘                      └────────┬─────────┘
       │                                      │ ui.* 事件
       │ 产品内嵌                              │ (推送或旁路)
       ▼                                      ▼
┌─────────────────────────────────────────────────────┐
│  Host Adapter（宿主产品侧）                          │
│  · 气泡 / 旁栏挂载点                                 │
│  · 订阅 ui.open / ui.delta / ui.replace / …         │
│  · 调用 <UiRenderer tree onAction />                │
│  · 把 RenderAction → ui_report_action / actions 旁路 │
└─────────────────────────────────────────────────────┘
```

| 角色 | 谁 | 职责 |
|------|----|------|
| **Agent harness** | Cursor / Grok Bot / DSH… | 调 MCP tools；决定何时 `ui_open` / `ui_propose` / `ui_patch`；消费 drained actions |
| **MCP server** | `@intelligent-ui/mcp-server`（本仓） | Catalog、schema 校验、session 状态机、写 `ui.*`、收 action |
| **Renderer** | `@intelligent-ui/renderer-react`（本仓） | `UiNode` → React 控件；`onAction` 回调 |
| **Host Adapter** | **宿主产品必须实现** | 把事件接到聊天面；挂载 Renderer；回传 action；流式 UX chrome |

Reference `apps/host-window` = **对照实现**，证明协议可跑；**不是**选项 A 的最终用户面。

---

## 2. 必接表面（open / stream / action）

### 2.1 `open` — 占位与绑定

| 触发 | MCP 侧 | 宿主侧必须做 |
|------|--------|--------------|
| Agent 调 `ui_open` | 发 `ui.open`；建 session；`revision` 起点 | 在**当前助手气泡**（或紧贴旁栏 slot）挂载空画布；显示 `sessionId` / 「生成中」占位 |
| 可选 | tool result 含 `sessionId` + `hostHint` | 用 `sessionId` 订阅该 session；**不要**另开系统浏览器当主路径（那是选项 B） |

**验收**：用户提问后 ≤300ms 内气泡内出现占位（骨架或空 Stack），而不是等整树。

### 2.2 `stream` — 边收边画

| 事件 | 宿主行为 |
|------|----------|
| `ui.delta`（`partial: true`） | 立即把 `ops` 应用到本地镜像树（或直接换 MCP 下发的 snapshot）；`<UiRenderer>` 重绘；保留「生成中」条 |
| `ui.replace` | 整树替换；仍尊重 `partial` |
| `ui.done` / `partial: false` | 去掉生成中；允许完整交互 |
| `ui.error` | 气泡内错误条；`recoverable` 时勿拆掉 session |

**传输**：宿主可选任一通道，语义相同：

1. **推荐（产品内）**：harness 在 tool 流式结果 / 专用 channel 上把 `ui.*` JSON 推给前端（对标 AG-UI SSE）。  
2. **兼容（本仓已有）**：读 `$IUI_SESSION_DIR` NDJSON / Host HTTP API（见 `HOST-WINDOW.md`）——适合 PoC，不适合原生气泡延迟目标。  
3. **禁止**：等 agent 全文结束再一次性 mount（假流式）。

Agent 侧约定（与 `STREAMING-UX-GAP` P0 一致）：对比类等演示路径用 `ui_propose mode=ops` 或 `streaming_chunks`（JSONL 逐行），**禁止**默认整树想完再 `mode=tree`。

### 2.3 `action` — 点击闭环

```
用户点击 Button
  → UiRenderer onAction(RenderAction)
  → Host Adapter 上报
       · 生产：调 MCP `ui_report_action`（经 harness 代理 tool call），或
       · PoC：写 `{sessionId}.actions.ndjson` / POST loopback（同 Host 窗）
  → MCP 发 `ui.action`；入 pending
  → Harness `ui_drain_actions`（或 watch）→ 决定 `ui_patch` / 续聊
  → 新的 ui.delta/replace → 气泡内树更新
```

`RenderAction`（renderer 出口）字段：`type` / `nodeId` / `componentType` / `value?` / `path?` / `payload?`。  
映射到 `ui_report_action` 的字段以 [`TOOLS-SCHEMA.md`](./TOOLS-SCHEMA.md) 为准。

**验收**：点「更看续航」类按钮 → 无需用户切窗 → 表或文案在**同一气泡**更新。

---

## 3. MCP 仍是真相源（非协商）

| 事实 | 权威方 | 宿主本地可做 |
|------|--------|--------------|
| 当前 tree / revision | MCP session | 缓存镜像；若 `revision` 变旧则丢弃 |
| `state`（bind 路径） | MCP | 仅展示；写操作走 action → patch |
| Catalog / 未知类型 | MCP 启用目录 | 未知 → `catalog.base/Unknown` 黄条，不静默吞 |
| 自定义包信任 | MCP `register_*` + 受信目录 | 按 registry 动态 `extraRenderers`（④）；不可擅自执行未登记 entry |
| Session 生命周期 | `ui_open` … `ui_close` | 关闭气泡可触发 close；勿孤儿写 action |

宿主 **不得**：

- 在本地「发明」新 `ComponentType` 当正式能力（演示用 mock 除外）；  
- 绕过校验直接执行模型吐的任意 HTML/JS（与本仓 catalog 路线冲突）；  
- 把 Host 窗文件轮询延迟当成产品终态。

---

## 4. 最小宿主 API（适配器接口草案）

宿主前端实现下面这一组即可对接；语言不限，语义固定。TypeScript 示意：

```ts
/** 挂载点：一个聊天消息 / 面板对应一个 session 绑定 */
interface IntelligentUiHostSurface {
  /** open：为 session 创建绘制面（气泡内 slot） */
  mount(sessionId: string, opts?: { title?: string; density?: "full" | "compact" | "plain_prefer" }): void;

  /** stream：应用协议事件（已 parse 的 ui.* 对象） */
  applyEvent(event: UiProtocolEvent): void;

  /** 可选：直接塞最新 snapshot（调试 / 重连） */
  setSnapshot?(snapshot: { revision: number; tree: UiNode | null; state: Record<string, unknown>; partial?: boolean }): void;

  /** action：用户操作出口；宿主负责送到 MCP */
  onAction(handler: (action: RenderAction, sessionId: string) => void): void;

  /** 卸下（气泡折叠 / ui_close） */
  unmount(sessionId: string): void;
}
```

### 4.0 本仓 SDK（M0）

npm / workspace 包：`@intelligent-ui/host-adapter`（目录 `packages/host-adapter`）。

- `createIntelligentUiHostSurface()` → 上表接口的默认实现（本地镜像 + `applyOps`）。
- Interim 泵：`createHttpEventPump`（Host 窗 `/api/*`）、`createNdjsonEventPump`（注入读 NDJSON）。
- React：`import { HostSurfaceView } from "@intelligent-ui/host-adapter/react"`。
- **产品气泡通道不在此包**：`ProductBubbleChannel` 仅为类型/ stub；Cursor / Grok Bot 的 IPC/SSE 由宿主实现后再调用 `applyEvent`。

详见包内 `README.md` 与 [`HOST-ADAPTER-M0-CHECKLIST.md`](./HOST-ADAPTER-M0-CHECKLIST.md)。

### 4.1 推荐嵌入：`@intelligent-ui/renderer-react`

```tsx
import { UiRenderer } from "@intelligent-ui/renderer-react";
import "@intelligent-ui/renderer-react/styles.css";

<UiRenderer
  tree={tree}
  state={sessionState}
  density="full"
  extraRenderers={customPackageRenderers}
  onAction={(action) => reportToMcp(sessionId, action)}
/>
```

- Peer：`react` / `react-dom` 18+。  
- 非 React 宿主：用 Webview / iframe 加载同一 renderer 包，或自研映射但 **UiNode / ops 形状不变**。

### 4.2 事件订阅最小集

| 必须处理 | 可选 |
|----------|------|
| `ui.open` `ui.delta` `ui.replace` `ui.done` `ui.error` `ui.action` | 重放历史 NDJSON；多 Host 只读 |

公共信封与 ops 见 [`UI-DELTA-SCHEMA.md`](./UI-DELTA-SCHEMA.md)（`protocolVersion: "0.1"`）。

### 4.3 Harness ↔ Adapter 通道（宿主自选，文档要求可测）

| 通道 | 适用 | 延迟预期 |
|------|------|----------|
| 产品内 tool-stream / SSE / IPC | **选项 A 主路径** | 低（对齐宣传片） |
| `IUI_SESSION_DIR` 文件 + HTTP | PoC / 与 reference Host 对齐 | 中（≥100ms 轮询） |
| 仅 Markdown 摘要 | 降级 | 无真控件 |

---

## 5. 我们交付 vs 宿主必须建设

### 5.1 本仓（losebird / intelligent-ui-mcp）交付

| 交付物 | 状态 / 说明 |
|--------|-------------|
| MCP tools + session 状态机 | 已落地（①–③） |
| `ui.*` / UiNode / ops schema | 文档 + 实现 |
| `@intelligent-ui/renderer-react` | 已落地；base + shadcn + charts + 别名 |
| `apps/host-window` | 参考实现（选项 B 默认面；A 的对照） |
| 流式 `mode=ops` / JSONL `streaming_chunks` | P0 本机已落地 |
| 自定义包 register + 动态 import 约定 | ④ |
| **本文** + PoC checklist | 选项 A 合作入口 |
| **`@intelligent-ui/host-adapter`** | **M0 已脚手架**：`IntelligentUiHostSurface` + HTTP/NDJSON interim 泵 + `HostSurfaceView`；产品气泡通道仍宿主自有（见 [`HOST-ADAPTER-M0-CHECKLIST.md`](./HOST-ADAPTER-M0-CHECKLIST.md)） |
| 可选后续 | AG-UI/A2UI 导出适配器（选项 C）；多宿主 SDK 打磨（M4） |

### 5.2 宿主产品必须建设

| 能力 | 说明 |
|------|------|
| **聊天气泡（或紧贴）挂载点** | DOM/Webview slot；消息级 `sessionId` 绑定 |
| **事件泵** | 把 MCP/agent 侧 `ui.*` 实时推到前端 `applyEvent` |
| **挂载 Renderer** | npm 依赖或 iframe；处理 CSS / 密度 |
| **Action 代理** | 前端 → harness → `ui_report_action` / drain → 续写 |
| **流式 chrome** | 骨架、生成中、错误条、revision 抖动不白屏 |
| **安全策略** | 只渲染 catalog；自定义包跟本仓信任模型 |
| **生命周期** | 气泡销毁 ↔ `ui_close`；重连拉 snapshot |
| **（产品）权限与发版** | 官方开关 / 实验 flag；本仓无法单方塞进 Cursor/Grok |

---

## 6. 分阶段里程碑

| 阶段 | 目标 | 谁主导 | 验收 |
|------|------|--------|------|
| **M0 — 文档与对照** | 本文 + Host 窗演示 + **`packages/host-adapter` 脚手架** | 本仓 | 链接进 `00-INDEX`；checklist [`HOST-ADAPTER-M0-CHECKLIST.md`](./HOST-ADAPTER-M0-CHECKLIST.md)；与可行性选项 A 互指 |
| **M1 — 宿主 PoC（旁栏/Webview）** | 某一家 harness 用 Webview 嵌 `UiRenderer`，事件走文件或 HTTP | 宿主 + 本仓协助 | 同屏可见；点按钮能 drain + patch |
| **M2 — 气泡内嵌 + 真流式通道** | 事件走产品 IPC/SSE；`ops` 分片逐步上屏 | 宿主 | 「对比三款手机」：壳→表头→逐行；TTFC ≤ 首 upsert 后 300ms |
| **M3 — 生产打磨** | 多 session、重连、密度、无障碍、与文字交错 | 宿主 | 无第二窗心智；错误可恢复 |
| **M4 — 多宿主复用** | 抽出公共 adapter SDK；可选 AG-UI/A2UI 桥 | 本仓 + 标准 | 第二家宿主 ≤1 人周接入 M2 级 |

**排期现实**：M1+ 依赖宿主路线图；本仓可并行打磨 schema / renderer / 自动薄壳（选项 B）作为未接入前的默认体验。

---

## 7. PoC checklist（给第一家宿主）

1. 装本仓 MCP（`mcp.json` stdio）+ 本机可 `npm run build`。  
2. 前端引入 `@intelligent-ui/renderer-react` + `styles.css`。  
3. Agent 工具流：`ui_open` → 多次 `ui_propose mode=ops` → `ui_done` 语义。  
4. 实现 `mount` / `applyEvent` / `onAction`；先用 Host HTTP 或 NDJSON 打通。  
5. 点 Button → `ui_report_action` 或 actions 旁路 → `ui_drain_actions` → `ui_patch`。  
6. 换成产品内推送通道；去掉对系统浏览器的依赖。  
7. 用 `npm run stream-phone-compare` 的帧序做视觉对照（气泡内应同序）。  
8. 记录缺口回本仓（未知类型、样式、action 映射）。

---

## 8. 非目标与话术

| 禁止承诺 | 正确表述 |
|----------|----------|
| 「只装 MCP = OpenAI 气泡」 | 「装 MCP 得协议；气泡内体验需宿主嵌 renderer」 |
| 「本仓能改 Cursor DOM」 | 「提供嵌入指南与 PoC；发版在宿主」 |
| 「旁栏 P1 = 宣传片」 | 「旁栏是 M1；M2 才是气泡内 + 低延迟通道」 |
| 「换大模型解决同框」 | 「模型影响树质量；同框 = 宿主绘制面」 |

对外定位（与可行性文档一致）：**Generative UI 协议 + reference Host + 宿主适配器**；选项 A 是 **合作里程碑**，不是 MCP-only 周更项。

---

## 9. 文档交叉引用

- 可行性与选项排序：[`HARNESSLESS-FEASIBILITY.md`](./HARNESSLESS-FEASIBILITY.md) §4 选项 A  
- 流式 UX / TTFC：[`STREAMING-UX-GAP.md`](./STREAMING-UX-GAP.md)  
- 参考 Host（非气泡）：[`HOST-WINDOW.md`](./HOST-WINDOW.md)  
- 事件与 Node：[`UI-DELTA-SCHEMA.md`](./UI-DELTA-SCHEMA.md)  
- Tools：[`TOOLS-SCHEMA.md`](./TOOLS-SCHEMA.md)  
- Session：[`SESSION-STATE.md`](./SESSION-STATE.md)  
- M0 checklist / 包路径：[`HOST-ADAPTER-M0-CHECKLIST.md`](./HOST-ADAPTER-M0-CHECKLIST.md)（`packages/host-adapter`）
- 产品气泡挂载需求（Cursor/Grok）：[`PRODUCT-BUBBLE-MOUNT.md`](./PRODUCT-BUBBLE-MOUNT.md)
- 索引：[`00-INDEX.md`](./00-INDEX.md)

---

## 10. 一句话给宿主工程

> **认 `ui.*`、挂 `@intelligent-ui/renderer-react`、把 action 打回 MCP；树与 revision 以 MCP 为准。气泡像素是你们的产品面，协议与控件库是我们的。**
