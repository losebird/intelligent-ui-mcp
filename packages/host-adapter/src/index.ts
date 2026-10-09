/**
 * @intelligent-ui/host-adapter
 *
 * 选项 A：宿主嵌 renderer 的最小 SDK。
 * - IntelligentUiHostSurface：mount / applyEvent / onAction / unmount
 * - interim 泵：SSE（优先）/ HTTP 轮询回退 / NDJSON（Node 注入）
 * - 产品气泡通道：类型占位，宿主自有（非本包实现）
 */

export type {
  ActionHandler,
  HostDensity,
  HostEventPump,
  IntelligentUiHostSurface,
  MountOptions,
  ProductBubbleChannel,
  SessionMirror,
  SessionMirrorStatus,
  SessionSnapshotInput,
  UiProtocolEvent,
} from "./types.js";

export type { UiNode, RenderAction, ComponentRenderer } from "./types.js";

export {
  createIntelligentUiHostSurface,
  type CreateSurfaceOptions,
  type HostSurface,
} from "./surface.js";

export { applyOps, collectNodes, type UiOp, type ApplyOpsResult } from "./applyOps.js";

export { createHttpEventPump } from "./pump/httpPump.js";
export { createNdjsonEventPump } from "./pump/ndjsonPump.js";
export {
  createSseEventPump,
  createHostEventPump,
} from "./pump/ssePump.js";
export type {
  HttpPumpOptions,
  NdjsonPumpOptions,
  HttpPumpCurrentInfo,
  SsePumpOptions,
  HostPumpTransport,
} from "./pump/types.js";

/**
 * 产品气泡通道 stub：提醒宿主实现等价 HostEventPump。
 * 调用 start 会抛错，避免误当已接线。
 */
export function createProductBubbleChannelStub(): import("./types.js").ProductBubbleChannel {
  return {
    kind: "product_bubble",
    start() {
      throw new Error(
        "[host-adapter] ProductBubbleChannel 由宿主产品实现（Cursor/Grok IPC/SSE）。" +
          "PoC 请用 createHostEventPump（SSE）/ createHttpEventPump / createNdjsonEventPump。见 docs/HOST-ADAPTER-M0-CHECKLIST.md",
      );
    },
  };
}

// React 视图：从 "@intelligent-ui/host-adapter/react" 引入，避免非 React 宿主强依赖。
// 此处再 export 类型名方便文档；实现见 ./react/HostSurfaceView.js
export type { HostSurfaceViewProps } from "./react/HostSurfaceView.js";
