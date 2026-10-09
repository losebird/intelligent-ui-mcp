# Host 参考窗需求（②）

## 目标

把 MCP 产出的 `ui.*` 事件画成可点界面，达到「答案内嵌 UI」的可演示体验。  
**不是** Cursor 聊天气泡插件。

## 谁启动

| 进程 | 职责 | 启动方 |
|------|------|--------|
| MCP server（stdio） | Catalog、校验、session、写事件旁路 | Cursor / Claude / 任意 harness 按 `mcp.json` spawn |
| Host window | 订阅事件、React 渲染、把用户操作打回 MCP | **用户或脚本另启**：`pnpm host` / `npm run host` |

二者 **解耦**：Host 不是 stdio 子进程（stdio 已被 MCP 协议占用）。用共享目录或本机 socket 通信。

```
Harness --stdio--> MCP server --append--> $IUI_SESSION_DIR/<sessionId>.ndjson
                         ^                         |
                         |                         v
                    tools/call              Host (Vite/React)
                    ui_report_action  <--- HTTP localhost 或 MCP 侧 channel
```

## 通信方案（② 默认）

1. **主路径：NDJSON 旁路文件**
   - Env：`IUI_SESSION_DIR`（默认 `~/.intelligent-ui-mcp/sessions`）。
   - MCP 每次事件 append 一行；另写 `current.json` 指针：`{ "latestSessionId", "revision" }`。
   - Host：`fs.watch` 或轮询（≥100ms）读增量。
2. **可选：Unix socket / 本机 WebSocket**
   - MCP 内嵌 `127.0.0.1:0` 或固定 `17246`；Host 连接收推送。
   - ② 可不实现；文件旁路必须有。
3. **Action 回传**
   - Host 调 MCP 的 `ui_report_action`：因 Host 不是 MCP client 标准位，采用：
     - **A（推荐 ②）**：Host 内嵌轻量 MCP client，再连**同一** server 不现实（stdio 单主）。故改为：
     - **B**：MCP 同时开 **loopback HTTP** `POST /action`（仅 127.0.0.1），Host post action；或
     - **C**：Host 写 `actions.ndjson`，MCP 侧 watch 再转入 session（纯文件，实现简单）。
   - **拍板进设计：② 用 C（action 文件旁路）+ 可选 B**；文档与实现选 C 为必做，B 为增强。
- **③ MCP watch**：server 在 `ui_open` 后 watch `actions.ndjson`，按 `actionId` 去重入库并发 `ui.action`；harness 另可用 `ui_drain_actions` 拉取 pending（A+B）。

## 与 stdio 进程关系

- Harness 保活 MCP；Host 崩溃不影响 MCP。
- MCP 崩溃：Host 显示断线；session 文件仍可只读回放。
- 多 Host 读同一 session：允许；多 Host 写 action：靠 actionId 幂等，慎用。

## 最小 UI

1. 顶栏：`sessionId`、`revision`、`status`、密度开关（预留 G10）、打开 session 目录。
2. 主区：按 `catalog.base` + `catalog.shadcn` 映射渲染当前 tree。
3. 未知类型：`Unknown` 黄条。
4. 底栏：最近 `ui.action` / `ui.error` 日志（调试）。
5. 无树时：空状态文案「等待 ui_open / ui_propose」。

## 技术选型（建议，非强制）

- Vite + React + TypeScript。
- 组件：shadcn/ui 风格实现 `CATALOG-BASE-SHADCN.md` 必做集。
- 包名草案：`apps/host-window` 或 `packages/renderer-react` + thin app。

## 与 Cursor 集成边界

| 能做 | 不能做（v0.x） |
|------|----------------|
| Cursor 配 mcp.json 调 tools | 把组件树塞进 Cursor 气泡 |
| 用户并排开 Host 窗看 UI | 官方 UI 扩展 API（不存在则不承诺） |
| 自有 harness 用 Webview 嵌同一 renderer | 劫持 Cursor Electron DOM |

对用户话术：「在 Cursor 里对话触发 UI；在 Intelligent UI Host 窗口里查看和点击。」

## 启动顺序（验收脚本）

1. 设置 `IUI_SESSION_DIR`。
2. 启动 Host。
3. 启动 / 连接 MCP（经 Cursor）。
4. `ui_open` → Host 显示 session。
5. `ui_propose` tree → Host 画控件。
6. 点击 Button → `actions.ndjson` →（③）harness 收到并 patch。

## ② 验收清单

- [x] 仅文件旁路可完成展示。
- [x] base+shadcn 必做控件可渲染。
- [x] 点击产生 action 旁路记录。
- [x] README 含 mcp.json + Host 启动两段。

### 实现落点（②）

| 项 | 路径 |
|----|------|
| Host 窗 | `apps/host-window`（Vite + React；**M1 经 `@intelligent-ui/host-adapter`**） |
| Session API | `apps/host-window/server/sessionApi.mjs`（`/api/current` `/api/snapshot/:id` `/api/events/:id` `POST /api/action`） |
| 客户端泵 | `createHttpEventPump` + `HostSurfaceView`（见 `packages/host-adapter`） |
| Action 旁路 | `{IUI_SESSION_DIR}/{sessionId}.actions.ndjson`（方案 C，actionId 幂等：解析 NDJSON + 内存 Set） |
| 鉴权 | `IUI_HOST_TOKEN` / `~/.intelligent-ui-mcp/host-token`；除 `GET /api/health` 外均需 Bearer / `X-IUI-Host-Token` |
| CORS | 仅 loopback Origin；不反射任意 Origin |
| 启动 | `IUI_SESSION_DIR=... IUI_HOST_TOKEN=... npm run host` |
| 验收 | `npm run host-smoke` → `HOST_SMOKE_OK`（含 401/403 断言） |

## ④ Host 与自定义包

- 轮询 `GET /api/packages`（读 `IUI_SESSION_DIR/registry.json`）。
- 对每个包 `entryAbsPath`：Vite `/@fs` 动态 `import()`，按 `exports` 注入 `UiRenderer.extraRenderers`。
- import 失败 / 缺 export → 黄条 + 该 type `catalog.base/Unknown`；MCP 侧已拒的路径 Host 不会看到。

## 客户端事件路径（M1：host-adapter）

参考 Host **不再**在 `App.tsx` 自写 `/api/current|snapshot|events` 轮询。M1 起：

| 层 | 路径 | 职责 |
|----|------|------|
| Surface | `@intelligent-ui/host-adapter` `createIntelligentUiHostSurface` | 本地镜像 + `applyEvent` / `setSnapshot` |
| 泵 | `createHttpEventPump` | 轮询 Host HTTP；`onCurrent` / `onEvent` / sticky `onPollError` |
| 画布 | `HostSurfaceView` | 包 `UiRenderer`；点击 → `surface.onAction` → `POST /api/action`（`api.ts`） |
| API 服务 | `server/sessionApi.mjs` + `hostAuth.mjs` | NDJSON / snapshot / actions 旁路 + **token 鉴权** + 严格 CORS |

契约见 [`HOST-RENDERER-ADAPTER.md`](./HOST-RENDERER-ADAPTER.md)；验收勾选 [`HOST-ADAPTER-M0-CHECKLIST.md`](./HOST-ADAPTER-M0-CHECKLIST.md) §M1-host-wire。

## 轮询韧性（Host client）

`/api/current` 等 GET 在 Vite HMR / 短暂断连时偶发 `TypeError: Failed to fetch`（数据文件往往仍正常）。

- `api.ts`：GET/POST（config / packages / action）对可重试网络错误短重试（同 Origin、`cache: no-store`）。
- `createHttpEventPump`：GET 短重试；连续失败才 sticky 红条（默认 3 次）；指数退避；snapshot/events 软失败不盖掉 status。
- `vite.config.ts`：session API 中间件置顶；`watch.ignored` 排除 `IUI_SESSION_DIR` / `~/.intelligent-ui-mcp`，避免写 NDJSON 重启 Vite。

## Host API 鉴权与 CORS

1. **共享密钥**：`IUI_HOST_TOKEN` 环境变量，或文件 `IUI_HOST_TOKEN_FILE`（默认 `~/.intelligent-ui-mcp/host-token`，mode `0600`）。MCP 启动与 `npm run host` 都会 `ensure` 同一路径。
2. **携带方式**：`Authorization: Bearer <token>`，或请求头 `X-IUI-Host-Token`，或查询参数 `?token=`（embed PoC）。
3. **公开路由**：仅 `GET /api/health`（及 CORS preflight `OPTIONS`）。其余 `/api/*` 无 token → **401**。
4. **CORS**：`Access-Control-Allow-Origin` **只**允许 hostname 为 `127.0.0.1` / `localhost` / `::1` 的 Origin；可用 `IUI_CORS_ORIGINS` 追加。**禁止**反射任意 Origin。非白名单 → **403** `CORS_ORIGIN_DENIED`。
5. **actionId 幂等**：按行 `JSON.parse` 后比对 `actionId` 字段（加进程内 Set），**不用**全文 `includes` 字符串匹配。

详见根 README「Host API 鉴权」。

## 明确不做

- 把 Host 塞进 MCP stdio 同一进程用 stdin 抢协议。
- 远程 Host（非本机）连旁路——② 仅 loopback/本机文件。
