# 自定义包 Manifest 与信任模型（G4 / ④）

## 目标

支持 **注册即渲染**：一份本地包同时提供 schema（给模型）与 renderer entry（给 Host），无需改 Host 源码手写映射——但必须落在信任边界内。

## 目录结构（local path）

```
my-gauge-pack/
  manifest.json          # 必填
  README.md              # 可选
  schemas/               # 可选：拆分 props schema
    Gauge.json
  dist/
    render.js            # 或 render.mjs / render.tsx 构建产物
```

开发期可用 TS 源码 entry，④ 要求 Host 能 `import()` 的格式（建议先强制 **已构建 ESM**）。

## `manifest.json` 规范

```json
{
  "$schema": "https://intelligent-ui-mcp.local/schemas/package-manifest-0.1.json",
  "id": "acme.gauges",
  "title": "Acme Gauges",
  "version": "0.1.0",
  "license": "MIT",
  "engines": {
    "intelligentUiMcp": ">=0.1.0 <0.2.0"
  },
  "renderer": {
    "entry": "./dist/render.js",
    "hash": "sha256-...",
    "exports": {
      "Gauge": "Gauge"
    }
  },
  "components": [
    {
      "name": "Gauge",
      "description": "半圆仪表盘，展示 0–max 数值",
      "propsSchema": {
        "type": "object",
        "required": ["value"],
        "properties": {
          "value": { "type": "number" },
          "max": { "type": "number", "default": 100 },
          "label": { "type": "string" }
        },
        "additionalProperties": false
      },
      "actions": ["change"],
      "enabledByDefault": true
    }
  ]
}
```

### 字段规则

| 字段 | 规则 |
|------|------|
| `id` | 小写点分；**禁止**以 `catalog.` 开头（保留给内置） |
| `renderer.entry` | 相对 manifest 目录；规范化后必须仍在包根下（防 `..`） |
| `renderer.hash` | 可选但 **`strictHash: true`（默认）时必填**；对 entry 文件字节做 sha256，格式 `sha256-<hex>` |
| `renderer.exports` | 组件 name → ESM export 名；缺省 export 名 = name |
| `components[].propsSchema` | 内联 JSON Schema draft-07 子集；或 `{ "$refFile": "./schemas/Gauge.json" }` |
| `components[].name` | PascalCase |

## 信任目录 Allowlist

Env：`IUI_TRUSTED_DIRS` = `:` 或 OS path sep 分隔的绝对路径列表。

**默认（①/④ 建议）**
- 仓库内 `.../intelligent-ui-mcp/packages`
- `.../intelligent-ui-mcp/examples/custom-packages`
- 用户 home 下 `~/.intelligent-ui-mcp/trusted`（需用户显式放入）

`register_package({ path })` 算法：
1. `realpath` 解析。
2. 若不在任一 trusted dir 前缀下 → `PATH_NOT_TRUSTED`。
3. 读 manifest；校验 id/version/components。
4. 解析 entry realpath，仍须在包根内。
5. 若 `strictHash`：算 hash，不匹配 → `HASH_MISMATCH`。
6. 记录到 registry；返回 `ok`。
7. Host 下次加载 session 或收到 `package.registered` 旁路通知时 `import(entry)`。

## Host 加载与失败降级

| 情况 | 行为 |
|------|------|
| import 抛错 | 该包 `renderStatus=failed`；相关 type → `catalog.base/Unknown`；黄条 |
| 缺 export | 该组件 Unknown；包其余组件仍可用 |
| hash 失败 | 整包不启用 |
| props 校验失败（运行时） | 节点级警告，尽量用 defaults 渲染 |

**永不**：`eval(modelString)`、执行 props 里的函数字符串、从 URL/npm 自动下载 entry。

## Renderer Entry 约定

```js
// dist/render.js  (ESM)
import React from 'react';

export function Gauge({ value, max = 100, label, onAction }) {
  // ... 纯展示 + 调用 onAction?.({ type: 'change', value })
  return /* React element */;
}

export default { Gauge };
```

- Props 与 schema 对齐；额外注入：`onAction`, `nodeId`, `sessionId`（Host 注入，不在 schema 声明）。
- 禁止在模块顶层做网络请求写磁盘（文档约定；④ 不做完整 OS 沙箱）。
- 可选增强（后）：iframe + postMessage 隔离。

## `register_component` 与包的关系

- 单组件注册必须落在**已 register 的 local 包**上，并对应 entry 中已有 export（或同次更新 entry——④ 要求重新 register_package 更简单）。
- v0.1 推荐：**只支持 register_package 整包**；`register_component` 作同包 schema 热更新（不换 entry）。

## 与内置 catalog

内置包不走 register；源码在 monorepo，随 MCP/Host 发布。自定义与内置 type 冲突 → register 失败 `TYPE_CONFLICT`。

## 验收（④）

- [x] trusted 内合法包 → `list_*` 可见 → propose `acme.gauges/Gauge` → snapshot 含 type（Host 经 `registry.json` + `/@fs` `import(entry)` 真渲染）
- [x] trusted 外 path → `PATH_NOT_TRUSTED`
- [x] 改字节 / 错 hash → `HASH_MISMATCH`；缺 hash + `strictHash` → `HASH_MISSING`
- [x] 坏 entry / 缺 export → Host Unknown 黄条降级，MCP 不崩溃
- [x] `npm run custom-smoke` → `CUSTOM_SMOKE_OK`

示例包：[`examples/custom-packages/acme-gauges/`](../examples/custom-packages/acme-gauges/)。

## 明确不做

- npm / url 包源（后开需另案：锁定、审计、镜像）。
- 模型生成 inline 组件源码并执行。
- 全局自动信任「任意 Downloads 路径」。
