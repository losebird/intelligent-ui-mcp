export function resolveSessionDir(override?: string): string;
export function readJsonFile(filePath: string, fallback?: unknown): unknown;
export function readNdjson(
  filePath: string,
  since?: number,
): { lines: unknown[]; nextOffset: number; totalLines: number };
export function currentPath(dir: string): string;
export function snapshotPath(dir: string, sessionId: string): string;
export function eventsPath(dir: string, sessionId: string): string;
export function actionsPath(dir: string, sessionId: string): string;
export function appendAction(
  dir: string,
  body: Record<string, unknown>,
): { ok: true; actionId: string; duplicate?: boolean } | { ok: false; error: string };
export function createSessionMiddleware(
  sessionDir?: string,
): (req: unknown, res: unknown, next: () => void) => Promise<void>;
export function startSessionApiServer(opts?: {
  sessionDir?: string;
  port?: number;
}): Promise<{
  server: unknown;
  port: number;
  sessionDir: string;
  close: () => Promise<void>;
}>;
