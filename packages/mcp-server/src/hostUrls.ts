/** Host / embed URL helpers returned by ui_open (P1 co-locate). */

export function resolveHostBaseUrl(): string {
  return (process.env.IUI_HOST_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
}

export function buildEmbedUrl(hostBase: string, sessionId: string): string {
  const base = hostBase.replace(/\/$/, "");
  const q = new URLSearchParams({ embed: "1", sessionId });
  return `${base}/?${q.toString()}`;
}

export function buildHostHint(opts: {
  hostUrl: string;
  embedUrl: string;
  hostReady: boolean;
  sessionDir: string;
}): string {
  const { hostUrl, embedUrl, hostReady, sessionDir } = opts;
  if (hostReady) {
    return (
      `Host ready. Beside chat: open embedUrl in Simple Browser / side panel / iframe → ${embedUrl}. ` +
      `Full chrome → ${hostUrl}. IUI_SESSION_DIR=${sessionDir} must match MCP. ` +
      `Do not block on desktop screenshots.`
    );
  }
  return (
    `Host not reachable at ${hostUrl}. Start: IUI_SESSION_DIR=${sessionDir} npm run host ` +
    `then open embed beside chat → ${embedUrl} (or full → ${hostUrl}).`
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
