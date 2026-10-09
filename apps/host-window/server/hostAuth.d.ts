export const HOST_TOKEN_HEADER: string;
export const HOST_TOKEN_QUERY: string;
export function defaultHostTokenPath(): string;
export function resolveHostToken(opts?: { ensure?: boolean }): string | null;
export function ensureHostToken(): string;
export function tokensEqual(a: string, b: string): boolean;
export function extractRequestToken(
  req: { headers?: Record<string, string | string[] | undefined> },
  url: URL,
): string | null;
export function isAllowedCorsOrigin(origin: string | undefined | null): boolean;
export function applyStrictCors(
  req: { headers?: Record<string, string | string[] | undefined> },
  res: { setHeader: (k: string, v: string) => void },
): boolean;
export function isPublicApiPath(pathname: string, method: string): boolean;
