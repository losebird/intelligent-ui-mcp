# AUDIT P0 — 边输出边画默认（ops streaming default）

日期：2026-10-09  
分支：`feat/ops-streaming-default`  
战略：继续私有 `ui.*` + 各宿主插件；**不做** MCP Apps 迁移。

## 目标

把「边输出边画」做成默认路径，消灭「想完整树再一次 `mode=tree` propose」作为地板演示。

## 变更

| 区域 | 改动 |
|------|------|
| `ui_propose` 工具描述 | 明确对比/表/列表默认 `mode=ops` 分片顺序 |
| mode 推断 | 省略 mode：有 `ops[]`→ops；有 `chunk`→streaming_chunks；否则 tree |
| `chunkDone` | **ops 路径**：省略/`false` → 保持 `streaming`+`partial`（Host 已上屏）；仅 `true` 完结 |
| `get_prompt_fragment` | v`0.2.0-ops-default`；示例改为手机对比分片；极小表单才给 tree 例 |
| `live-demo` | 改为 shell→card→chart 三次 ops |
| `stream-phone-compare` | 增加 Host SSE `ui.delta` + HTTP `/api/snapshot` 分片行数断言 |
| CI | 跑 `npm run stream-phone-compare` |

## 验收

```bash
npm run build
npm run stream-smoke
npm run stream-phone-compare
npm run smoke
npm run live-demo   # 可选
```

期望：`stream-phone-compare` 打印 `SSE+Host progressive OK`，行数 0→1→2→3，SSE ≥4 个不同 `ui.delta` revision。

## 非目标

- 不迁移 MCP Apps / `ui://`
- 不解决产品气泡原生挂载（仍靠 dsh toolview / 旁路 Host）
