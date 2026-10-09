# AUDIT P1 — Host iframe 交互回传对齐 + Data/Render 约定（2026-10-09）

## 做了什么

- 统一 action 信封：`normalizeRenderAction` / `normalizeSandboxAction` / Host `appendAction`（扁平 + `source`）
- Sandbox 协议：`action_ack`；child→parent 按 `requestId` 过滤；props 更新不重建 iframe
- Bootstrap：扁平化组件 `onAction`（防双重嵌套）
- UiRenderer：React key = `node.id`；`data-iui-node-id`
- Calculator：接受 `patch_props` 的 expression/result（Data 刷新不丢壳）
- MCP：`REMOUNT_RISK` warning；prompt + `docs/DATA-VS-RENDER.md`；action `note` 指向 ui_patch
- 冒烟：`npm run iframe-action-smoke`；CI 已挂

## 验收

```bash
npm run build && npm run iframe-action-smoke
```

期望输出含 `IFRAME_ACTION_SMOKE_OK`。
