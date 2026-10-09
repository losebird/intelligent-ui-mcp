/** Parse Host URL modes for full chrome vs iframe / side-panel embed / bare. */

export type HostMode = {
  /** Minimal chrome for iframe / Simple Browser beside chat */
  embed: boolean;
  /** No top bar / badges — bubble-flush (chrome=0|bare|none) */
  bare: boolean;
  /** When set, pin snapshot/events to this session instead of current.json latest */
  pinnedSessionId: string | undefined;
};

function isTruthyEmbed(raw: string): boolean {
  const v = raw.toLowerCase();
  return (
    v === "1" ||
    v === "true" ||
    v === "min" ||
    v === "minimal" ||
    v === "embed"
  );
}

function isBareChrome(params: URLSearchParams): boolean {
  const chrome = (params.get("chrome") ?? "").toLowerCase();
  const embed = (params.get("embed") ?? "").toLowerCase();
  return (
    chrome === "0" ||
    chrome === "bare" ||
    chrome === "none" ||
    chrome === "off" ||
    embed === "bare" ||
    embed === "0" ||
    params.get("bare") === "1" ||
    params.get("bare") === "true"
  );
}

export function parseHostMode(
  search: string = typeof window !== "undefined" ? window.location.search : "",
): HostMode {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const bare = isBareChrome(params);
  const embedRaw = (params.get("embed") ?? params.get("chrome") ?? "").toLowerCase();
  const embed = bare || isTruthyEmbed(embedRaw) || params.get("chrome") === "min";
  const pinned =
    params.get("sessionId")?.trim() ||
    params.get("sid")?.trim() ||
    undefined;
  return { embed, bare, pinnedSessionId: pinned || undefined };
}

export function buildEmbedUrl(
  hostBase: string,
  sessionId: string,
  opts?: { bare?: boolean; token?: string },
): string {
  const base = hostBase.replace(/\/$/, "");
  const q = new URLSearchParams(
    opts?.bare
      ? { embed: "1", chrome: "0", sessionId }
      : { embed: "1", sessionId },
  );
  if (opts?.token) q.set("token", opts.token);
  return `${base}/?${q.toString()}`;
}
