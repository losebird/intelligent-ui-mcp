# Session 状态机

## 状态枚举

| status | 含义 |
|--------|------|
| `none` | 无此 session（或已销毁） |
| `open` | 已 `ui_open`，尚无树或树为空，可接受 propose |
| `streaming` | 正在应用流式 chunk / 连续 ops，`partial=true` |
| `idle` | 树已稳定（上一轮 `ui.done`），等待用户或下一轮 propose |
| `action_pending` | 已收到 `ui_report_action`，等待 harness 调用 `ui_patch` / 再答 / 明确 ack |
| `closing` | `ui_close` 已调用，正在刷事件 |
| `closed` | 终态；只读 `ui_get_state` 可短时保留 |
| `error` | 不可恢复错误；需 `ui_close` 或新 `ui_open` |

```
none → open → streaming ⇄ idle ⇄ action_pending
                 ↓           ↓
               error       error
                 ↓           ↓
              closing → closed
```

`streaming` → `idle`：条件为成功 `ui.done` 或 `chunkDone` 且 lint 通过。  
`idle` → `streaming`：新的 `ui_propose` / 大规模 `ui_patch`。  
`idle|streaming` → `action_pending`：`ui_report_action`。  
`action_pending` → `idle`：harness 完成 patch 后可选再发空 `ui.done`，或超时策略（见下）。  
任意非 `closed` → `closing` → `closed`：`ui_close`。

## 字段（服务端内存 + 旁路元数据）

```json
{
  "sessionId": "s_...",
  "status": "idle",
  "revision": 0,
  "tree": null,
  "state": {},
  "partial": false,
  "title": "",
  "density": "full",
  "preferPlainText": false,
  "createdAt": "...",
  "updatedAt": "...",
  "lastActionId": null,
  "lastError": null
}
```

## 转换表（工具 → 允许的源状态）

| Tool | 允许的 status | 成功后 status | 备注 |
|------|---------------|---------------|------|
| `ui_open` | `none` 或新 id；同 id 且非 closed → 拒绝或 `replaced` 关闭旧的 | `open` | 同 id 复用策略：默认拒绝 `SESSION_EXISTS` |
| `ui_propose` | `open`/`idle`/`action_pending`/`streaming`(续 chunk) | `streaming` 然后 `idle` | lint error 保持原 status |
| `ui_patch` | `idle`/`action_pending`/`streaming` | `idle` 或保持 `streaming` | |
| `ui_report_action` | `idle`/`streaming`/`action_pending` | `action_pending` | streaming 时允许，标记 interrupted? 否，只挂起 |
| `ui_get_state` | 除物理删除外 | 不变 | closed 仍可读直到 TTL |
| `ui_close` | 非 `none` | `closed` | |

## 错误态

- **可恢复**（`ui.error` `recoverable: true`）：坏 chunk、单次 lint fail → 停留原主状态，harness 可重试。
- **不可恢复**（`status=error`）：旁路目录不可写、内部不变量破坏 → 必须 `ui_close`。
- Tool 返回与事件双写：tool `ok:false` 时仍尽量发 `ui.error` 便于 Host 黄条。

## 并发规则

1. **单 session 串行写**：同一 `sessionId` 上 propose/patch/action/close 排队；① 可用进程内 mutex。
2. **多 session 并行**：允许。
3. Host 多订阅者：只读；写树只通过 MCP tools。
4. `action_pending` 超时（默认 120s，可配 `IUI_ACTION_TIMEOUT_MS`）：自动回 `idle`，保留 lastAction，发 warn 事件（可复用 `ui.error` recoverable）。
5. 新 `ui_propose` 在 `action_pending`：允许（视为 harness 用新 UI 响应 action），清除 pending。
6. `ui_open` 时若 Host 未启动：事件仍落盘；不阻塞 open。

## 与纯文字回退

若 `decision=plain_text`：不改 tree（或清空），`status→idle`，tool 返回 `plainText`；Host 可显示「本轮无 UI」占位。不强制 `ui_close`。

## TTL / 清理

- `closed` session 元数据与 ndjson 默认保留 24h（`IUI_SESSION_TTL_HOURS`）。
- 进程退出：尽量把进行中的标 `partial` 并 flush；不保证 crash-safe（① 不做 WAL）。

## ① 可简化

- 可合并 `open`+首次 propose 体验（仍发两事件）。
- 可无 `action_pending` 超时，仅文档约定 harness 必响应。
- 必须有：`open/idle/closed` + revision + 禁止对 closed 写。


## ③ 已实现（对照）

- [x] 状态：`open` / `streaming` / `idle` / `action_pending` / `closing` / `closed` / `error`
- [x] 同 session 串行 mutex（`runLocked`）
- [x] 禁止对 `closed`/`closing` 写
- [x] `action_pending` 超时：`IUI_ACTION_TIMEOUT_MS`（默认 120s）→ idle + recoverable `ui.error` `ACTION_TIMEOUT`
- [x] `ui_report_action` / actions.ndjson watch → `action_pending` + `lastActionId`
- [x] 新 `ui_propose`/`ui_patch` 在 `action_pending`：允许并清除 pending 计时
