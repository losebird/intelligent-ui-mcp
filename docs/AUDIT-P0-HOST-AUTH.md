# AUDIT P0 — Host API 鉴权轮（2026-10-09）

详见仓库外 `/workspace/intelligent-ui-mcp-AUDIT.md` §9；本文件随 PR 留档。

## 已修

- Host API：`IUI_HOST_TOKEN`（env 或 `~/.intelligent-ui-mcp/host-token`）
- 除 `GET /api/health` 外无 token → 401
- CORS：仅 loopback；禁反射任意 Origin → 403
- actionId 幂等：JSON.parse 行 + 内存 Set
- `npm run host-smoke` 覆盖有 token / 无 token / CORS
