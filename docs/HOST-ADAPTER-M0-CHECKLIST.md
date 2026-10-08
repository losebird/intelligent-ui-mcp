# Host Adapter M0 Checklist（选项 A）

> 日期：2026-10-08（Asia/Shanghai）  
> 对应契约：[`HOST-RENDERER-ADAPTER.md`](./HOST-RENDERER-ADAPTER.md)  
> 代码：`packages/host-adapter`（`@intelligent-ui/host-adapter`）

---

## M0 目标（本仓）

把「文档对照」落到 **可 import 的 surface + interim 泵**，供第一家宿主做 Webview/气泡旁路 PoC，**不**要求产品气泡 IPC 已接线。

| 项 | 状态 | 说明 |
|----|------|------|
| 契约文档 `HOST-RENDERER-ADAPTER.md` | ✅ | open / stream / action；最小 API |
| 索引互链 `00-INDEX` + 可行性选项 A | ✅ | 见各文档交叉引用 |
| `IntelligentUiHostSurface` 类型 + 默认实现 | ✅ | `packages/host-adapter` |
| 挂 `@intelligent-ui/renderer-react` | ✅ | `HostSurfaceView` |
| Interim 事件泵（HTTP / NDJSON） | ✅ | 对齐 Host 窗旁路；**非**产品终态 |
| 产品气泡通道（Cursor/Grok IPC/SSE） | ⬜ stub | **宿主自有**；本仓仅 `ProductBubbleChannel` 占位 |
| 推远程 / 发版 npm | ⬜ 不做 | Ace：LOCAL ONLY，无 push |

---

## 文档对照（done）

- [x] §2 必接三面：`mount` ≈ open，`applyEvent` ≈ stream，`onAction` ≈ action，`unmount`  
- [x] §3 MCP 真相源：本地镜像可丢旧 `revision`；重连 `setSnapshot`  
- [x] §4.1 嵌入 `UiRenderer`（经 `HostSurfaceView`）  
- [x] §4.3 通道表：interim = 文件/HTTP；产品通道标注宿主自有  
- [x] §6 M0 验收：本文 + 包 README + 回链适配文档  

---

## 本机验收（adapter 包）

```bash
cd /path/to/intelligent-ui-mcp
npm run build -w @intelligent-ui/renderer-react
npm run build -w @intelligent-ui/host-adapter
# 可选：整仓 build 已含 host-adapter 时一并编过
```

手测要点：

1. `createIntelligentUiHostSurface()` → `mount` → `applyEvent(ui.replace|ui.delta)` → `getMirror` 树变化。  
2. `createHttpEventPump({ baseUrl }).start(surface)` 在 `npm run host` 起来后能跟上 `ui_open` / propose。  
3. `HostSurfaceView` 能画树；点击走 `surface.onAction`（`wireActions: true` 时 POST `/api/action`）。  
4. `createProductBubbleChannelStub().start()` **应抛错**（防止误当已接线）。

---

## M1：参考 Host 接 adapter（本仓已做）+ Webview PoC（宿主主导）

### M1-host-wire（本仓，2026-10-08）

`apps/host-window` 已用 `@intelligent-ui/host-adapter` 替换自写轮询：

| 项 | 状态 | 说明 |
|----|------|------|
| `createIntelligentUiHostSurface` | ✅ | App 内单例 surface |
| `createHttpEventPump` | ✅ | 跟 `/api/current|snapshot|events`；chrome 经 `onCurrent` / `onEvent` / sticky `onPollError` |
| `HostSurfaceView` | ✅ | 主画布；action 经 `surface.onAction` → `POST /api/action` |
| Host API / `sessionApi.mjs` | ✅ 未改 | 仍为真相旁路 HTTP |
| 产品气泡 IPC | ⬜ | 仍 stub；宿主自有 |

验收：`npm run build -w @intelligent-ui/host-adapter && npm run build -w @intelligent-ui/host-window`；`npm run host-smoke`；手测 `npm run host` + `live-demo` 渐进上屏与点击写 actions。

### 宿主 Webview / 气泡旁路（仍宿主主导）

下列步骤 **不在本仓单独完成**；对照实现即上表 reference Host。

1. [ ] 宿主开 Webview（或旁栏 iframe）加载依赖 `@intelligent-ui/renderer-react` + `@intelligent-ui/host-adapter` 的薄页（或 iframe 嵌 `host-window?embed=1`）。  
2. [ ] PoC 事件仍走 **Host HTTP** 或 NDJSON 旁路（`createHttpEventPump`）；同屏可见 session。  
3. [ ] 点 Button → actions 旁路 / `ui_report_action` → `ui_drain_actions` → `ui_patch` → 树更新。  
4. [ ] 记录缺口（未知类型、样式、action 映射）回本仓。  
5. [ ] **不要**在 M1 宣称已达宣传片气泡；M2 才换产品 IPC/SSE。

### 气泡内嵌（M2）差分

| M1 | M2 |
|----|-----|
| Webview / 旁栏 / 参考 Host（adapter 泵） | 助手气泡（或紧贴）slot |
| HTTP/NDJSON 泵 | 产品 tool-stream / SSE / IPC → `applyEvent` |
| 可接受 ≥100ms 轮询 | TTFC ≤ 首 upsert 后 300ms |

---

## 路径速查

| 路径 | 用途 |
|------|------|
| `packages/host-adapter/` | SDK 源码 |
| `packages/host-adapter/README.md` | 包说明（works vs stub） |
| `apps/host-window/` | 参考 Host（**M1 已接 host-adapter**；选项 B 窗 + A 对照泵后端） |
| `docs/HOST-RENDERER-ADAPTER.md` | 契约 |
| `docs/HOST-ADAPTER-M0-CHECKLIST.md` | 本文 |
| `docs/PRODUCT-BUBBLE-MOUNT.md` | 产品气泡挂载需求（替换 ProductBubbleChannel stub） |

---

## 一句话

> M0 = 契约可编码、interim 泵可跑、气泡通道留给宿主。  
> M1-host-wire = 参考 Host 已走 adapter；下一步是某家 harness 的 Webview/气泡旁路 PoC（仍可 iframe 嵌 Host）。
