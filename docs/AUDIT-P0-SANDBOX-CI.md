# AUDIT P0 — 自定义包 iframe 沙箱 + 最小 CI（2026-10-09）

## 已修

### 自定义包沙箱
- Host 对 **自定义 / 不可信 package** 默认在 **opaque-origin iframe** 中加载（`sandbox="allow-scripts"`，**不开** same-origin）。
- 受信 bootstrap（`apps/host-window/src/sandbox/bootstrapSrcdoc.ts`）经 `srcdoc` 注入；React UMD 与 entry 源码由 parent `postMessage` 下发。
- 协议：`iui.sandbox.v1`（`protocol.ts`）；parent 校验 `event.source === iframe.contentWindow`。
- iframe CSP：`connect-src 'none'`（禁 fetch/XHR/WS）、`default-src 'none'`、仅 `script-src 'unsafe-inline' blob:`。
- Entry 经鉴权 API `GET /api/package-entry/:packageId` 读取（须已 register，且 realpath 落在包根内）；**不把 Host token 传进 iframe**。
- **builtin** `catalog.*` 仍走 `renderer-react` 主进程路径。
- 不安全逃生舱：`IUI_CUSTOM_PACKAGE_MAIN_WORLD=1` → 恢复 Vite `/@fs` 同页 `import()`（文档标明危险）。

### CI
- `.github/workflows/ci.yml`：`npm ci` → `build` → `smoke` / `host-smoke` / `stream-smoke` / `custom-smoke` / `sandbox-smoke` / `eval:validate`
- CI 设 `IUI_HOST_TOKEN` 以便鉴权冒烟稳定。

### 冒烟
- `npm run sandbox-smoke` → `SANDBOX_SMOKE_OK`
