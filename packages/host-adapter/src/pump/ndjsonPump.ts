/**
 * Interim NDJSON 泵：由调用方注入 readEvents（通常 Node 读 IUI_SESSION_DIR）。
 * 浏览器无法直读文件旁路；Webview PoC 请用 createHttpEventPump。
 */

import type { HostDensity, IntelligentUiHostSurface, UiProtocolEvent } from "../types.js";
import type { NdjsonPumpOptions } from "./types.js";

function asProtocolEvent(line: Record<string, unknown>): UiProtocolEvent | null {
  const type = String(line.type ?? "");
  if (
    !type.startsWith("ui.") ||
    ![
      "ui.open",
      "ui.delta",
      "ui.replace",
      "ui.done",
      "ui.error",
      "ui.action",
    ].includes(type)
  ) {
    return null;
  }
  return line as unknown as UiProtocolEvent;
}

export function createNdjsonEventPump(options: NdjsonPumpOptions) {
  const pollMs = options.pollMs ?? 150;
  const { sessionId, readEvents, readSnapshot } = options;

  return {
    kind: "ndjson_bypass" as const,
    start(surface: IntelligentUiHostSurface): () => void {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let eventsOffset = 0;
      let lastRevision = -1;

      surface.mount(sessionId);

      const tick = async () => {
        try {
          if (readSnapshot) {
            try {
              const s = await readSnapshot(sessionId);
              if (s && s.revision !== lastRevision) {
                lastRevision = s.revision;
                surface.setSnapshot?.(sessionId, {
                  revision: s.revision,
                  tree: s.tree as never,
                  state: s.state ?? {},
                  partial: s.partial,
                  title: s.title,
                  density: s.density as HostDensity | undefined,
                });
              }
            } catch {
              /* soft */
            }
          }

          const ev = await readEvents(sessionId, eventsOffset);
          for (const line of ev.lines) {
            const pe = asProtocolEvent(line);
            if (pe) surface.applyEvent(pe);
          }
          eventsOffset = ev.nextOffset;
        } finally {
          if (!cancelled) timer = setTimeout(tick, pollMs);
        }
      };

      void tick();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    },
  };
}
