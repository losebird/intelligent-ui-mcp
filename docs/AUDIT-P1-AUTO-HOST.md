# AUDIT P1：ui_open 自动提示 / 拉起参考 Host + strictHash 默认

> 日期：2026-10-09（Asia/Shanghai）  
> 基线：`feat/host-sse-stream`（#5）  
> 分支：`feat/ui-open-auto-host-stricthash`

## 做了什么

### 1. `ui_open` → 自动提示 / 拉起 Host

| 步骤 | 行为 |
|------|------|
| Probe | `GET /api/health`（匿名） |
| Spawn | 默认 `IUI_AUTO_HOST=1`：若未就绪则 `detached` 执行 `npm run host`（同 `IUI_SESSION_DIR` + `IUI_HOST_TOKEN`），pid 写入 `~/.intelligent-ui-mcp/host.pid`，日志 `host-spawn.log` |
| Wait | 默认最多 ~2.8s（`IUI_HOST_SPAWN_WAIT_MS`）再 probe |
| Browser | 默认 `IUI_AUTO_OPEN_BROWSER=1`：`xdg-open` / `open` / `cmd start` 打开 **一键 URL** |
| 返回 | `hostUrl` / `embedUrl` / **`openUrl`**（含 `sessionId` + `token`）/ `hostReady` / `hostStarted` / `browserOpened` / `launchCmd` / `tokenFile` / `hostHint` |

关掉自动行为：

```bash
export IUI_AUTO_HOST=0
export IUI_AUTO_OPEN_BROWSER=0
```

冒烟脚本默认关掉自动 spawn/浏览器，避免 CI 孤儿进程。

### 2. 自定义包 `strictHash` 默认 true

- MCP `register_package`：省略 `strictHash` → **true**（可用 `IUI_STRICT_HASH=0` 改全局默认；工具显式 `strictHash:false` 仍可关掉）。
- Host `GET /api/package-entry/:id`：默认校验 registry 内 hash；缺 → **409 HASH_MISSING**；错 → **409 HASH_MISMATCH**（`IUI_STRICT_HASH=0` 跳过）。

## 怎么用

```bash
# 终端 A：只起 MCP（Cursor mcp.json 亦可）
export IUI_SESSION_DIR="$HOME/.intelligent-ui-mcp/sessions"
# 可选显式 token；否则自动写 ~/.intelligent-ui-mcp/host-token
npm start

# 在 harness 里调 ui_open：
# - 若 Host 未起：MCP 会尝试 npm run host + 打开浏览器
# - 工具结果里看 openUrl（一键，含 token）或 launchCmd 手动起

# 手动起 Host（自动关掉时）
IUI_SESSION_DIR=... IUI_HOST_TOKEN=... npm run host
# 浏览器打开 ui_open 返回的 openUrl
```

一键 URL 形如：

`http://127.0.0.1:5173/?sessionId=<id>&token=<shared-secret>`

（token 仅本机 loopback；勿贴到公开聊天。）

## Env

| Env | 默认 | 含义 |
|-----|------|------|
| `IUI_AUTO_HOST` | `1` | `ui_open` 时 Host 未就绪则 spawn `npm run host` |
| `IUI_AUTO_OPEN_BROWSER` | `1` | `ui_open` 后打开 `openUrl` |
| `IUI_HOST_SPAWN_WAIT_MS` | `2800` | spawn 后等待 health 上限 |
| `IUI_HOST_PID_FILE` | `~/.intelligent-ui-mcp/host.pid` | 防重复 spawn |
| `IUI_STRICT_HASH` | `1` | 注册与 package-entry 默认强制 hash |

## 非目标

- 真气泡挂载 / ProductBubbleChannel  
- 把 Host 塞进 MCP stdio 同进程  
- 远程（非 loopback）Host
