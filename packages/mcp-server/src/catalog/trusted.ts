import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve monorepo root from bundled dist/index.js → ../../../ */
export function resolveRepoRoot(): string {
  const fromEnv = process.env.IUI_REPO_ROOT;
  if (fromEnv && fromEnv.trim()) {
    return path.resolve(fromEnv.trim());
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../.."), // packages/mcp-server/dist → repo
    path.resolve(here, "../.."),
    process.cwd(),
  ];
  for (const c of candidates) {
    const pkgJson = path.join(c, "package.json");
    if (!fs.existsSync(pkgJson)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as { name?: string };
      if (pkg.name === "intelligent-ui-mcp") return c;
    } catch {
      /* continue */
    }
  }
  return path.resolve(here, "../../..");
}

export function defaultTrustedDirs(repoRoot?: string): string[] {
  const root = repoRoot ?? resolveRepoRoot();
  return [
    path.join(root, "packages"),
    path.join(root, "examples", "custom-packages"),
    path.join(os.homedir(), ".intelligent-ui-mcp", "trusted"),
  ];
}

/**
 * Defaults always included; IUI_TRUSTED_DIRS (':' or path.delimiter) appends more absolute paths.
 */
export function getTrustedDirs(repoRoot?: string): string[] {
  const dirs = defaultTrustedDirs(repoRoot);
  const extra = process.env.IUI_TRUSTED_DIRS;
  if (extra && extra.trim()) {
    const sep = extra.includes(path.delimiter) ? path.delimiter : ":";
    for (const part of extra.split(sep)) {
      const p = part.trim();
      if (p) dirs.push(path.resolve(p));
    }
  }
  // realpath where possible; keep unresolved if missing (caller still checks)
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of dirs) {
    let resolved = path.resolve(d);
    try {
      if (fs.existsSync(resolved)) {
        resolved = fs.realpathSync(resolved);
      }
    } catch {
      /* keep resolved */
    }
    if (!seen.has(resolved)) {
      seen.add(resolved);
      out.push(resolved);
    }
  }
  return out;
}

export function isPathUnderTrusted(
  candidateAbs: string,
  trustedDirs: string[],
): { ok: true; realPath: string; trustedRoot: string } | { ok: false; realPath?: string } {
  let real: string;
  try {
    real = fs.realpathSync(candidateAbs);
  } catch {
    return { ok: false };
  }
  for (const raw of trustedDirs) {
    let root = raw;
    try {
      if (fs.existsSync(root)) root = fs.realpathSync(root);
    } catch {
      /* use as-is */
    }
    if (real === root || real.startsWith(root + path.sep)) {
      return { ok: true, realPath: real, trustedRoot: root };
    }
  }
  return { ok: false, realPath: real };
}

/** Resolve entry relative to package root; reject escape. */
export function resolveEntryInsidePackage(
  packageRoot: string,
  entryRelative: string,
): { ok: true; absPath: string; relative: string } | { ok: false; code: string; message: string } {
  if (!entryRelative || typeof entryRelative !== "string") {
    return { ok: false, code: "MANIFEST_INVALID", message: "renderer.entry required" };
  }
  if (path.isAbsolute(entryRelative)) {
    return {
      ok: false,
      code: "MANIFEST_INVALID",
      message: "renderer.entry must be relative to package root",
    };
  }
  const joined = path.resolve(packageRoot, entryRelative);
  const rel = path.relative(packageRoot, joined);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      ok: false,
      code: "MANIFEST_INVALID",
      message: `renderer.entry escapes package root: ${entryRelative}`,
    };
  }
  if (!fs.existsSync(joined)) {
    return {
      ok: false,
      code: "MANIFEST_INVALID",
      message: `renderer.entry not found: ${entryRelative}`,
    };
  }
  let realEntry: string;
  let realRoot: string;
  try {
    realEntry = fs.realpathSync(joined);
    realRoot = fs.realpathSync(packageRoot);
  } catch (e) {
    return {
      ok: false,
      code: "MANIFEST_INVALID",
      message: `Cannot realpath entry: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (realEntry !== realRoot && !realEntry.startsWith(realRoot + path.sep)) {
    return {
      ok: false,
      code: "MANIFEST_INVALID",
      message: "renderer.entry realpath escapes package root (symlink?)",
    };
  }
  return { ok: true, absPath: realEntry, relative: entryRelative.replace(/\\/g, "/") };
}
