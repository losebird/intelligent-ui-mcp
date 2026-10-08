/** Parse Host URL modes for full chrome vs iframe / side-panel embed. */

export type HostMode = {
  /** Minimal chrome for iframe / Simple Browser beside chat */
  embed: boolean;
  /** When set, pin snapshot/events to this session instead of current.json latest */
  pinnedSessionId: string | undefined;
};

export function parseHostMode(
  search: string = typeof window !== "undefined" ? window.location.search : "",
): HostMode {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const embedRaw = (params.get("embed") ?? params.get("chrome") ?? "").toLowerCase();
  const embed =
    embedRaw === "1" ||
    embedRaw === "true" ||
    embedRaw === "min" ||
    embedRaw === "minimal" ||
    params.get("chrome") === "min";
  const pinned =
    params.get("sessionId")?.trim() ||
    params.get("sid")?.trim() ||
    undefined;
  return { embed, pinnedSessionId: pinned || undefined };
}

export function buildEmbedUrl(
  hostBase: string,
  sessionId: string,
): string {
  const base = hostBase.replace(/\/$/, "");
  const q = new URLSearchParams({ embed: "1", sessionId });
  return `${base}/?${q.toString()}`;
}
