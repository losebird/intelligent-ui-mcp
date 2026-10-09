# AUDIT P1-a：Host SSE 推送（替代短轮询）

> 日期：2026-10-09（Asia/Shanghai）  
> 基线：`fix/custom-package-sandbox-ci`（#4）  
> 分支：`feat/host-sse-stream`

## 做了什么

1. **服务端** `GET /api/stream`（等价：`GET /api/events?format=sse` 或 `Accept: text/event-stream`）  
   - 鉴权 / CORS 与其余 Host API 相同（除 health）  
   - 推送 `ready` / `current` / `session` / `snapshot` / `ui` / `action` / `ping`  
   - 短 poll + `fs.watch` 混合；心跳注释防代理掐断  
   - 原 `GET /api/events/:sessionId?since=` **JSON 短轮询保留**（回退）

2. **客户端** `@intelligent-ui/host-adapter`  
   - `createSseEventPump` — fetch + ReadableStream 解析 SSE（可带 Bearer，不依赖 EventSource）  
   - `createHostEventPump` — **优先 SSE**，连续失败或 404/501/405 → **回退** `createHttpEventPump`  
   - 参考 Host `App.tsx` 改用 `createHostEventPump`；顶栏显示 `xfer`

3. **冒烟**  
   - `host-smoke`：无 token → 401；bootstrap frames；live append → `ui.delta`  
   - `stream-smoke` phase5：MCP 写 session 后 Host SSE 可见

## 怎么用

```bash
# MCP 与 Host 共享同一 IUI_HOST_TOKEN + IUI_SESSION_DIR
IUI_SESSION_DIR=... IUI_HOST_TOKEN=... npm run host

# 客户端（默认）
createHostEventPump({ baseUrl, token: process.env.IUI_HOST_TOKEN }).start(surface)

# 强制轮询
createHostEventPump({ preferSse: false, ... })

# 仅 SSE
createSseEventPump({ baseUrl, token }).start(surface)
```

curl 探活：

```bash
curl -N -H "Authorization: Bearer $IUI_HOST_TOKEN" \
  -H "Accept: text/event-stream" \
  "http://127.0.0.1:5173/api/stream"
```

## 非目标

- 真气泡挂载 / ProductBubbleChannel  
- WebSocket（本轮优先 SSE）  
- 去掉文件旁路（SSE 仍读 `IUI_SESSION_DIR`）
