/** Shared catalog type definitions (English identifiers). */

export type JsonSchema = Record<string, unknown>;

export type RenderStatus = "full" | "schema_only" | "failed";

export interface ComponentDef {
  /** Short name, e.g. "Stack". */
  name: string;
  packageId: string;
  description: string;
  propsSchema: JsonSchema;
  actions?: string[];
  /** Whether this type may have children. */
  children?: boolean;
  enabled?: boolean;
}

export interface PackageManifest {
  id: string;
  title: string;
  version: string;
  description: string;
  source: "builtin" | "local";
  renderStatus: RenderStatus;
  components: ComponentDef[];
}

export function componentType(packageId: string, name: string): string {
  return `${packageId}/${name}`;
}
