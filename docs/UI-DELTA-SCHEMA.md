# `ui.*` 事件与 Node / Delta Schema

> Host 与 MCP 共守。旁路默认 NDJSON：每行一个事件对象。`protocolVersion: "0.1"`。

## 事件类型一览

| type | 何时 | 必有字段 |
|------|------|----------|
| `ui.open` | `ui_open` 成功 | `sessionId`, `title?`, `state`, `ts` |
| `ui.delta` | 增量 ops 应用后 | `sessionId`, `revision`, `ops`, `partial` |
| `ui.replace` | 整树替换（① 主路径） | `sessionId`, `revision`, `tree`, `partial` |
| `ui.done` | 本轮生成结束或 session 正常收尾 | `sessionId`, `revision`, `reason?` |
| `ui.error` | 校验/内部失败 | `sessionId`, `code`, `message`, `recoverable` |
| `ui.action` | `ui_report_action` 后广播 | `sessionId`, `actionId`, `action` |

公共信封：

```json
{
  "protocolVersion": "0.1",
  "type": "ui.delta",
  "sessionId": "s_...",
  "ts": "2026-10-08T12:00:00.000+08:00",
  "revision": 3,
  "partial": false
}
```

`revision`：每次成功改树 +1；Host 若收到更旧 revision 可丢弃。  
`partial`：流式未完成时为 `true`。

---

## UiNode 形状

```json
{
  "type": "object",
  "required": ["id", "type"],
  "properties": {
    "id": { "type": "string" },
    "type": {
      "type": "string",
      "description": "ComponentType，如 catalog.base/Stack 或 catalog.shadcn/Button"
    },
    "props": {
      "type": "object",
      "description": "符合该控件 propsSchema；禁止键名以 __ 开头"
    },
    "children": {
      "type": "array",
      "items": { "$ref": "#/UiNode" }
    },
    "bind": {
      "type": "string",
      "description": "绑定 session.state 路径，如 tipPercent 或 lineItems.0.amount"
    },
    "actions": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "actionType": { "type": "string" },
          "payload": { "type": "object" }
        }
      },
      "description": "如 { \"onClick\": { \"actionType\": \"click\" } }"
    },
    "key": { "type": "string", "description": "列表调和可选" },
    "meta": { "type": "object" }
  },
  "additionalProperties": false
}
```

**规则**
- `type` 必须在**当前启用**目录中；否则事件变 `ui.error` code `UNKNOWN_TYPE`。
- 根节点建议 `id: "root"`；`ui_open` 后空树可为 `null`。
- 不允许 `props.children` 与 `children` 混用（children 只用数组字段）。
- 字符串 props 不作代码执行；无 `dangerouslySetInnerHTML` 等价物。

示例：

```json
{
  "id": "root",
  "type": "catalog.base/Stack",
  "props": { "direction": "vertical", "gap": 12 },
  "children": [
    {
      "id": "t1",
      "type": "catalog.base/Markdown",
      "props": { "text": "## 账单分摊" }
    },
    {
      "id": "tip",
      "type": "catalog.shadcn/Slider",
      "props": { "min": 0, "max": 30, "label": "小费 %" },
      "bind": "tipPercent",
      "actions": { "onChange": { "actionType": "state.set", "payload": { "path": "tipPercent" } } }
    },
    {
      "id": "total",
      "type": "catalog.shadcn/Badge",
      "props": { "text": "合计 ¥0" }
    }
  ]
}
```

---

## `ui.delta` 的 `ops`

```json
{
  "type": "object",
  "required": ["op"],
  "properties": {
    "op": {
      "enum": [
        "upsert",
        "patch_props",
        "remove",
        "append_child",
        "replace_children",
        "move",
        "set_bind",
        "replace_tree"
      ]
    },
    "nodeId": { "type": "string", "description": "目标节点；upsert 时为新/旧 id" },
    "parentId": { "type": "string", "description": "append_child / upsert 挂载点" },
    "index": { "type": "integer", "minimum": 0 },
    "node": { "$ref": "#/UiNode", "description": "upsert 时完整或部分节点" },
    "props": { "type": "object", "description": "patch_props 浅合并" },
    "path": { "type": "string", "description": "set_bind" },
    "fromIndex": { "type": "integer" },
    "toIndex": { "type": "integer" }
  }
}
```

### 各 op 语义

| op | 语义 |
|----|------|
| `upsert` | 若 `nodeId` 存在则替换该节点（保留 id）；否则挂到 `parentId` 的 `index`（默认末尾） |
| `patch_props` | 浅合并 `props`；`null` 值表示删除该 prop 键 |
| `remove` | 删除 `nodeId` 及其子树 |
| `append_child` | 将 `node` 追加到 `parentId` |
| `replace_children` | 用 `node.children` 或并列字段 `children` 整换子列表 |
| `move` | 同父下 `fromIndex` → `toIndex` |
| `set_bind` | 设置/清空 `bind`（`path: null` 清空） |
| `replace_tree` | ③ 便利算子：用 `tree`/`node` 整换根（等价清空后挂新根） |

应用失败（父不存在等）→ 整批 ops 原子失败（③ 推荐事务：全成或全否）并发 `ui.error`；① 可简化为 best-effort + warnings。

---

## `ui.replace`

整树替换，等价于清空后 upsert root。① 主路径用这个即可。

```json
{
  "type": "ui.replace",
  "sessionId": "s_1",
  "revision": 1,
  "partial": false,
  "tree": { "id": "root", "type": "catalog.base/Stack", "props": {}, "children": [] }
}
```

`tree: null` 表示清空画布（仍保持 session）。

---

## 流式规则

1. **①**：harness 凑齐完整 tree → 一次 `ui.replace` → `ui.done`。
2. **③ `mode=ops`**：模型/编译器直接产出 ops 数组，分多次 `ui_propose`/`ui_patch`，每次发 `ui.delta`，最后 `chunkDone`/`ui.done`。
3. **③ `streaming_chunks`**：
   - 服务端缓冲 chunk，尝试 partial JSON parse；
   - 每当解析出新的完整子节点，发 `upsert`；
   - 根 props 可先发骨架（`catalog.base/Stack` 空 children）；
   - 解析失败且 `chunkDone=true` → `ui.error` `PARSE_FAILED`，保留 partial 树。
4. Host 渲染：未知 type → `catalog.base/Unknown`；缺 props 用控件 default。
5. 乱序：忽略 `revision <= lastApplied`；缺口不补（不请求重传，靠 `ui_get_state` 全量纠偏）。
6. 旁路文件：`{IUI_SESSION_DIR}/{sessionId}.ndjson` append-only；Host 可用 offset/inode 追踪。

---

## `ui.action` 载荷

```json
{
  "type": "ui.action",
  "sessionId": "s_1",
  "actionId": "a_01H...",
  "action": {
    "type": "state.set",
    "nodeId": "tip",
    "path": "tipPercent",
    "value": 15,
    "componentType": "catalog.shadcn/Slider"
  }
}
```

Host 与 harness 都可订阅；通常 **harness 侧**决定是否再调 `ui_patch`。

---

## 明确不做

- 事件里携带可执行脚本或 HTML 字符串当控件实现。
- 二进制私有控件格式。
- 与 OpenAI 闭源 GenUI 消息类型字节兼容。
