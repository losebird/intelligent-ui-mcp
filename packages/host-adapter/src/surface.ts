/**
 * IntelligentUiHostSurface 默认实现：多 session 本地镜像 + 订阅通知。
 * 不负责传输；事件由 HostEventPump 或宿主产品通道喂入。
 */

import type { RenderAction, UiNode } from "@intelligent-ui/renderer-react";
import { applyOps, type UiOp } from "./applyOps.js";
import type {
  ActionHandler,
  HostDensity,
  IntelligentUiHostSurface,
  MountOptions,
  SessionMirror,
  SessionMirrorStatus,
  SessionSnapshotInput,
  UiProtocolEvent,
} from "./types.js";

export interface CreateSurfaceOptions {
  /** 默认密度 */
  defaultDensity?: HostDensity;
  /** applyOps 失败时是否保留旧树（默认 true） */
  keepTreeOnOpError?: boolean;
}

export interface HostSurface extends IntelligentUiHostSurface {
  /** 读镜像（未 mount 返回 null） */
  getMirror(sessionId: string): SessionMirror | null;
  /** 列出已 mount 的 sessionId */
  listSessions(): string[];
  /** useSyncExternalStore 友好订阅 */
  subscribe(listener: () => void): () => void;
  /** 触发渲染器用的 action（走 onAction handler） */
  dispatchAction(sessionId: string, action: RenderAction): void;
}

function emptyMirror(
  sessionId: string,
  opts?: MountOptions,
  defaultDensity: HostDensity = "full",
): SessionMirror {
  return {
    sessionId,
    title: opts?.title ?? "",
    density: opts?.density ?? defaultDensity,
    revision: 0,
    tree: null,
    state: {},
    partial: true,
    status: "mounted",
    lastError: null,
    lastActionId: null,
  };
}

export function createIntelligentUiHostSurface(
  options: CreateSurfaceOptions = {},
): HostSurface {
  const defaultDensity = options.defaultDensity ?? "full";
  const keepTreeOnOpError = options.keepTreeOnOpError !== false;

  const mirrors = new Map<string, SessionMirror>();
  const listeners = new Set<() => void>();
  let actionHandler: ActionHandler | null = null;

  const notify = () => {
    for (const l of listeners) {
      try {
        l();
      } catch {
        /* listener 不得拖垮 surface */
      }
    }
  };

  const ensure = (sessionId: string, opts?: MountOptions): SessionMirror => {
    let m = mirrors.get(sessionId);
    if (!m) {
      m = emptyMirror(sessionId, opts, defaultDensity);
      mirrors.set(sessionId, m);
    } else if (opts) {
      if (opts.title !== undefined) m.title = opts.title;
      if (opts.density !== undefined) m.density = opts.density;
    }
    return m;
  };

  const setStatus = (m: SessionMirror, status: SessionMirrorStatus) => {
    m.status = status;
  };

  const surface: HostSurface = {
    mount(sessionId: string, opts?: MountOptions): void {
      if (!sessionId) throw new Error("mount: sessionId required");
      const existing = mirrors.get(sessionId);
      if (existing && existing.status !== "unmounted") {
        if (opts?.title !== undefined) existing.title = opts.title;
        if (opts?.density !== undefined) existing.density = opts.density;
        notify();
        return;
      }
      mirrors.set(sessionId, emptyMirror(sessionId, opts, defaultDensity));
      notify();
    },

    applyEvent(event: UiProtocolEvent): void {
      if (!event || typeof event !== "object" || !("type" in event)) return;
      const sessionId = (event as { sessionId?: string }).sessionId;
      if (!sessionId) return;

      // 未 mount 时自动占位（兼容泵先于 open 到达）
      const m = ensure(sessionId);
      if (m.status === "unmounted") {
        m.status = "mounted";
        m.partial = true;
      }

      switch (event.type) {
        case "ui.open": {
          if (event.title) m.title = event.title;
          if (event.state && typeof event.state === "object") {
            m.state = { ...event.state };
          }
          m.partial = true;
          setStatus(m, "streaming");
          m.lastError = null;
          break;
        }
        case "ui.replace": {
          if (typeof event.revision === "number" && event.revision < m.revision) {
            // 更旧 revision 丢弃
            return;
          }
          m.revision = event.revision;
          m.tree = (event.tree ?? null) as UiNode | null;
          m.partial = event.partial !== false;
          if (event.state && typeof event.state === "object") {
            m.state = { ...event.state };
          }
          setStatus(m, m.partial ? "streaming" : "idle");
          m.lastError = null;
          break;
        }
        case "ui.delta": {
          if (typeof event.revision === "number" && event.revision < m.revision) {
            return;
          }
          const ops = (Array.isArray(event.ops) ? event.ops : []) as UiOp[];
          const result = applyOps(m.tree, ops);
          if (!result.ok) {
            m.lastError = {
              code: result.code,
              message: result.message,
              recoverable: true,
            };
            if (!keepTreeOnOpError) {
              /* 保留旧树：默认行为 */
            }
            setStatus(m, "error");
            break;
          }
          m.tree = result.tree;
          m.revision = event.revision;
          m.partial = event.partial !== false;
          if (event.state && typeof event.state === "object") {
            m.state = { ...event.state };
          }
          setStatus(m, m.partial ? "streaming" : "idle");
          m.lastError = null;
          break;
        }
        case "ui.done": {
          if (typeof event.revision === "number" && event.revision >= m.revision) {
            m.revision = event.revision;
          }
          m.partial = false;
          setStatus(m, "done");
          break;
        }
        case "ui.error": {
          m.lastError = {
            code: event.code,
            message: event.message,
            recoverable: event.recoverable,
          };
          setStatus(m, "error");
          if (!event.recoverable) {
            // 不拆 session；仅标错（契约：recoverable 时勿拆）
          }
          break;
        }
        case "ui.action": {
          m.lastActionId = event.actionId;
          // 镜像不改树；日志由宿主 chrome 处理
          break;
        }
        default:
          break;
      }
      notify();
    },

    setSnapshot(sessionId: string, snapshot: SessionSnapshotInput): void {
      if (!sessionId) return;
      const m = ensure(sessionId);
      if (m.status === "unmounted") {
        m.status = "mounted";
      }
      if (typeof snapshot.revision === "number" && snapshot.revision < m.revision) {
        // 允许强制重连：若调用方明确要覆盖，仍可传更高或相等；更旧则丢
        return;
      }
      m.revision = snapshot.revision;
      m.tree = snapshot.tree;
      m.state = snapshot.state ?? {};
      m.partial = snapshot.partial === true;
      if (snapshot.title !== undefined) m.title = snapshot.title;
      if (snapshot.density) m.density = snapshot.density;
      if (snapshot.partial) setStatus(m, "streaming");
      else if (snapshot.status === "closed") setStatus(m, "done");
      else setStatus(m, "idle");
      m.lastError = null;
      notify();
    },

    onAction(handler: ActionHandler): void {
      actionHandler = handler;
    },

    unmount(sessionId: string): void {
      const m = mirrors.get(sessionId);
      if (!m) return;
      m.status = "unmounted";
      m.tree = null;
      mirrors.delete(sessionId);
      notify();
    },

    getMirror(sessionId: string): SessionMirror | null {
      return mirrors.get(sessionId) ?? null;
    },

    listSessions(): string[] {
      return [...mirrors.keys()];
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispatchAction(sessionId: string, action: RenderAction): void {
      if (actionHandler) actionHandler(action, sessionId);
    },
  };

  return surface;
}
