import type { PackageManifest, ComponentDef } from "@intelligent-ui/catalog-base";
import { componentType } from "@intelligent-ui/catalog-base";

const PACKAGE_ID = "catalog.mui";

function def(
  name: string,
  description: string,
  propsSchema: ComponentDef["propsSchema"],
  opts: { children?: boolean; actions?: string[] } = {},
): ComponentDef {
  return {
    name,
    packageId: PACKAGE_ID,
    description,
    propsSchema,
    children: opts.children ?? false,
    actions: opts.actions ?? [],
    enabled: true,
  };
}

const components: ComponentDef[] = [
  def(
    "Button",
    "MUI Button (schema-only; Host maps → catalog.shadcn/Button)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        variant: {
          type: "string",
          enum: ["contained", "outlined", "text", "default", "secondary", "outline"],
          default: "contained",
        },
        size: { type: "string", enum: ["small", "medium", "large", "sm", "md", "lg"], default: "medium" },
        disabled: { type: "boolean", default: false },
        color: { type: "string" },
      },
      required: ["label"],
    },
    { actions: ["click"] },
  ),
  def(
    "TextField",
    "MUI TextField (schema-only; Host maps → catalog.shadcn/Input)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        placeholder: { type: "string" },
        value: { type: ["string", "number"] },
        disabled: { type: "boolean", default: false },
        inputType: { type: "string", default: "text" },
      },
    },
    { actions: ["change", "submit"] },
  ),
  def(
    "Switch",
    "MUI Switch (schema-only; Host maps → catalog.shadcn/Switch)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        checked: { type: "boolean", default: false },
      },
      required: ["label"],
    },
    { actions: ["change"] },
  ),
  def(
    "Slider",
    "MUI Slider (schema-only; Host maps → catalog.shadcn/Slider)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        min: { type: "number", default: 0 },
        max: { type: "number", default: 100 },
        step: { type: "number", default: 1 },
        value: { type: "number" },
      },
    },
    { actions: ["change"] },
  ),
  def(
    "Alert",
    "MUI Alert (schema-only; Host maps → catalog.base/Callout)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        severity: {
          type: "string",
          enum: ["info", "warning", "error", "success", "warn"],
          default: "info",
        },
        title: { type: "string" },
        text: { type: "string" },
      },
      required: ["text"],
    },
  ),
  def(
    "LinearProgress",
    "MUI LinearProgress (schema-only; Host maps → catalog.shadcn/Progress)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        value: { type: "number", minimum: 0, maximum: 100 },
        label: { type: "string" },
      },
    },
  ),
];

export const catalogMui: PackageManifest = {
  id: PACKAGE_ID,
  title: "MUI",
  version: "0.1.0",
  description: "Schema-only MUI placeholders — may degrade to shadcn/base in Host",
  source: "builtin",
  renderStatus: "schema_only",
  components,
};

export function listMuiComponentTypes(): string[] {
  return components.map((c) => componentType(PACKAGE_ID, c.name));
}

export default catalogMui;
