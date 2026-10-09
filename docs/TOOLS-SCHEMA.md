# MCP Tools — 字段级 JSON Schema 草案

> `protocolVersion`: `"0.1"`。所有 tool 的成功返回建议包一层：`{ "ok": true, "protocolVersion": "0.1", ... }`；失败：`{ "ok": false, "error": { "code": string, "message": string, "details"?: any } }`。
>
> 标注：**①** = 第一步必做；**②+** / **③** / **④** / **⑤** = 对应落地步；未标默认可随 ① 做只读桩。

共用类型（下文引用）：

```json
{
  "JSONValue": { "description": "null | boolean | number | string | array | object" },
  "NodeId": { "type": "string", "minLength": 1, "description": "会话内唯一，如 n_1 / root" },
  "PackageId": { "type": "string", "pattern": "^(catalog\\.[a-z0-9_-]+|[a-z][a-z0-9_-]*(\\.[a-z0-9_-]+)*)$" },
  "ComponentType": { "type": "string", "description": "PackageId + '/' + name，如 catalog.shadcn/Button" },
  "SessionId": { "type": "string", "minLength": 1 }
}
```

---

## 目录类

### `list_packages` ①

**作用**：列出已知包及启用状态。

**Input**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "includeDisabled": { "type": "boolean", "default": true },
    "includeSchemaOnly": { "type": "boolean", "default": true }
  }
}
```

**Output**
```json
{
  "type": "object",
  "required": ["ok", "packages"],
  "properties": {
    "ok": { "const": true },
    "protocolVersion": { "const": "0.1" },
    "packages": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "enabled", "renderStatus", "componentCount"],
        "properties": {
          "id": { "$ref": "#/PackageId" },
          "title": { "type": "string" },
          "version": { "type": "string" },
          "enabled": { "type": "boolean" },
          "renderStatus": { "enum": ["full", "schema_only", "failed"] },
          "componentCount": { "type": "integer", "minimum": 0 },
          "source": { "enum": ["builtin", "local"] }
        }
      }
    }
  }
}
```

---

### `list_components` ①

**Input**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "packageId": { "type": "string", "description": "省略则列出全部已启用包" },
    "enabledOnly": { "type": "boolean", "default": true },
    "query": { "type": "string", "description": "名称/描述子串过滤" }
  }
}
```

**Output**
```json
{
  "type": "object",
  "required": ["ok", "components"],
  "properties": {
    "ok": { "const": true },
    "components": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["type", "packageId", "name", "enabled"],
        "properties": {
          "type": { "type": "string" },
          "packageId": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "enabled": { "type": "boolean" },
          "renderStatus": { "enum": ["full", "schema_only", "failed"] },
          "propsSchemaRef": { "type": "string", "description": "可用 get_json_schema 拉取" },
          "actions": {
            "type": "array",
            "items": { "type": "string" },
            "description": "如 click, submit, change"
          }
        }
      }
    }
  }
}
```

---

### `set_enabled_packages` ①

**Input**
```json
{
  "type": "object",
  "required": ["packages"],
  "additionalProperties": false,
  "properties": {
    "packages": {
      "type": "object",
      "additionalProperties": { "type": "boolean" },
      "description": "map: packageId -> enabled。未出现的包保持原状。"
    },
    "replaceAll": {
      "type": "boolean",
      "default": false,
      "description": "true 时先全部禁用再按 map 启用"
    }
  }
}
```

**Output**：`{ ok, enabledPackageIds: string[] }`

**规则**：不可禁用 `catalog.base`（若尝试 → `ok: false`, code `BASE_REQUIRED`）。

---

### `set_enabled_components` ①

**Input**
```json
{
  "type": "object",
  "required": ["components"],
  "additionalProperties": false,
  "properties": {
    "components": {
      "type": "object",
      "additionalProperties": { "type": "boolean" },
      "description": "map: ComponentType -> enabled"
    }
  }
}
```

**Output**：`{ ok, enabledTypes: string[] }`（可只返回变更摘要 + total count，避免过大）

---

### `register_package` ④（① 可返回 NOT_IMPLEMENTED）

**Input**
```json
{
  "type": "object",
  "required": ["path"],
  "additionalProperties": false,
  "properties": {
    "path": {
      "type": "string",
      "description": "本地目录绝对路径或相对 cwd；内含 manifest.json"
    },
    "enable": { "type": "boolean", "default": true },
    "strictHash": { "type": "boolean", "default": true }
  }
}
```

**Output**：`{ ok, packageId, renderStatus, warnings?: string[] }`  
失败码：`PATH_NOT_TRUSTED` | `MANIFEST_INVALID` | `HASH_MISMATCH` | `RENDERER_LOAD_FAILED`

---

### `register_component` ④（单组件热挂；① 可 NOT_IMPLEMENTED）

**Input**
```json
{
  "type": "object",
  "required": ["packageId", "name", "propsSchema"],
  "additionalProperties": false,
  "properties": {
    "packageId": { "type": "string", "description": "已注册包，或临时包 id（须已存在目录）" },
    "name": { "type": "string", "pattern": "^[A-Z][A-Za-z0-9]*$" },
    "description": { "type": "string" },
    "propsSchema": { "type": "object", "description": "JSON Schema object" },
    "actions": { "type": "array", "items": { "type": "string" } },
    "rendererExport": {
      "type": "string",
      "description": "包 renderer.entry 中的具名导出，默认 = name"
    },
    "enable": { "type": "boolean", "default": true }
  }
}
```

**Output**：`{ ok, type: ComponentType }`

---

### `unregister` ④

**Input**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "packageId": { "type": "string" },
    "componentType": { "type": "string" }
  },
  "oneOf": [
    { "required": ["packageId"] },
    { "required": ["componentType"] }
  ]
}
```

**规则**：不可 unregister 内置 `catalog.*` 的包本身（可禁用）；自定义包可卸。

**Output**：`{ ok }`

---

### `get_prompt_fragment` ①

**作用**：给 harness/模型注入「如何选用 UI」的系统片断。

**Input**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "locale": { "type": "string", "default": "zh-CN" },
    "density": { "enum": ["full", "compact", "plain_prefer"], "default": "full" },
    "includeExamples": { "type": "boolean", "default": true },
    "maxChars": { "type": "integer", "default": 6000 }
  }
}
```

**Output**
```json
{
  "type": "object",
  "required": ["ok", "fragment", "enabledTypes"],
  "properties": {
    "ok": { "const": true },
    "fragment": { "type": "string" },
    "enabledTypes": { "type": "array", "items": { "type": "string" } },
    "policyNote": { "type": "string", "description": "⑤ 裁判开启时的说明" }
  }
}
```

---

### `get_json_schema` ①

**Input**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "componentType": { "type": "string", "description": "单个控件" },
    "scope": {
      "enum": ["component", "ui_tree", "ui_delta", "all_enabled"],
      "default": "component"
    }
  }
}
```

**规则**：`scope=component` 时必须 `componentType`；`all_enabled` 返回合并的 oneOf 树 schema（供 structured output）。

**Output**：`{ ok, schema: object }`

---

## 会话类

### `ui_open` ①

**Input**
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "sessionId": { "type": "string", "description": "省略则服务端生成" },
    "title": { "type": "string" },
    "initialState": { "type": "object", "additionalProperties": true },
    "preferPlainText": { "type": "boolean", "default": false },
    "density": { "enum": ["full", "compact", "plain_prefer"] },
    "meta": { "type": "object", "description": "harness 追踪字段，原样回显" }
  }
}
```

**Output**：`{ ok, sessionId, state, eventsPath?, protocolVersion }`  
副作用：发 `ui.open` 事件；创建旁路文件。

---

### `ui_propose` ①/③（① 整树；③ ops / streaming_chunks 已落地）

> **P0 默认**：对比 / 表格 / 多行列表 → `mode=ops` + `chunkDone:false` 分片（壳→表头→逐行→`chunkDone:true`）。禁止把「想完整树再一次 `mode=tree`」当地板演示。详见 [`STREAMING-UX-GAP.md`](./STREAMING-UX-GAP.md) / [`AUDIT-P0-OPS-DEFAULT.md`](./AUDIT-P0-OPS-DEFAULT.md)。

**Input**
```json
{
  "type": "object",
  "required": ["sessionId"],
  "additionalProperties": false,
  "properties": {
    "sessionId": { "type": "string" },
    "mode": {
      "enum": ["tree", "ops", "streaming_chunks"],
      "description": "省略时：有 ops[]→ops；有 chunk→streaming_chunks；否则 tree。对比/表/列表必须 ops 分片。tree=整树 replace（仅极小单次）；ops=增量+边画；streaming_chunks=JSONL 每行即 apply"
    },
    "tree": {
      "type": "object",
      "description": "根 UiNode；mode=tree 时必填。形状见 UI-DELTA-SCHEMA"
    },
    "ops": {
      "type": "array",
      "description": "mode=ops 时必填",
      "items": { "type": "object" }
    },
    "chunk": {
      "type": "string",
      "description": "mode=streaming_chunks 时：增量文本，拼成 JSON"
    },
    "chunkIndex": { "type": "integer", "minimum": 0 },
    "chunkDone": {
      "type": "boolean",
      "default": false,
      "description": "mode=ops：省略/false=保持 streaming（Host 已上屏该分片）；仅最后一次 true 完结。streaming_chunks：true 时 flush 遗留非 JSONL 缓冲"
    },
    "plainTextFallback": {
      "type": "string",
      "description": "若策略判定纯文字，可只传此字段且 tree 省略"
    },
    "runLint": { "type": "boolean", "default": true },
    "refresh": {
      "type": "boolean",
      "default": false,
      "description": "③ optional widget 续刷标记"
    },
    "targetNodeId": { "type": "string", "description": "refresh 时可选" }
  }
}
```

**Output**
```json
{
  "type": "object",
  "required": ["ok"],
  "properties": {
    "ok": { "type": "boolean" },
    "sessionId": { "type": "string" },
    "revision": { "type": "integer", "description": "树版本号，单调递增" },
    "warnings": { "type": "array", "items": { "type": "string" } },
    "lint": {
      "type": "object",
      "properties": {
        "passed": { "type": "boolean" },
        "issues": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "severity": { "enum": ["error", "warn"] },
              "code": { "type": "string" },
              "message": { "type": "string" },
              "nodeId": { "type": "string" }
            }
          }
        }
      }
    },
    "decision": {
      "enum": ["ui", "plain_text"],
      "description": "⑤ 或本地启发式"
    },
    "plainText": { "type": "string" }
  }
}
```

**Lint error** → `ok: false`，不更新树（warn 仍可更新）。

---

### `ui_patch` ①/③

**Input**
```json
{
  "type": "object",
  "required": ["sessionId", "ops"],
  "additionalProperties": false,
  "properties": {
    "sessionId": { "type": "string" },
    "ops": {
      "type": "array",
      "minItems": 1,
      "items": { "type": "object", "description": "同 ui.delta ops" }
    },
    "statePatch": {
      "type": "object",
      "description": "浅合并进 session.state；③"
    }
  }
}
```

**Output**：`{ ok, revision, state, warnings? }`

---

### `ui_close` ①

**Input**
```json
{
  "type": "object",
  "required": ["sessionId"],
  "properties": {
    "sessionId": { "type": "string" },
    "reason": { "enum": ["completed", "cancelled", "error", "replaced"], "default": "completed" }
  }
}
```

**Output**：`{ ok }` + 事件 `ui.done`（若尚未）与关闭标记。

---

### `ui_get_state` ①

**Input**
```json
{
  "type": "object",
  "required": ["sessionId"],
  "properties": {
    "sessionId": { "type": "string" },
    "includeTree": { "type": "boolean", "default": true },
    "includeState": { "type": "boolean", "default": true }
  }
}
```

**Output**：`{ ok, sessionId, status, revision, tree?, state?, partial? }`

---

### `ui_report_action` ①/③

**作用**：Host 或 harness 上报用户交互；MCP 记录并发 `ui.action` 事件。⑤：若存在 session `reducers` / 节点 `expr`，`state.set` 后 MCP 会求值并 `ui.delta` patch 衍生 props。

**Input**
```json
{
  "type": "object",
  "required": ["sessionId", "action"],
  "properties": {
    "sessionId": { "type": "string" },
    "action": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": {
          "type": "string",
          "description": "click | submit | change | state.set | custom.*"
        },
        "nodeId": { "type": "string" },
        "componentType": { "type": "string" },
        "value": {},
        "path": { "type": "string", "description": "state.set 时" },
        "payload": { "type": "object" },
        "ts": { "type": "string", "format": "date-time" }
      }
    },
    "applyState": {
      "type": "boolean",
      "default": true,
      "description": "type=state.set 时是否写入 session.state"
    }
  }
}
```

**Output**：`{ ok, actionId, state, note: "DATA tool next: prefer ui_patch…" }`  
> Action 后请走 **Data**（`ui_patch` / `patch_props` / `statePatch`），勿 `ui_propose`+`replace_tree` 重画（见 [`DATA-VS-RENDER.md`](./DATA-VS-RENDER.md)）。  
**Payload 限制**：序列化后 ≤ 32KB，否则 `PAYLOAD_TOO_LARGE`。

---


---

### `ui_drain_actions` ③

**作用**：轮询 Host `actions.ndjson`（若尚未被 watch 消费）并返回 pending actions；默认标记 drained，供 harness 取走后决定 `ui_patch`。

**Input**
```json
{
  "type": "object",
  "required": ["sessionId"],
  "properties": {
    "sessionId": { "type": "string" },
    "markDrained": { "type": "boolean", "default": true },
    "max": { "type": "integer", "default": 100 }
  }
}
```

**Output**：`{ ok, actions: [{ actionId, action, ts, source, drained }], status, lastActionId, count }`

---

### `ui_get_pending_actions` ③

同 `ui_drain_actions`，但 **不** 标记 drained（peek）。

---

## 实现分期小结

| Tool | ① | ③ | ④ | ⑤ |
|------|---|---|---|---|
| list_* / set_enabled_* / get_* | 必做 | | | |
| ui_open/close/get_state | 必做 | | | |
| ui_propose mode=tree | 必做 | | | |
| `ui_propose mode=ops/chunks` | 桩或 defer | **已做** | | |
| `ui_patch` | 最小 | **已做** | | |
| `ui_report_action` | 记账 | **已做**（+ drain/watch） | | |
| `ui_drain_actions` / `ui_get_pending_actions` | — | **已做**（③ A+B） | | |
| register_* / unregister | — | | **已做**（信任目录 + hash） | |
| lint / decision | 基础启发式 | | | **已做**（prompt+lint+可选裁判） |
| `policy_check` / `evaluate_expr` | — | | | **已做** |
| refresh | — | optional | | |



---

### `policy_check` ⑤

**作用**：设计判断裁判（plain_text vs ui）。默认关闭；`IUI_POLICY_ENABLED=1` 时走 `IUI_POLICY_ENDPOINT` 和/或 `IUI_POLICY_CMD`，失败降级 Phase A 启发式。

**Input**
```json
{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query": { "type": "string" },
    "treeSummary": { "type": "string" },
    "plainTextAlternative": { "type": "string" },
    "proposedTypes": { "type": "array", "items": { "type": "string" } }
  }
}
```

**Output**：`{ ok, decision: "plain_text"|"ui", score, reasons[], suggested_types[], source, enabled }`

---

### `evaluate_expr` ⑤

**作用**：安全表达式求值（数字、state 字段、`+ - * / ()`、`round|min|max|abs`）。拒绝任意 JS。

**Input**：`{ expr, state? }`  
**Output**：`{ ok, value }` 或 `ok:false` + `EXPR_*`。
