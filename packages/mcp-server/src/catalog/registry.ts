import { catalogBase, componentType } from "@intelligent-ui/catalog-base";
import type { ComponentDef, PackageManifest, RenderStatus } from "@intelligent-ui/catalog-base";
import { catalogShadcn } from "@intelligent-ui/catalog-shadcn";
import { catalogCharts } from "@intelligent-ui/catalog-charts";
import { catalogRadix } from "@intelligent-ui/catalog-radix";
import { catalogMui } from "@intelligent-ui/catalog-mui";
import { catalogAntd } from "@intelligent-ui/catalog-antd";
import { catalogChakra } from "@intelligent-ui/catalog-chakra";
import type { HostPackageRecord } from "./host-registry-bypass.js";

export interface LocalPackageMeta {
  rootPath: string;
  entryAbsPath: string;
  entryRelative: string;
  hash?: string;
  exports: Record<string, string>;
}

export interface RegisteredPackage {
  manifest: PackageManifest;
  enabled: boolean;
  /** per-component enabled overrides; missing = use package default / def.enabled */
  componentEnabled: Map<string, boolean>;
  /** Present for source=local packages */
  local?: LocalPackageMeta;
}

export class CatalogRegistry {
  private packages = new Map<string, RegisteredPackage>();

  constructor() {
    this.registerBuiltin(catalogBase, true);
    this.registerBuiltin(catalogShadcn, true);
    this.registerBuiltin(catalogCharts, true);
    // schema-only: registered & listable; off by default until set_enabled_packages
    this.registerBuiltin(catalogRadix, false);
    this.registerBuiltin(catalogMui, false);
    this.registerBuiltin(catalogAntd, false);
    this.registerBuiltin(catalogChakra, false);
  }

  private registerBuiltin(manifest: PackageManifest, enabled: boolean): void {
    this.packages.set(manifest.id, {
      manifest: structuredClone(manifest),
      enabled,
      componentEnabled: new Map(),
    });
  }

  getRegistered(id: string): RegisteredPackage | undefined {
    return this.packages.get(id);
  }

  putLocalPackage(manifest: PackageManifest, local: LocalPackageMeta, enabled: boolean): void {
    const prev = this.packages.get(manifest.id);
    this.packages.set(manifest.id, {
      manifest: structuredClone(manifest),
      enabled,
      componentEnabled: prev?.componentEnabled ?? new Map(),
      local: { ...local, exports: { ...local.exports } },
    });
  }

  upsertLocalComponent(
    packageId: string,
    def: ComponentDef,
    exportName: string,
    enable: boolean,
  ): void {
    const pkg = this.packages.get(packageId);
    if (!pkg || !pkg.local) return;
    const idx = pkg.manifest.components.findIndex((c) => c.name === def.name);
    if (idx >= 0) {
      pkg.manifest.components[idx] = structuredClone(def);
    } else {
      pkg.manifest.components.push(structuredClone(def));
    }
    pkg.local.exports[def.name] = exportName;
    const type = componentType(packageId, def.name);
    pkg.componentEnabled.set(type, enable);
  }

  removeLocalPackage(packageId: string): boolean {
    const pkg = this.packages.get(packageId);
    if (!pkg || pkg.manifest.source !== "local") return false;
    return this.packages.delete(packageId);
  }

  removeLocalComponent(packageId: string, name: string): boolean {
    const pkg = this.packages.get(packageId);
    if (!pkg || pkg.manifest.source !== "local") return false;
    const before = pkg.manifest.components.length;
    pkg.manifest.components = pkg.manifest.components.filter((c) => c.name !== name);
    delete pkg.local?.exports[name];
    pkg.componentEnabled.delete(componentType(packageId, name));
    return pkg.manifest.components.length < before;
  }

  listHostPackages(): HostPackageRecord[] {
    const out: HostPackageRecord[] = [];
    for (const pkg of this.packages.values()) {
      if (pkg.manifest.source !== "local" || !pkg.local) continue;
      out.push({
        id: pkg.manifest.id,
        version: pkg.manifest.version,
        title: pkg.manifest.title,
        enabled: pkg.enabled,
        renderStatus: pkg.manifest.renderStatus,
        rootPath: pkg.local.rootPath,
        entryAbsPath: pkg.local.entryAbsPath,
        entryRelative: pkg.local.entryRelative,
        exports: { ...pkg.local.exports },
        components: pkg.manifest.components.map((c) => c.name),
        hash: pkg.local.hash,
      });
    }
    return out;
  }

  listPackages(opts: {
    includeDisabled?: boolean;
    includeSchemaOnly?: boolean;
  } = {}): Array<{
    id: string;
    title: string;
    version: string;
    enabled: boolean;
    renderStatus: RenderStatus;
    componentCount: number;
    source: "builtin" | "local";
  }> {
    const includeDisabled = opts.includeDisabled ?? true;
    const includeSchemaOnly = opts.includeSchemaOnly ?? true;
    const out = [];
    for (const pkg of this.packages.values()) {
      if (!includeDisabled && !pkg.enabled) continue;
      if (!includeSchemaOnly && pkg.manifest.renderStatus === "schema_only") continue;
      out.push({
        id: pkg.manifest.id,
        title: pkg.manifest.title,
        version: pkg.manifest.version,
        enabled: pkg.enabled,
        renderStatus: pkg.manifest.renderStatus,
        componentCount: pkg.manifest.components.length,
        source: pkg.manifest.source,
      });
    }
    return out;
  }

  setEnabledPackages(
    map: Record<string, boolean>,
    replaceAll = false,
  ): { ok: true; enabledPackageIds: string[] } | { ok: false; code: string; message: string } {
    if (replaceAll) {
      for (const [id, pkg] of this.packages) {
        if (id === "catalog.base") {
          pkg.enabled = true;
          continue;
        }
        pkg.enabled = false;
      }
    }
    for (const [id, enabled] of Object.entries(map)) {
      if (id === "catalog.base" && enabled === false) {
        return {
          ok: false,
          code: "BASE_REQUIRED",
          message: "catalog.base cannot be disabled",
        };
      }
      const pkg = this.packages.get(id);
      if (!pkg) {
        return { ok: false, code: "UNKNOWN_PACKAGE", message: `Unknown package: ${id}` };
      }
      pkg.enabled = enabled;
    }
    return { ok: true, enabledPackageIds: this.enabledPackageIds() };
  }

  setEnabledComponents(map: Record<string, boolean>): string[] {
    for (const [type, enabled] of Object.entries(map)) {
      const slash = type.indexOf("/");
      if (slash < 0) continue;
      const packageId = type.slice(0, slash);
      const pkg = this.packages.get(packageId);
      if (!pkg) continue;
      pkg.componentEnabled.set(type, enabled);
    }
    return this.listComponents({ enabledOnly: true }).map((c) => c.type);
  }

  enabledPackageIds(): string[] {
    return [...this.packages.values()]
      .filter((p) => p.enabled)
      .map((p) => p.manifest.id);
  }

  isTypeEnabled(type: string): boolean {
    const slash = type.indexOf("/");
    if (slash < 0) return false;
    const packageId = type.slice(0, slash);
    const pkg = this.packages.get(packageId);
    if (!pkg || !pkg.enabled) return false;
    if (pkg.componentEnabled.has(type)) {
      return pkg.componentEnabled.get(type)!;
    }
    const name = type.slice(slash + 1);
    const def = pkg.manifest.components.find((c) => c.name === name);
    return def ? def.enabled !== false : false;
  }

  getComponent(type: string): ComponentDef | undefined {
    const slash = type.indexOf("/");
    if (slash < 0) return undefined;
    const packageId = type.slice(0, slash);
    const name = type.slice(slash + 1);
    const pkg = this.packages.get(packageId);
    return pkg?.manifest.components.find((c) => c.name === name);
  }

  listComponents(opts: {
    packageId?: string;
    enabledOnly?: boolean;
    query?: string;
  } = {}): Array<{
    type: string;
    packageId: string;
    name: string;
    description: string;
    enabled: boolean;
    renderStatus: RenderStatus;
    propsSchemaRef: string;
    actions: string[];
  }> {
    const enabledOnly = opts.enabledOnly ?? true;
    const q = opts.query?.toLowerCase();
    const out = [];
    for (const pkg of this.packages.values()) {
      if (opts.packageId && pkg.manifest.id !== opts.packageId) continue;
      if (enabledOnly && !pkg.enabled) continue;
      for (const c of pkg.manifest.components) {
        const type = componentType(c.packageId, c.name);
        const enabled =
          pkg.enabled &&
          (pkg.componentEnabled.has(type)
            ? pkg.componentEnabled.get(type)!
            : c.enabled !== false);
        if (enabledOnly && !enabled) continue;
        if (
          q &&
          !c.name.toLowerCase().includes(q) &&
          !c.description.toLowerCase().includes(q) &&
          !type.toLowerCase().includes(q)
        ) {
          continue;
        }
        out.push({
          type,
          packageId: c.packageId,
          name: c.name,
          description: c.description,
          enabled,
          renderStatus: pkg.manifest.renderStatus,
          propsSchemaRef: type,
          actions: c.actions ?? [],
        });
      }
    }
    return out;
  }

  getJsonSchema(opts: {
    componentType?: string;
    scope?: "component" | "ui_tree" | "ui_delta" | "all_enabled";
  }): { ok: true; schema: object } | { ok: false; code: string; message: string } {
    const scope = opts.scope ?? "component";
    if (scope === "component") {
      if (!opts.componentType) {
        return {
          ok: false,
          code: "MISSING_TYPE",
          message: "componentType required when scope=component",
        };
      }
      const def = this.getComponent(opts.componentType);
      if (!def) {
        return {
          ok: false,
          code: "UNKNOWN_TYPE",
          message: `Unknown component: ${opts.componentType}`,
        };
      }
      return { ok: true, schema: def.propsSchema };
    }
    if (scope === "all_enabled" || scope === "ui_tree") {
      const enabled = this.listComponents({ enabledOnly: true });
      const oneOf = enabled.map((c) => {
        const def = this.getComponent(c.type)!;
        return {
          type: "object",
          required: ["id", "type"],
          properties: {
            id: { type: "string" },
            type: { const: c.type },
            props: def.propsSchema,
            children: {
              type: "array",
              items: { $ref: "#/$defs/UiNode" },
            },
            bind: { type: "string" },
            actions: { type: "object" },
            key: { type: "string" },
            meta: { type: "object" },
          },
          additionalProperties: false,
        };
      });
      return {
        ok: true,
        schema: {
          $defs: {
            UiNode: {
              oneOf,
            },
          },
          $ref: "#/$defs/UiNode",
        },
      };
    }
    if (scope === "ui_delta") {
      return {
        ok: true,
        schema: {
          type: "object",
          required: ["op"],
          properties: {
            op: {
              enum: [
                "upsert",
                "patch_props",
                "remove",
                "append_child",
                "replace_children",
                "move",
                "set_bind",
              ],
            },
            nodeId: { type: "string" },
            parentId: { type: "string" },
            index: { type: "integer", minimum: 0 },
            node: { type: "object" },
            props: { type: "object" },
            path: { type: ["string", "null"] },
            fromIndex: { type: "integer" },
            toIndex: { type: "integer" },
          },
        },
      };
    }
    return { ok: false, code: "BAD_SCOPE", message: `Unknown scope: ${scope}` };
  }
}
