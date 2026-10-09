/** Host / embed URL helpers returned by ui_open (P1 co-locate + auto-launch). */

export function resolveHostBaseUrl(): string {
  return (process.env.IUI_HOST_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
}

export function buildEmbedUrl(hostBase: string, sessionId: string): string {
  const base = hostBase.replace(/\/$/, "");
  const q = new URLSearchParams({ embed: "1", sessionId });
  return `${base}/?${q.toString()}`;
}

/** One-click Host URL with session + token query (Host already accepts ?token=). */
export function buildOpenUrl(opts: {
  hostUrl: string;
  sessionId: string;
  token: string;
  embed?: boolean;
}): string {
  const base = opts.hostUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ sessionId: opts.sessionId });
  if (opts.embed) q.set("embed", "1");
  if (opts.token) q.set("token", opts.token);
  return `${base}/?${q.toString()}`;
}

export function buildHostHint(opts: {
  hostUrl: string;
  embedUrl: string;
  openUrl?: string;
  hostReady: boolean;
  sessionDir: string;
  launchCmd?: string;
  hostStarted?: boolean;
  browserOpened?: boolean;
  tokenFile?: string;
  spawnReason?: string;
}): string {
  const {
    hostUrl,
    embedUrl,
    openUrl,
    hostReady,
    sessionDir,
    launchCmd,
    hostStarted,
    browserOpened,
    tokenFile,
    spawnReason,
  } = opts;

  const oneClick = openUrl ?? hostUrl;
  const cmd =
    launchCmd ??
    `IUI_SESSION_DIR=${sessionDir} npm run host`;
  const tokenNote = tokenFile
    ? `Token file: ${tokenFile} (or IUI_HOST_TOKEN). MCP + Host must share it.`
    : `Host API auth: set the same IUI_HOST_TOKEN (or share ~/.intelligent-ui-mcp/host-token) for MCP + Host.`;

  const autoBits: string[] = [];
  if (hostStarted) autoBits.push("auto-spawned Host (IUI_AUTO_HOST)");
  if (browserOpened) autoBits.push("opened browser (IUI_AUTO_OPEN_BROWSER)");
  if (spawnReason && !hostStarted) autoBits.push(`spawn: ${spawnReason}`);
  const auto =
    autoBits.length > 0 ? ` Auto: ${autoBits.join("; ")}.` : "";

  if (hostReady) {
    return (
      `Host ready.${auto} One-click → ${oneClick}. ` +
      `Beside chat (embed) → ${embedUrl}. Full chrome → ${hostUrl}. ` +
      `IUI_SESSION_DIR=${sessionDir} must match MCP. ${tokenNote} ` +
      `Disable auto: IUI_AUTO_HOST=0 IUI_AUTO_OPEN_BROWSER=0. Do not block on desktop screenshots.`
    );
  }

  return (
    `Host not reachable at ${hostUrl}.${auto} ` +
    `Start: ${cmd} ` +
    `then one-click → ${oneClick} (or embed → ${embedUrl}). ` +
    `${tokenNote} ` +
    `ui_open will auto-spawn + open browser when IUI_AUTO_HOST / IUI_AUTO_OPEN_BROWSER are on (default).`
  );
}

/** Short non-blocking probe so ui_open can tell the harness whether to start Host. */
export async function probeHostReady(
  hostUrl: string,
  timeoutMs = 350,
): Promise<boolean> {
  try {
    const base = hostUrl.replace(/\/$/, "");
    const url = `${base}/api/health`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}
