# Data tool vs Render tool（防整卡 remount）

> 第一性原理：用户交互后要**改数据**，不要**重建 UI 树**。树重建 = React remount = 自定义包 iframe 重建 = 本地输入态丢失。

## 两分法

| 角色 | MCP tools | 典型 ops | 何时用 |
|------|-----------|----------|--------|
| **Render** | `ui_open`, `ui_propose` | `replace_tree`, 首次 `upsert` 壳/表头 | 建 session、定 ComponentType、流式长出结构 |
| **Data** | `ui_patch`,（间接）`ui_report_action` + reducers | `patch_props`, `statePatch`, `set_bind` | 改文案/数字/选中/行数据；响应点击后的刷新 |

## 硬约束

1. **`node.id` 稳定**：同一交互控件在整个 session 生命周期内 id 不变。
2. Action 之后默认路径：`ui_drain_actions` → **`ui_patch`**，**禁止**再 `ui_propose` + `replace_tree` 刷数。
3. Host 自定义包：props 变更走 sandbox `postMessage` type=`props`；只有 `nodeId` / package entry 变了才重建 iframe。
4. React key = **`node.id`**（不要用会变的 `node.key` 当挂载键）。

## Action 信封（对齐）

Host / iframe / MCP 统一为 RenderAction 字段：

```json
{
  "actionId": "a_…",
  "sessionId": "s_…",
  "type": "click|change|equals|…",
  "nodeId": "calc1",
  "componentType": "catalog.shadcn/Calculator",
  "value": null,
  "path": null,
  "payload": {},
  "ts": "…",
  "source": "host"
}
```

- 自定义包 iframe：`iui.sandbox.v1` → `action`（可带 `action_ack`）
- 气泡嵌 Host：`iui.host.v1` → `iui.resize`（高度）；交互仍走 Host `POST /api/action`，不经父页转发
- 旁路文件：`{sessionId}.actions.ndjson` 扁平行；MCP watcher 兼容旧版嵌套 `{ action: {...} }`

实现：`normalizeRenderAction`（`@intelligent-ui/renderer-react`）、`normalizeSandboxAction`、`appendAction`。

## 反例 → 正例

```text
❌ ui_propose mode=tree replace_tree（整树新 id）刷新对比表价格
✅ ui_patch ops:[{ op:"patch_props", nodeId:"compare1", props:{ items:[…] } }]

❌ 每次 action 后 ui_open 新 session
✅ 同一 sessionId + ui_patch / statePatch
```

## 服务端提示

- `ui_report_action` / Host drain 的 `note` 会提醒走 Data tool。
- `ui_propose` / 含 `replace_tree` 的 ops / patch 在已有树上会打 `REMOUNT_RISK` warning。

## 验收

`npm run iframe-action-smoke` — 扁平/嵌套 action 归一、patch 保 id、静态协议含 `action_ack` + requestId 过滤。
