# acme.gauges — 自定义包示例（④）

半圆 `Gauge`：schema + ESM renderer，落在默认信任目录 `examples/custom-packages/`。

## 注册

```bash
# MCP tool
register_package({
  "path": "/ABS/intelligent-ui-mcp/examples/custom-packages/acme-gauges",
  "enable": true,
  "strictHash": true
})
```

成功后 `list_packages` / `list_components` 可见 `acme.gauges/Gauge`；Host 读 `IUI_SESSION_DIR/registry.json` 后 `import(entry)`。

## 计算 hash

对 **entry 文件字节**做 sha256，写入 `manifest.json` → `renderer.hash`：

```bash
printf 'sha256-%s\n' "$(sha256sum dist/render.js | awk '{print $1}')"
# 或：node -e "..."（见仓库 scripts / custom-smoke）
```

改 `dist/render.js` 后必须更新 hash，否则 `strictHash: true`（默认）→ `HASH_MISMATCH`。

## 约定

- 仅 local path；永不 eval 模型 JS；无 npm/url。
- Props 对齐 schema；Host 额外注入 `onAction` / `nodeId` / `sessionId`。
