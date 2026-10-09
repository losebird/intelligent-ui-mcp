import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ComponentDef, PackageManifest, RenderStatus } from "@intelligent-ui/catalog-base";
import { componentType } from "@intelligent-ui/catalog-base";
import type { CatalogRegistry, LocalPackageMeta } from "./registry.js";
import {
  getTrustedDirs,
  isPathUnderTrusted,
  resolveEntryInsidePackage,
  resolveRepoRoot,
} from "./trusted.js";
import type { HostPackageRecord, HostRegistryBypass } from "./host-registry-bypass.js";

/** Default true. Set IUI_STRICT_HASH=0|false to allow omit/mismatch without tool flag. */
export function resolveStrictHashDefault(): boolean {
  const raw = process.env.IUI_STRICT_HASH;
  if (raw === undefined || raw === "") return true;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(v)) return false;
  return true;
}

export interface RegisterPackageInput {
  path: string;
  enable?: boolean;
  /** When omitted, uses resolveStrictHashDefault() (true unless IUI_STRICT_HASH=0). */
  strictHash?: boolean;
}

export type RegisterResult =
  | {
      ok: true;
      packageId: string;
      renderStatus: RenderStatus;
      warnings: string[];
      components: string[];
    }
  | { ok: false; code: string; message: string };

interface RawManifest {
  id?: string;
  title?: string;
  version?: string;
  license?: string;
  description?: string;
  renderer?: {
    entry?: string;
    hash?: string;
    exports?: Record<string, string>;
  };
  components?: Array<{
    name?: string;
    description?: string;
    propsSchema?: Record<string, unknown>;
    actions?: string[];
    enabledByDefault?: boolean;
  }>;
}

const ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
const NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  const hex = crypto.createHash("sha256").update(buf).digest("hex");
  return `sha256-${hex}`;
}

function normalizeHash(h: string): string {
  const t = h.trim().toLowerCase();
  if (t.startsWith("sha256-")) return `sha256-${t.slice("sha256-".length)}`;
  // bare hex
  if (/^[0-9a-f]{64}$/.test(t)) return `sha256-${t}`;
  return t;
}

function loadPropsSchema(
  packageRoot: string,
  raw: Record<string, unknown> | undefined,
  name: string,
): Record<string, unknown> | { error: string } {
  if (!raw || typeof raw !== "object") {
    return { error: `components[${name}].propsSchema required` };
  }
  if (typeof raw.$refFile === "string") {
    const ref = raw.$refFile;
    if (path.isAbsolute(ref) || ref.includes("..")) {
      return { error: `$refFile must be relative and stay in package: ${ref}` };
    }
    const abs = path.resolve(packageRoot, ref);
    const rel = path.relative(packageRoot, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return { error: `$refFile escapes package root: ${ref}` };
    }
    if (!fs.existsSync(abs)) {
      return { error: `$refFile not found: ${ref}` };
    }
    try {
      return JSON.parse(fs.readFileSync(abs, "utf8")) as Record<string, unknown>;
    } catch (e) {
      return { error: `Invalid $refFile JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return raw;
}

export function registerPackageFromPath(
  catalog: CatalogRegistry,
  hostBypass: HostRegistryBypass,
  input: RegisterPackageInput,
): RegisterResult {
  const enable = input.enable !== false;
  // Explicit false turns off; omit → IUI_STRICT_HASH default true.
  const strictHash =
    input.strictHash !== undefined ? input.strictHash : resolveStrictHashDefault();
  const warnings: string[] = [];

  const repoRoot = resolveRepoRoot();
  const trusted = getTrustedDirs(repoRoot);

  const requested = path.resolve(input.path);
  if (!fs.existsSync(requested)) {
    return { ok: false, code: "PATH_NOT_TRUSTED", message: `Path does not exist: ${requested}` };
  }

  const trust = isPathUnderTrusted(requested, trusted);
  if (!trust.ok) {
    return {
      ok: false,
      code: "PATH_NOT_TRUSTED",
      message: `Path not under IUI_TRUSTED_DIRS (defaults: packages/, examples/custom-packages/, ~/.intelligent-ui-mcp/trusted): ${requested}`,
    };
  }
  const packageRoot = trust.realPath;

  const manifestPath = path.join(packageRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      ok: false,
      code: "MANIFEST_INVALID",
      message: `manifest.json not found in ${packageRoot}`,
    };
  }

  let raw: RawManifest;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as RawManifest;
  } catch (e) {
    return {
      ok: false,
      code: "MANIFEST_INVALID",
      message: `manifest.json parse error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!raw.id || typeof raw.id !== "string") {
    return { ok: false, code: "MANIFEST_INVALID", message: "manifest.id required" };
  }
  if (raw.id.startsWith("catalog.")) {
    return {
      ok: false,
      code: "MANIFEST_INVALID",
      message: "id must not start with catalog. (reserved for builtins)",
    };
  }
  if (!ID_RE.test(raw.id)) {
    return {
      ok: false,
      code: "MANIFEST_INVALID",
      message: `id must be lowercase dotted (e.g. acme.gauges): ${raw.id}`,
    };
  }
  if (!raw.version || typeof raw.version !== "string") {
    return { ok: false, code: "MANIFEST_INVALID", message: "manifest.version required" };
  }
  if (!raw.renderer?.entry) {
    return { ok: false, code: "MANIFEST_INVALID", message: "renderer.entry required" };
  }
  if (!Array.isArray(raw.components) || raw.components.length === 0) {
    return {
      ok: false,
      code: "MANIFEST_INVALID",
      message: "components[] required and non-empty",
    };
  }

  // TYPE_CONFLICT with builtin package id
  const existing = catalog.getRegistered(raw.id);
  if (existing && existing.manifest.source === "builtin") {
    return {
      ok: false,
      code: "TYPE_CONFLICT",
      message: `Cannot register over builtin package: ${raw.id}`,
    };
  }

  const entryRes = resolveEntryInsidePackage(packageRoot, raw.renderer.entry);
  if (!entryRes.ok) {
    return { ok: false, code: entryRes.code, message: entryRes.message };
  }

  const providedHash = raw.renderer.hash;
  const actualHash = sha256File(entryRes.absPath);
  if (strictHash) {
    if (!providedHash || typeof providedHash !== "string") {
      return {
        ok: false,
        code: "HASH_MISSING",
        message: "renderer.hash required when strictHash=true (format sha256-<hex>)",
      };
    }
    if (normalizeHash(providedHash) !== normalizeHash(actualHash)) {
      return {
        ok: false,
        code: "HASH_MISMATCH",
        message: `Entry hash mismatch: manifest=${providedHash}, actual=${actualHash}`,
      };
    }
  } else if (providedHash && normalizeHash(providedHash) !== normalizeHash(actualHash)) {
    warnings.push(`hash mismatch ignored (strictHash=false): expected ${providedHash}, got ${actualHash}`);
  } else if (!providedHash) {
    warnings.push("renderer.hash missing; skipped (strictHash=false)");
  }

  const exportsMap: Record<string, string> = { ...(raw.renderer.exports ?? {}) };
  const components: ComponentDef[] = [];

  for (const c of raw.components) {
    if (!c.name || !NAME_RE.test(c.name)) {
      return {
        ok: false,
        code: "MANIFEST_INVALID",
        message: `Invalid component name (PascalCase): ${c.name ?? "?"}`,
      };
    }
    const schemaRes = loadPropsSchema(packageRoot, c.propsSchema, c.name);
    if ("error" in schemaRes) {
      return { ok: false, code: "MANIFEST_INVALID", message: schemaRes.error };
    }
    if (!exportsMap[c.name]) {
      exportsMap[c.name] = c.name;
    }
    const type = componentType(raw.id, c.name);
    // conflict with another package's type shouldn't happen if ids unique;
    // conflict if builtin somehow shares — builtins use catalog.*
    components.push({
      name: c.name,
      packageId: raw.id,
      description: c.description ?? c.name,
      propsSchema: schemaRes,
      actions: c.actions ?? [],
      enabled: c.enabledByDefault !== false,
    });
    void type;
  }

  const title = raw.title ?? raw.id;
  const description = raw.description ?? title;

  const manifest: PackageManifest = {
    id: raw.id,
    title,
    version: raw.version,
    description,
    source: "local",
    renderStatus: "full",
    components,
  };

  const meta: LocalPackageMeta = {
    rootPath: packageRoot,
    entryAbsPath: entryRes.absPath,
    entryRelative: entryRes.relative,
    hash: providedHash ? normalizeHash(providedHash) : actualHash,
    exports: exportsMap,
  };

  catalog.putLocalPackage(manifest, meta, enable);

  syncHostRegistry(catalog, hostBypass, {
    event: existing ? "package.updated" : "package.registered",
    packageId: raw.id,
  });

  return {
    ok: true,
    packageId: raw.id,
    renderStatus: "full",
    warnings,
    components: components.map((c) => componentType(raw.id, c.name)),
  };
}

export function registerComponentHot(
  catalog: CatalogRegistry,
  hostBypass: HostRegistryBypass,
  input: {
    packageId: string;
    name: string;
    propsSchema: Record<string, unknown>;
    description?: string;
    actions?: string[];
    rendererExport?: string;
    enable?: boolean;
  },
): RegisterResult | { ok: true; type: string } {
  if (!NAME_RE.test(input.name)) {
    return {
      ok: false,
      code: "MANIFEST_INVALID",
      message: `Invalid component name (PascalCase): ${input.name}`,
    };
  }
  const pkg = catalog.getRegistered(input.packageId);
  if (!pkg) {
    return {
      ok: false,
      code: "UNKNOWN_PACKAGE",
      message: `Package not registered: ${input.packageId}. Call register_package first.`,
    };
  }
  if (pkg.manifest.source === "builtin") {
    return {
      ok: false,
      code: "TYPE_CONFLICT",
      message: "Cannot hot-register onto builtin catalog.* packages",
    };
  }
  if (!pkg.local) {
    return {
      ok: false,
      code: "MANIFEST_INVALID",
      message: "Package has no local renderer meta",
    };
  }

  const type = componentType(input.packageId, input.name);
  const exportName = input.rendererExport ?? input.name;
  const enable = input.enable !== false;

  const def: ComponentDef = {
    name: input.name,
    packageId: input.packageId,
    description: input.description ?? input.name,
    propsSchema: input.propsSchema,
    actions: input.actions ?? [],
    enabled: enable,
  };

  catalog.upsertLocalComponent(input.packageId, def, exportName, enable);
  syncHostRegistry(catalog, hostBypass, {
    event: "package.updated",
    packageId: input.packageId,
  });

  return { ok: true, type };
}

export function unregisterPackageOrComponent(
  catalog: CatalogRegistry,
  hostBypass: HostRegistryBypass,
  input: { packageId?: string; componentType?: string },
): { ok: true } | { ok: false; code: string; message: string } {
  if (!input.packageId && !input.componentType) {
    return {
      ok: false,
      code: "BAD_ARGS",
      message: "packageId or componentType required",
    };
  }

  if (input.packageId) {
    const pkg = catalog.getRegistered(input.packageId);
    if (!pkg) {
      return { ok: false, code: "UNKNOWN_PACKAGE", message: `Unknown package: ${input.packageId}` };
    }
    if (pkg.manifest.source === "builtin" || input.packageId.startsWith("catalog.")) {
      return {
        ok: false,
        code: "BUILTIN_PROTECTED",
        message: "Cannot unregister builtin catalog.* packages (disable instead)",
      };
    }
    catalog.removeLocalPackage(input.packageId);
    syncHostRegistry(catalog, hostBypass, {
      event: "package.unregistered",
      packageId: input.packageId,
    });
    return { ok: true };
  }

  const ct = input.componentType!;
  const slash = ct.indexOf("/");
  if (slash < 0) {
    return { ok: false, code: "BAD_ARGS", message: "componentType must be packageId/Name" };
  }
  const packageId = ct.slice(0, slash);
  const name = ct.slice(slash + 1);
  if (packageId.startsWith("catalog.")) {
    return {
      ok: false,
      code: "BUILTIN_PROTECTED",
      message: "Cannot unregister builtin components",
    };
  }
  const pkg = catalog.getRegistered(packageId);
  if (!pkg || pkg.manifest.source === "builtin") {
    return { ok: false, code: "UNKNOWN_PACKAGE", message: `Unknown local package: ${packageId}` };
  }
  const removed = catalog.removeLocalComponent(packageId, name);
  if (!removed) {
    return { ok: false, code: "UNKNOWN_TYPE", message: `Unknown component: ${ct}` };
  }
  syncHostRegistry(catalog, hostBypass, {
    event: "package.updated",
    packageId,
  });
  return { ok: true };
}

export function syncHostRegistry(
  catalog: CatalogRegistry,
  hostBypass: HostRegistryBypass,
  evt: {
    event: "package.registered" | "package.unregistered" | "package.updated";
    packageId: string;
  },
): void {
  const packages = catalog.listHostPackages();
  hostBypass.writeRegistry(packages);
  if (evt.event === "package.unregistered") {
    hostBypass.appendEvent("package.unregistered", { packageId: evt.packageId });
  } else {
    const rec = packages.find((p) => p.id === evt.packageId);
    hostBypass.appendEvent(evt.event, { package: rec ?? { id: evt.packageId } });
  }
}

/** Expose for smoke / hash scripts */
export function computeEntryHash(filePath: string): string {
  return sha256File(filePath);
}

export type { HostPackageRecord };
