# 产品需求：聊天气泡内挂载 Intelligent UI

> 日期：2026-10-08（Asia/Shanghai）  
> 受众：**Cursor / Grok Bot**（及同类 harness）的 **产品 + 平台工程**——拥有聊天气泡 DOM / Webview / 消息模型的一方。  
> 决策背景：Ace 选定 **选项 A**（宿主嵌 renderer）。本仓已交付协议、renderer、参考 Host 与 `@intelligent-ui/host-adapter`；**原生气泡像素只能由宿主发版实现**。  
> 技术契约（实现细节）：[`HOST-RENDERER-ADAPTER.md`](./HOST-RENDERER-ADAPTER.md)  
> 为何必须改产品面：[`HARNESSLESS-FEASIBILITY.md`](./HARNESSLESS-FEASIBILITY.md)  
> 本仓脚手架对照：[`HOST-ADAPTER-M0-CHECKLIST.md`](./HOST-ADAPTER-M0-CHECKLIST.md)  
> 索引：[`00-INDEX.md`](./00-INDEX.md)

---

## 1. 一句话需求

在助手消息气泡（或紧贴气泡的消息级 slot）内，实时挂载可交互的 Intelligent UI：用户提问后 ≤300ms 出现占位，随后随 `ui.*` 事件渐进上屏；点击控件后同一气泡更新，无需另开系统浏览器。

---

## 2. 为什么「只装 MCP」画不出像素

| MCP 能做的 | MCP **不能**做的 |
|------------|------------------|
| 校验 schema、管 session / revision / state | 强制宿主把 JSON 树编译成气泡内原生控件 |
| 发出 `ui.open` / `ui.delta` / `ui.replace` / … | 在 Cursor / Grok 的聊天气泡 DOM 里插入节点 |
| tool result 返回 text / image / resource 链接 | 把「嵌 renderer」变成一等公民 API |

**推论（产品必读）**：现行 MCP 下，tool 结果对聊天面仍是文本或旁路资源。没有 **宿主提供的绘制面**，就没有宣传片级「气泡内渐进控件」。本仓 reference Host（选项 B）证明协议可跑，但 **不是**最终用户面。详见可行性文档 §2。

本需求文档描述的是宿主产品必须建设的那一层：**消息级 mount point + 低延迟事件通道 + action 回写代理**。

---

## 3. 挂载点 API（助手消息内 slot）

### 3.1 产品面概念

| 概念 | 要求 |
|------|------|
| **Message slot** | 每条（或选定）助手消息可带一个 `intelligent-ui` 区域：气泡内嵌，或紧贴气泡下方/旁侧；同一消息可与 Markdown 正文交错，但 UI 区有明确边界。 |
| **Session 绑定** | Slot 与 MCP `sessionId` 1:1（或 N:1 明示主 session）；禁止一个 slot 混画多个未声明 session。 |
| **生命周期** | 消息仍在会话历史中 → slot 可重连拉 snapshot；消息删除 / 会话归档 → `unmount` 并建议触发 `ui_close`。 |
| **降级** | 无 slot 能力时：可展示 Markdown 摘要 +「在 Host 打开」链接；**不得**假装已是气泡内控件。 |

### 3.2 宿主应暴露给聊天前端的语义（对齐本仓 SDK）

产品不强制复制本仓 TypeScript，但 **语义必须等价**于 `@intelligent-ui/host-adapter` 的 `IntelligentUiHostSurface`：

```ts
interface IntelligentUiHostSurface {
  mount(sessionId: string, opts?: { title?: string; density?: "full" | "compact" | "plain_prefer" }): void;
  applyEvent(event: UiProtocolEvent): void;
  setSnapshot?(sessionId: string, snapshot: { revision: number; tree: UiNode | null; state: Record<string, unknown>; partial?: boolean }): void;
  onAction(handler: (action: RenderAction, sessionId: string) => void): void;
  unmount(sessionId: string): void;
}
```

推荐嵌入：`@intelligent-ui/renderer-react` 的 `UiRenderer`，或本仓 `HostSurfaceView`（`@intelligent-ui/host-adapter/react`）。非 React 宿主可用 Webview 加载同一包，**UiNode / ops 形状不变**。

### 3.3 建议的产品消息模型字段（示意）

```json
{
  "role": "assistant",
  "content": [{ "type": "markdown", "text": "…" }],
  "intelligentUi": {
    "sessionId": "sess_…",
    "status": "streaming",
    "revision": 3,
    "density": "full"
  }
}
```

`intelligentUi` 出现即表示该消息应渲染 slot；树本身走事件通道镜像，不必把整棵 tree 塞进消息持久化（可选缓存最新 snapshot 以便重开会话）。

---

## 4. 事件通道（优先低延迟 `ui.*` 流）

### 4.1 必须推送的事件

| 事件 | 聊天面前端行为 |
|------|----------------|
| `ui.open` | `mount(sessionId)`；显示骨架 / 空 Stack /「生成中」 |
| `ui.delta` | `applyEvent`；增量上屏；`partial: true` 时保留生成中 chrome |
| `ui.replace` | 整树替换；仍尊重 `partial` |
| `ui.done` | 去掉生成中；允许完整交互 |
| `ui.error` | 气泡内错误条；`recoverable` 时勿拆 session |
| `ui.action` | 可选：本地 ack / 调试；权威 pending 仍在 MCP |

公共信封与 ops：[`UI-DELTA-SCHEMA.md`](./UI-DELTA-SCHEMA.md)（`protocolVersion: "0.1"`）。

### 4.2 通道选型（产品决策）

| 通道 | 定位 | 延迟目标 |
|------|------|----------|
| **产品内 tool-stream / SSE / IPC**（推荐） | 选项 A **主路径**：agent 侧一出现 `ui.*` 即推到气泡前端 | 对齐宣传片；TTFC 见 §5 |
| Host HTTP / NDJSON 旁路 | **仅 PoC**；本仓 `createHttpEventPump` / `createNdjsonEventPump` | ≥100ms 轮询可接受于 M1，**不可**当生产终态 |
| 仅 Markdown | 降级 | 无真控件 |

**禁止**：等整段 agent 回复结束后再一次性 mount（假流式）。

### 4.3 与本仓 stub 的映射

| 本仓符号 | 状态 | 产品侧职责 |
|----------|------|------------|
| `IntelligentUiHostSurface` / `createIntelligentUiHostSurface()` | ✅ 已实现 | 气泡前端直接用，或自研等价实现 |
| `HostEventPump` + HTTP/NDJSON 泵 | ✅ interim | PoC / 对照；生产替换 |
| `ProductBubbleChannel` + `createProductBubbleChannelStub()` | ⬜ **类型占位**；`start()` **故意抛错** | **宿主实现** `kind: "product_bubble"` 的泵：订阅产品 IPC/SSE → 对每个事件调 `surface.applyEvent`；action 侧见 §6 |

Stub 存在是为了防止误把 interim 泵当成「Cursor/Grok 已接线」。产品里程碑 = **用真实 `ProductBubbleChannel` 替换 stub**。

---

## 5. Open：≤300ms 占位

| 触发 | 产品必须做 |
|------|------------|
| Agent 调 `ui_open`（或首个带 `sessionId` 的 `ui.*`） | 在**当前助手气泡** slot 内立刻 `mount` |
| 视觉 | 骨架、空 Stack、或 density 对应的占位；可显示短标题 |
| 时延 | **用户可见占位 ≤ 首个 open/upsert 信号后 300ms**（TTFC 占位）；不要等整树 |

Agent 约定（协议侧）：对比类等路径应用 `ui_propose mode=ops` 或 `streaming_chunks`，避免默认整树想完再 `mode=tree`。详见 [`STREAMING-UX-GAP.md`](./STREAMING-UX-GAP.md)。

---

## 6. Stream：deltas 边收边画

1. 通道把已 parse 的 `ui.delta` / `ui.replace` 交给 `applyEvent`。  
2. Renderer 按 revision 重绘；旧 revision 丢弃（MCP 为真相源）。  
3. `partial: true` → 保留「生成中」条；`ui.done` / `partial: false` → 移除。  
4. 重连：用 `setSnapshot` 或等价 API 拉最新 tree/state，再续订事件。  
5. 多帧观感对照：本仓 `npm run stream-phone-compare` 的帧序（壳 → 表头 → 逐行）应在气泡内同序出现。

---

## 7. Action → Agent turn

```
用户点击 Button / 改 Input
  → UiRenderer onAction(RenderAction)
  → 产品 action 代理（勿静默丢弃）
       · 经 harness 调 MCP `ui_report_action`，或
       · PoC：写 actions 旁路 / Host POST（仅开发）
  → MCP 发 `ui.action`；入 pending
  → Harness `ui_drain_actions`（或 watch）→ 决定 ui_patch / 续聊 / 新 tool 调用
  → 新的 ui.delta|replace → 同一气泡 applyEvent
```

`RenderAction` 字段：`type` / `nodeId` / `componentType` / `value?` / `path?` / `payload?`。映射以 [`TOOLS-SCHEMA.md`](./TOOLS-SCHEMA.md) 为准。

**产品体验验收**：点「更看续航」类按钮 → **无需用户切窗** → 表或文案在**同一气泡**更新；可伴随一次短 agent turn（工具续写），但 UI 反馈应先于或同步于长文回复。

---

## 8. 安全与信任

| 规则 | 说明 |
|------|------|
| **只渲染 catalog** | 未知 `ComponentType` → 黄条 / Unknown，不静默吞、不执行任意 HTML/JS |
| **自定义包** | 跟本仓 `register_*` + 受信目录模型；不可擅自执行未登记 entry |
| **MCP 真相源** | 树 / revision / state / pending 以 MCP session 为准；本地仅镜像 |
| **无 DOM 劫持** | 本仓不要求、也不应被理解为注入宿主任意页面 DOM |
| **Session 隔离** | Action 必须带正确 `sessionId`；禁止跨会话写 action |
| **权限 / 实验 flag** | 建议产品级开关（如「Intelligent UI 气泡」）；本仓无法单方塞进 Cursor/Grok 发版 |

---

## 9. 非目标

| 非目标 | 说明 |
|--------|------|
| 「只装 MCP = OpenAI 气泡」 | 协议 ≠ 绘制面；气泡是宿主产品能力 |
| 本仓改 Cursor / Grok 私有 DOM | 只提供 schema、renderer、adapter、本文需求 |
| 把参考 Host 窗当最终体验 | Host = 对照 / 未接入前的默认面（选项 B） |
| 用更大模型「解决同框」 | 模型影响树质量；同框 = 宿主 slot |
| M1 Webview/旁栏即宣传片 | M1 验证协议；**本需求对应 M2+ 气泡主路径** |
| 本仓实现 `ProductBubbleChannel` | 宿主自有 IPC/SSE；stub 会抛错以防误用 |

---

## 10. 验收标准（给产品 / 平台）

### 10.1 必须通过（M2 级「真气泡」）

1. **Slot 存在**：助手消息可渲染 Intelligent UI 区域（气泡内或紧贴）。  
2. **Open ≤300ms**：`ui.open`（或等价首信号）后用户可见占位。  
3. **真流式**：连续 `ui.delta`（`partial: true`）逐步上屏；非全文结束一次性画出。  
4. **Done 态**：`ui.done` 后去掉生成中；控件可点。  
5. **Action 闭环**：点击 → `ui_report_action`（或等价）→ drain → patch → **同一气泡**更新。  
6. **通道**：生产路径为产品 IPC/SSE/tool-stream，**不是** Host HTTP 轮询。  
7. **安全**：未知类型有可见降级；无任意脚本执行。  
8. **对照**：`stream-phone-compare` 帧序在气泡内可辨认同序。

### 10.2 明确不计入本需求完成

- 仅单独 Host 窗 / 旁栏 Webview 能跑（那是 M1 / 选项 B）。  
- 仅 Markdown 描述「这里本该有一张表」。  
- 调用 `createProductBubbleChannelStub().start()` 不抛错（stub **必须**继续抛错，直到宿主替换实现）。

### 10.3 与本仓里程碑对齐

| 阶段 | 谁 | 与本文关系 |
|------|-----|------------|
| M0 | 本仓 | adapter + stub；checklist 已有 |
| M1 | 本仓 Host 已接 adapter；宿主 Webview PoC | **不满足**本文终态 |
| **M2** | **宿主** | **本文主验收**：气泡 + 真流式通道 |
| M3–M4 | 宿主打磨 / 多宿主复用 | 多 session、无障碍、第二家 ≤1 人周 |

---

## 11. 本仓已有 vs 宿主待建（映射表）

| 能力 | 本仓 | 宿主（Cursor / Grok Bot） |
|------|------|---------------------------|
| MCP tools / session / `ui.*` | ✅ mcp-server | 配置 MCP；agent 按约定调 tool |
| Renderer | ✅ `@intelligent-ui/renderer-react` | 依赖并挂进 slot |
| Surface API | ✅ `IntelligentUiHostSurface` | 气泡前端调用 `mount` / `applyEvent` / `onAction` / `unmount` |
| Interim 泵 | ✅ HTTP / NDJSON | 仅本地对照；生产勿依赖 |
| **产品气泡通道** | ⬜ `ProductBubbleChannel` **stub** | **实现并接线** → `applyEvent` |
| 消息 slot UI | ❌ | **必须建设** |
| Action → agent turn | 协议 + Host PoC 旁路 | **产品代理** `ui_report_action` / drain 续写 |
| 实验 flag / 发版 | ❌ | 产品路线图 |

包路径：`packages/host-adapter/`（`createIntelligentUiHostSurface`、`createProductBubbleChannelStub`、`HostSurfaceView`）。

---

## 12. 建议实现顺序（宿主侧）

1. **Flag + slot 壳**：助手消息预留空 div / Webview；先显示静态「Intelligent UI 占位」。  
2. **接 Surface**：引入 host-adapter + renderer；手喂一条 `ui.replace` 能画出。  
3. **Interim 泵 PoC**（可选）：`createHttpEventPump` 对齐本仓 Host，验证 action 闭环。  
4. **换 ProductBubbleChannel**：tool-stream / SSE / IPC → `applyEvent`；去掉对系统浏览器与轮询的依赖。  
5. **TTFC 与 chrome**：骨架、生成中、错误条、revision 抖动不白屏。  
6. **与文字交错、多 session、重连** → M3。

---

## 13. 话术（对外 / 对内）

| 禁止 | 正确 |
|------|------|
| 「装上 intelligent-ui MCP 就有 OpenAI 同款气泡」 | 「MCP 提供协议与控件库；气泡挂载点由 Cursor/Grok 产品接入」 |
| 「本仓下周改你们 DOM」 | 「需求与 SDK 已齐；发版在宿主日历」 |
| 「旁栏 / Host 窗 = 已完成选项 A」 | 「那是 M1/B；选项 A 完成以本文 §10.1 为准」 |

---

## 14. 交叉引用

- 适配器契约（open/stream/action、最小 API）：[`HOST-RENDERER-ADAPTER.md`](./HOST-RENDERER-ADAPTER.md)  
- 可行性与「纯 MCP 不可行」论证：[`HARNESSLESS-FEASIBILITY.md`](./HARNESSLESS-FEASIBILITY.md)  
- M0 checklist / stub 行为：[`HOST-ADAPTER-M0-CHECKLIST.md`](./HOST-ADAPTER-M0-CHECKLIST.md)  
- 流式 UX / TTFC：[`STREAMING-UX-GAP.md`](./STREAMING-UX-GAP.md)  
- 参考 Host（非气泡）：[`HOST-WINDOW.md`](./HOST-WINDOW.md)  
- 事件与 Node：[`UI-DELTA-SCHEMA.md`](./UI-DELTA-SCHEMA.md)  
- Tools：[`TOOLS-SCHEMA.md`](./TOOLS-SCHEMA.md)  
- 文档索引：[`00-INDEX.md`](./00-INDEX.md)

---

## 15. 给平台工程的一句话

> **给每条助手消息一个 slot；把产品通道里的 `ui.*` 喂给 `IntelligentUiHostSurface.applyEvent`；把点击经 harness 打回 MCP。本仓的 `ProductBubbleChannel` 仍是 stub——实现它，才是气泡内 Intelligent UI。**
