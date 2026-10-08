import type { HostEventPump, IntelligentUiHostSurface } from "../types.js";

export type { HostEventPump, IntelligentUiHostSurface };

/** /api/current 指针（chrome 用） */
export interface HttpPumpCurrentInfo {
  sessionDir?: string;
  current: {
    latestSessionId: string;
    revision: number | null;
    updatedAt?: string;
  } | null;
  /** 本 tick 实际跟随的 session（pinned 或 latest） */
  activeSessionId: string | null;
}

export interface HttpPumpOptions {
  /** Host 窗 origin，如 http://127.0.0.1:5173；空则用相对 /api */
  baseUrl?: string;
  /** 轮询间隔 ms，默认 150（与 host-window 对齐） */
  pollMs?: number;
  /** 固定 session；省略则跟 /api/current */
  sessionId?: string;
  /** 是否在 revision 变化时用 snapshot 校正镜像（推荐 true） */
  syncSnapshot?: boolean;
  /** 可选：把 POST /api/action 接到 surface.onAction（含 actionId） */
  wireActions?: boolean;
  /**
   * /api/current 连续失败若干次后才 onPollError（默认 3，对齐 host-window 韧性）。
   * 设为 1 则每次失败立即回调。
   */
  stickyFails?: number;
  /** 失败退避上限 ms，默认 2000 */
  backoffMaxMs?: number;
  /** 每次成功读到 current 后（含无 session） */
  onCurrent?: (info: HttpPumpCurrentInfo) => void;
  /** 每条协议事件行（已 apply 到 surface 之前；日志 chrome 用） */
  onEvent?: (line: Record<string, unknown>) => void;
  /** /api/current 连续失败达 stickyFails */
  onPollError?: (err: unknown) => void;
  /** /api/current 成功（清除 sticky 红条） */
  onPollOk?: () => void;
}

export interface NdjsonPumpOptions {
  /**
   * 读 NDJSON 行的函数（Node/PoC 注入 fs；浏览器不可直接读 IUI_SESSION_DIR）。
   * 返回自 since 起的新行与 nextOffset。
   */
  readEvents: (
    sessionId: string,
    since: number,
  ) => Promise<{ lines: Array<Record<string, unknown>>; nextOffset: number }>;
  /** 可选：读 snapshot 校正 */
  readSnapshot?: (sessionId: string) => Promise<{
    revision: number;
    tree: unknown;
    state: Record<string, unknown>;
    partial?: boolean;
    title?: string;
    density?: string;
  } | null>;
  sessionId: string;
  pollMs?: number;
}
