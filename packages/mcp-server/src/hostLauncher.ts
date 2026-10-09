/**
 * On ui_open: optionally spawn reference Host + open browser, always return
 * one-click URL (with token) + copy-paste launch instructions.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRepoRoot } from "./catalog/trusted.js";
import { defaultHostTokenPath, ensureHostToken } from "./hostAuth.js";
import {
  buildEmbedUrl,
  buildHostHint,
  buildOpenUrl,
  probeHostReady,
  resolveHostBaseUrl,
} from "./hostUrls.js";

function envFlag(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultOn;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(v)) return false;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  return defaultOn;
}

function spawnWaitMs(): number {
  const n = Number(process.env.IUI_HOST_SPAWN_WAIT_MS ?? "2800");
  if (!Number.isFinite(n) || n < 0) return 2800;
  return Math.min(n, 15_000);
}

function hostPidPath(): string {
  return (
    process.env.IUI_HOST_PID_FILE?.trim() ||
    path.join(os.homedir(), ".intelligent-ui-mcp", "host.pid")
  );
}

function hostSpawnLogPath(): string {
  return path.join(os.homedir(), ".intelligent-ui-mcp", "host-spawn.log");
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(): number | null {
  try {
    const raw = fs.readFileSync(hostPidPath(), "utf8").trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writePidFile(pid: number): void {
  const p = hostPidPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${pid}\n`, { encoding: "utf8", mode: 0o600 });
}

export function buildLaunchCmd(sessionDir: string): string {
  return `IUI_SESSION_DIR=${shellQuote(sessionDir)} npm run host`;
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Best-effort: spawn `npm run host` detached if no live Host / pid. */
export function trySpawnHost(opts: {
  sessionDir: string;
  token: string;
}): { started: boolean; pid?: number; reason: string; logFile?: string } {
  if (!envFlag("IUI_AUTO_HOST", true)) {
    return { started: false, reason: "IUI_AUTO_HOST=0" };
  }

  const existing = readPidFile();
  if (existing && isPidAlive(existing)) {
    return {
      started: false,
      pid: existing,
      reason: `host pid ${existing} still alive (${hostPidPath()})`,
    };
  }

  const root = resolveRepoRoot();
  const pkgJson = path.join(root, "package.json");
  if (!fs.existsSync(pkgJson)) {
    return { started: false, reason: `repo root missing package.json: ${root}` };
  }

  const logFile = hostSpawnLogPath();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  let outFd: number;
  try {
    outFd = fs.openSync(logFile, "a");
  } catch (e) {
    return {
      started: false,
      reason: `cannot open spawn log: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const env = {
    ...process.env,
    IUI_SESSION_DIR: opts.sessionDir,
    IUI_HOST_TOKEN: opts.token,
  };

  let child: ChildProcess;
  try {
    child = spawn("npm", ["run", "host", "--silent"], {
      cwd: root,
      env,
      detached: true,
      stdio: ["ignore", outFd, outFd],
    });
  } catch (e) {
    try {
      fs.closeSync(outFd);
    } catch {
      /* ignore */
    }
    return {
      started: false,
      reason: `spawn failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  try {
    fs.closeSync(outFd);
  } catch {
    /* ignore */
  }

  const pid = child.pid;
  child.unref();
  if (pid) writePidFile(pid);

  return {
    started: true,
    pid,
    reason: "spawned npm run host",
    logFile,
  };
}

/** Best-effort open system browser (xdg-open / open / cmd start). */
export function tryOpenBrowser(url: string): { opened: boolean; reason: string } {
  if (!envFlag("IUI_AUTO_OPEN_BROWSER", true)) {
    return { opened: false, reason: "IUI_AUTO_OPEN_BROWSER=0" };
  }

  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { opened: true, reason: `${cmd} ${args.join(" ")}` };
  } catch (e) {
    return {
      opened: false,
      reason: `open failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type HostEnsureResult = {
  hostUrl: string;
  embedUrl: string;
  openUrl: string;
  hostReady: boolean;
  hostStarted: boolean;
  browserOpened: boolean;
  launchCmd: string;
  hostHint: string;
  tokenFile: string;
  spawnReason?: string;
  browserReason?: string;
};

/**
 * Probe → optional spawn + wait → optional browser → always rich hostHint.
 * Never throws; spawn/browser failures become fields + hint text.
 */
export async function ensureHostOnUiOpen(opts: {
  sessionId: string;
  sessionDir: string;
}): Promise<HostEnsureResult> {
  const token = ensureHostToken();
  const tokenFile = defaultHostTokenPath();
  const hostUrl = resolveHostBaseUrl();
  const embedUrl = buildEmbedUrl(hostUrl, opts.sessionId);
  const openUrl = buildOpenUrl({
    hostUrl,
    sessionId: opts.sessionId,
    token,
    embed: false,
  });
  const launchCmd = buildLaunchCmd(opts.sessionDir);

  let hostReady = await probeHostReady(hostUrl);
  let hostStarted = false;
  let spawnReason: string | undefined;

  if (!hostReady) {
    const spawnRes = trySpawnHost({ sessionDir: opts.sessionDir, token });
    hostStarted = spawnRes.started;
    spawnReason = spawnRes.reason;
    if (spawnRes.started || spawnRes.pid) {
      const wait = spawnWaitMs();
      const deadline = Date.now() + wait;
      while (Date.now() < deadline) {
        await sleep(200);
        hostReady = await probeHostReady(hostUrl, 400);
        if (hostReady) break;
      }
    }
  }

  let browserOpened = false;
  let browserReason: string | undefined;
  // Open when ready, or still open URL so user sees connection state / retries.
  const openTarget = hostReady
    ? openUrl
    : buildOpenUrl({
        hostUrl,
        sessionId: opts.sessionId,
        token,
        embed: false,
      });
  if (envFlag("IUI_AUTO_OPEN_BROWSER", true)) {
    // Prefer opening only after ready to avoid a blank error tab; if still down,
    // open anyway so the one-click URL is exercised (user can refresh).
    const br = tryOpenBrowser(openTarget);
    browserOpened = br.opened;
    browserReason = br.reason;
  } else {
    browserReason = "IUI_AUTO_OPEN_BROWSER=0";
  }

  const hostHint = buildHostHint({
    hostUrl,
    embedUrl,
    openUrl,
    hostReady,
    sessionDir: opts.sessionDir,
    launchCmd,
    hostStarted,
    browserOpened,
    tokenFile,
    spawnReason,
  });

  return {
    hostUrl,
    embedUrl,
    openUrl,
    hostReady,
    hostStarted,
    browserOpened,
    launchCmd,
    hostHint,
    tokenFile,
    spawnReason,
    browserReason,
  };
}
