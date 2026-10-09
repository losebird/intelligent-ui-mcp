# AUDIT P1 — Lightweight Motion

- **落地**：`packages/renderer-react` `NodeMotionShell` + `SkeletonPlaceholder` + CSS；`HostSurfaceView` 传 `streaming`/`motion`。
- **约束**：`key=node.id`；`prefers-reduced-motion`；文档声明非 Claude Motion。
- **冒烟**：`npm run motion-smoke` → `MOTION_SMOKE_OK`。
- **证据**：`/workspace/intelligent-ui-mcp-verify/motion-*`（帧序列 / reduced 对照）。
