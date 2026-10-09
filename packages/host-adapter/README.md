# `@intelligent-ui/host-adapter`

选项 A（宿主嵌渲染器）的 **最小适配器 SDK**：实现 `IntelligentUiHostSurface`（`mount` / `applyEvent` / `onAction` / `unmount`），并提供 **interim** 事件泵对接现有 Host HTTP / NDJSON 旁路。

> **产品气泡通道（Cursor / Grok Bot 聊天气泡 IPC/SSE）由宿主自有，本包不实现。**  
> 契约：[`docs/HOST-RENDERER-ADAPTER.md`](../../docs/HOST-RENDERER-ADAPTER.md)  
> M0 checklist：[`docs/HOST-ADAPTER-M0-CHECKLIST.md`](../../docs/HOST-ADAPTER-M0-CHECKLIST.md)

## 安装（workspace）

```bash
npm run build -w @intelligent-ui/host-adapter
```

Peer：`react` / `react-dom` 18+（仅用 `HostSurfaceView` 时需要）。

## 快速用法

```ts
import {
  createIntelligentUiHostSurface,
  createHttpEventPump,
} from "@intelligent-ui/host-adapter";

const surface = createIntelligentUiHostSurface();
surface.onAction((action, sessionId) => {
  // 生产：经 harness 调 ui_report_action
  // PoC：HTTP 泵 attachActionBridge / wireActions
  console.log(sessionId, action);
});

// Interim：跟 apps/host-window 同一套 /api/*
const stop = createHttpEventPump({
  baseUrl: "http://127.0.0.1:5173",
  token: process.env.IUI_HOST_TOKEN, // same secret as Host / MCP
  wireActions: true,
}).start(surface);

// 气泡 slot / Webview：
// import { HostSurfaceView } from "@intelligent-ui/host-adapter/react";
// <HostSurfaceView surface={surface} sessionId={sid} />
```

## 导出

| 符号 | 状态 | 说明 |
|------|------|------|
| `createIntelligentUiHostSurface` | **可用** | 本地镜像 + applyOps |
| `applyOps` / `UiOp` | **可用** | 与 mcp-server ops 同步的客户端实现 |
| `createHttpEventPump` | **可用** | 轮询 Host `/api/current|snapshot|events` + 可选 `POST /api/action` |
| `createNdjsonEventPump` | **可用** | 注入 `readEvents` 的 NDJSON 旁路（Node/PoC） |
| `HostSurfaceView`（`/react`） | **可用** | 包 `UiRenderer` + 生成中/错误 chrome |
| `createProductBubbleChannelStub` | **stub** | 产品通道占位；`start()` 抛错提示改用 interim 泵 |

## 与 `apps/host-window` 关系

| | host-window | host-adapter |
|--|-------------|--------------|
| 角色 | 参考 Host 窗（选项 B 默认面；**M1 已接本包**） | 选项 A SDK / Webview·气泡 PoC 内核 |
| 事件 | `createHttpEventPump` → surface | surface.applyEvent + 可选 snapshot 校正 |
| 挂载 | 整窗 App + `HostSurfaceView` | 可嵌任意 React slot |

## 非目标

- 不劫持 Cursor/Grok DOM  
- 不把文件轮询延迟当成产品终态  
- 不在本包实现官方气泡 IPC（宿主交付）
