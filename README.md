# Intelligent UI MCP（①–⑥：stdio + Host + session + 自定义包 + policy + catalog/eval）

把 OpenAI **Intelligent UI** 一类「答案即界面」能力，做成可插拔的 **stdio MCP**：任意 harness 调 tools → 写出组件树事件；React Host 参考窗按 `catalog.base` / `catalog.shadcn` 真渲染，并支持**受信本地自定义包注册即渲染**。

> ① 已完成：stdio 服务、两包真 schema、renderer-react、events NDJSON 旁路、冒烟。  
> ② 已完成：Host 参考窗（文件旁路展示 + actions.ndjson）。  
> ③ 已完成：`mode=ops` / `streaming_chunks`、`ui_patch` / `ui_report_action`、actions watch + `ui_drain_actions`、G6 骨架（state.set → patch）。  
> ④ 已完成：`register_package` / `register_component` / `unregister`、信任目录 + hash、`acme.gauges` 示例、Host 动态 import。  
> ⑤ 已完成：设计判断 = **prompt + lint + 可选裁判**（≠ OpenAI RL）；`policy_check` / `evaluate_expr`；G6 安全 expr + `reducers`。  
> ⑥ 已完成：`catalog.charts` 真渲染；radix/mui/antd/chakra schema-only + Host 别名；`evals/cases` ≥20 + `npm run eval` / `catalog-smoke`。

## 要求

- Node.js ≥ 20
- npm 10+

## 安装与构建

```bash
cd intelligent-ui-mcp
npm install
npm run build
```

## 1) Cursor `mcp.json`（stdio MCP）

把路径改成你的绝对路径（也可参考 [`examples/cursor-mcp.json`](./examples/cursor-mcp.json)）：

```json
{
  "mcpServers": {
    "intelligent-ui": {
      "command": "node",
      "args": ["/ABS/intelligent-ui-mcp/packages/mcp-server/dist/index.js"],
      "env": {
        "IUI_SESSION_DIR": "/ABS/.intelligent-ui-mcp/sessions",
        "IUI_HOST_TOKEN": "replace-with-shared-secret"
      }
    }
  }
}
```

启动 MCP（通常由 Cursor spawn；也可手动）：

```bash
export IUI_SESSION_DIR="$HOME/.intelligent-ui-mcp/sessions"
# 可选：显式共享 Host API 密钥（不设则自动读写 ~/.intelligent-ui-mcp/host-token）
# export IUI_HOST_TOKEN="your-shared-secret"
npm start
# 等价：node packages/mcp-server/dist/index.js
```

进程占用 stdin/stdout 做 MCP JSON-RPC；日志只打 **stderr**。

## 2) Host 参考窗（另启，与 MCP 解耦）

在**同一** `IUI_SESSION_DIR` 下另开 Host（不要塞进 MCP stdio 进程）：

```bash
export IUI_SESSION_DIR="$HOME/.intelligent-ui-mcp/sessions"
# 与 MCP 使用同一 IUI_HOST_TOKEN（或同一 host-token 文件）
# export IUI_HOST_TOKEN="your-shared-secret"
npm run host
# 打开终端提示的本机 URL（默认 http://127.0.0.1:5173）
```

### Host API 鉴权（必读）

Host HTTP（`/api/current`、`/api/snapshot|events|…`、`POST /api/action`）需要共享密钥；**仅 `GET /api/health` 可匿名**（供 `ui_open` probe）。

| 配置 | 说明 |
|------|------|
| `IUI_HOST_TOKEN` | 推荐。MCP 与 Host **必须相同** |
| `IUI_HOST_TOKEN_FILE` | 可选；默认 `~/.intelligent-ui-mcp/host-token`（0600）。未设 env 时自动生成并复用 |
| 请求携带 | `Authorization: Bearer <token>` 或头 `X-IUI-Host-Token` 或查询 `?token=` |
| CORS | **不**反射任意 Origin；仅 loopback（`127.0.0.1` / `localhost` / `::1`）。额外来源用 `IUI_CORS_ORIGINS`（逗号分隔） |
| 无 token | 受保护路由 → **401**；非白名单 Origin → **403** |

参考 Host 窗会经 Vite 注入同进程 token；外部客户端（smoke / adapter）须自行带头。

推荐顺序：

1. 设置 `IUI_SESSION_DIR`（及可选 `IUI_HOST_TOKEN`）
2. `npm run host` → 浏览器打开 Host
3. Cursor / harness 连接 MCP，调用 `ui_open` → Host 顶栏出现 session
4. （可选）`register_package` 自定义包 → Host 读 `registry.json` 动态加载
5. `ui_propose`（tree 或 ops）出树 → 主区渲染控件
6. 点击 Button / 拖滑条 → Host 写 `{sessionId}.actions.ndjson`
7. MCP **watch 入库**并广播 `ui.action`；harness 用 `ui_drain_actions` 取走 → `ui_patch` 更新衍生节点

Host 只读文件旁路 + 本机 Vite middleware API；崩溃不影响 MCP。

## 冒烟

```bash
npm run build
npm run smoke         # MCP tree path → SMOKE_OK
npm run host-smoke    # Host API + actions.ndjson → HOST_SMOKE_OK
npm run stream-smoke  # ops / action / drain / chunks → STREAM_SMOKE_OK
npm run custom-smoke  # register / hash / unregister / Gauge propose → CUSTOM_SMOKE_OK
npm run policy-smoke  # lint / policy_check / expr / heuristic → POLICY_SMOKE_OK
npm run catalog-smoke # charts + schema-only + lint → CATALOG_SMOKE_OK
npm run eval:validate # cases schema ≥20 → EVAL_VALIDATE_OK
npm run eval          # heuristic format table → evals/results/latest.md
```

期望在临时 / 配置的 `IUI_SESSION_DIR` 下生成：

| 文件 | 用途 |
|------|------|
| `{sessionId}.ndjson` | `ui.open` / `ui.delta` / `ui.replace` / `ui.done` / `ui.error` / `ui.action` |
| `{sessionId}.snapshot.json` | 当前 session 快照 |
| `{sessionId}.actions.ndjson` | Host 写回 action 的旁路（方案 C）；MCP watch 入库 |
| `current.json` | 指向最新 session |
| `registry.json` | ④ 已注册自定义包（供 Host `import(entry)`） |
| `packages.ndjson` | ④ `package.registered` / `unregistered` 旁路事件 |

## Tools（①–⑥）

| Tool | 说明 |
|------|------|
| `list_packages` | 列出 catalog（含 `source: local`） |
| `list_components` | 列出控件 |
| `set_enabled_packages` | 启停包（`catalog.base` 不可关） |
| `set_enabled_components` | 启停单个控件 |
| `get_prompt_fragment` | 给模型的 UI 选用说明 |
| `get_json_schema` | 拉 props / 树 schema |
| `ui_open` | 开 session + 写旁路 + 启动 actions watch |
| `ui_propose` | `tree` 整树 / `ops` 增量 / `streaming_chunks`（chunkDone 时整段 parse） |
| `ui_patch` | 局部 ops；`action_pending` → `idle` |
| `ui_report_action` | 记账 + `ui.action`；`state.set` 写 state |
| `ui_drain_actions` | 拉取未 ack 的 pending actions（默认标记 drained） |
| `ui_get_pending_actions` | 只读 peek pending（不标记 drained） |
| `ui_get_state` | 读树/状态 |
| `ui_close` | 关 session |
| `register_package` | ④ 受信 local path 整包注册（hash / allowlist） |
| `register_component` | ④ 已注册包上 schema 热更新（不换 entry） |
| `unregister` | ④ 卸自定义包/组件（不可卸 `catalog.*`） |
| `policy_check` | ⑤ 设计判断裁判（默认关；`IUI_POLICY_ENABLED=1`） |
| `evaluate_expr` | ⑤ 安全表达式求值（白名单算术 / round·min·max·abs） |

### ⑤ 设计判断（policy / 裁判）

**设计判断 = prompt + lint + 可选裁判，≠ OpenAI RL 权重。**

| Env | 默认 | 含义 |
|-----|------|------|
| `IUI_POLICY_ENABLED` | 关 | `1`/`true` 才启用裁判门控 |
| `IUI_POLICY_ENDPOINT` | — | HTTP POST JSON 裁判 |
| `IUI_POLICY_CMD` | — | 本地 CLI：stdin JSON → stdout JSON |
| `IUI_POLICY_TIMEOUT_MS` | `5000` | 超时后降级 Phase A 启发式 |

- Lint（propose/patch）：`CARD_OVERWRAP`（warn）、`CHART_MISSING_DATA`（error）、`UNKNOWN_TYPE` 等；error → `ok:false`。
- `ui_propose` 可带 `query` / `forceUi`；开启裁判且判 `plain_text` 时不落树（除非 `forceUi`）。
- G6 expr：session `reducers` 与节点 `expr`；`state.set` / `ui_patch` 后 MCP 侧求值写回。禁止 `Function`/`eval`/任意 JS。
- Mock：`scripts/mock-policy-referee.mjs`（无 API key）。

### ④ 自定义包（注册即渲染）

默认信任目录（可用 `IUI_TRUSTED_DIRS` 以 `:` 追加）：

- 仓库 `packages/`
- 仓库 `examples/custom-packages/`
- `~/.intelligent-ui-mcp/trusted`

示例：[`examples/custom-packages/acme-gauges/`](./examples/custom-packages/acme-gauges/)

```bash
# 算 entry hash 写入 manifest.renderer.hash
node scripts/hash-package-entry.mjs examples/custom-packages/acme-gauges/dist/render.js
```

`register_package({ path, enable?, strictHash? })`：`strictHash` 默认 true；缺 hash → `HASH_MISSING`；错 hash → `HASH_MISMATCH`；目录外 → `PATH_NOT_TRUSTED`。  
**永不** eval 模型 JS；不支持 npm/url。

Host：轮询 `GET /api/packages` → 对 `entryAbsPath` 做 Vite `/@fs` 动态 `import()`，按 `exports` 映射到 `UiRenderer.extraRenderers`；失败黄条 + `catalog.base/Unknown`。

规范全文：[`docs/CUSTOM-PACKAGE-MANIFEST.md`](./docs/CUSTOM-PACKAGE-MANIFEST.md)。

### Action 闭环（A+B）

- **A**：MCP 后台 watch `{sessionId}.actions.ndjson` → 按 `actionId` 去重入库 + 发 `ui.action`（与 `ui_report_action` 同效）。
- **B**：harness 调 `ui_drain_actions` / `ui_get_pending_actions` 取走 pending，再决定 `ui_patch`。

### G6 骨架

Session `state` + 节点 `bind`；Host 上报 `state.set` → MCP 写入 state → harness `ui_patch` 更新 Label 等衍生节点（计算权威在 harness）。

## Host API（仅 loopback）

| 端点 | 说明 |
|------|------|
| `GET /api/current` | `current.json` |
| `GET /api/snapshot/:sessionId` | 快照（含 tree/state） |
| `GET /api/events/:sessionId?since=` | 事件 NDJSON 增量 |
| `GET /api/packages` | ④ `registry.json` 自定义包列表 |
| `POST /api/action` | append `actions.ndjson`（actionId 幂等） |

## 仓库结构

```
apps/
  host-window/        # ② Vite + React Host（④ 动态加载自定义包）
packages/
  catalog-base/       # catalog.base schema
  catalog-shadcn/     # catalog.shadcn schema
  mcp-server/         # stdio MCP（③–⑥）
  catalog-charts/     # ⑥ Line/Bar/Pie
  catalog-{radix,mui,antd,chakra}/  # ⑥ schema-only
  renderer-react/     # type → React 真组件 + extraRenderers
examples/
  custom-packages/acme-gauges/  # ④ 示例 Gauge
docs/
scripts/smoke.mjs
scripts/host-smoke.mjs
scripts/stream-action-smoke.mjs
scripts/custom-package-smoke.mjs
```

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `IUI_SESSION_DIR` | `~/.intelligent-ui-mcp/sessions` | 事件/快照/actions/registry 旁路（MCP 与 Host **必须一致**） |
| `IUI_HOST_TOKEN` | （自动生成到 token 文件） | Host API 共享密钥；MCP 与 Host **必须一致** |
| `IUI_HOST_TOKEN_FILE` | `~/.intelligent-ui-mcp/host-token` | token 落盘路径（0600） |
| `IUI_CORS_ORIGINS` | （空） | 额外允许的 CORS Origin（逗号分隔）；默认仅 loopback |
| `IUI_HOST_URL` | `http://127.0.0.1:5173` | `ui_open` probe / embed 基址 |
| `IUI_ACTION_TIMEOUT_MS` | `120000` | `action_pending` 超时回 idle |
| `IUI_TRUSTED_DIRS` | （追加到默认三目录） | `:` 或 OS 分隔的额外绝对信任路径 |
| `IUI_REPO_ROOT` | 自动探测 | monorepo 根（解析默认信任目录） |

### ⑥ 其余 catalog + 评测（G5 / G7）

- **真渲染**：`catalog.charts` — `LineChart` / `BarChart` / `PieChart`（轻量 SVG，无重型 chart 库）
- **schema-only**（默认关闭，可 `set_enabled_packages`）：`catalog.radix` / `catalog.mui` / `catalog.antd` / `catalog.chakra`
- Host 对常见 schema-only 类型做 base/shadcn **别名**（如 `catalog.antd/Button` → `catalog.shadcn/Button`）；否则 Unknown 黄条
- 评测：`evals/cases/*.json`；`npm run eval:validate`（CI）；`npm run eval`（启发式 format 表）
- G10 预留：Host 密度选择器；`get_prompt_fragment({ density })` 一句偏好

```bash
npm run catalog-smoke   # CATALOG_SMOKE_OK
npm run eval:validate   # EVAL_VALIDATE_OK
npm run eval            # → evals/results/latest.md
```

## ③ 已知简化

- `streaming_chunks`：**`mode=ops` + JSONL 行**在到达时即 apply（不必等 `chunkDone`）；非 JSONL 缓冲仍在 `chunkDone=true` 时整段 JSON.parse（树 / `{tree}` / `{ops}`）。不做 partial JSON 流式抽出子节点。失败 → `ui.error` `PARSE_FAILED` recoverable，保留 partial。
- `refresh`：可选字段；若传入仅记 warnings 别名，ops 照常应用。
- `replace_tree`：作为 ops 便利算子（整树替换），与事件 `ui.replace` 并存。

## ④ 已知简化

- `register_component`：仅已注册 local 包上的 **schema 热更新**（不换 entry）；换入口请重新 `register_package`。
- Host 动态加载依赖 Vite `/@fs`（dev）；不做 iframe 硬沙箱。
- 无 npm/url 远程装包。

## License

MIT
