import type { PackageManifest, ComponentDef } from "@intelligent-ui/catalog-base";
import { componentType } from "@intelligent-ui/catalog-base";

const PACKAGE_ID = "catalog.antd";

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
    "Ant Design Button (schema-only; Host maps → catalog.shadcn/Button)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        type: {
          type: "string",
          enum: ["primary", "default", "dashed", "link", "text"],
          default: "primary",
        },
        variant: {
          type: "string",
          enum: ["default", "secondary", "outline", "destructive", "ghost"],
        },
        size: { type: "string", enum: ["small", "middle", "large", "sm", "md", "lg"], default: "middle" },
        disabled: { type: "boolean", default: false },
        danger: { type: "boolean", default: false },
      },
      required: ["label"],
    },
    { actions: ["click"] },
  ),
  def(
    "Input",
    "Ant Design Input (schema-only; Host maps → catalog.shadcn/Input)",
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
    "Select",
    "Ant Design Select (schema-only; Host maps → catalog.shadcn/Select)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: { value: { type: "string" }, label: { type: "string" } },
            required: ["value", "label"],
          },
        },
        value: { type: "string" },
        placeholder: { type: "string" },
      },
      required: ["options"],
    },
    { actions: ["change"] },
  ),
  def(
    "Switch",
    "Ant Design Switch (schema-only; Host maps → catalog.shadcn/Switch)",
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
    "Progress",
    "Ant Design Progress (schema-only; Host maps → catalog.shadcn/Progress)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        percent: { type: "number", minimum: 0, maximum: 100 },
        value: { type: "number", minimum: 0, maximum: 100 },
        label: { type: "string" },
      },
    },
  ),
  def(
    "Table",
    "Ant Design Table (schema-only; Host maps → catalog.shadcn/DataTable)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        columns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              dataIndex: { type: "string" },
              header: { type: "string" },
              title: { type: "string" },
            },
          },
        },
        rows: { type: "array", items: { type: "object" } },
        dataSource: { type: "array", items: { type: "object" } },
        caption: { type: "string" },
      },
    },
  ),
  def(
    "Alert",
    "Ant Design Alert (schema-only; Host maps → catalog.base/Callout)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["info", "success", "warning", "error", "warn"],
          default: "info",
        },
        tone: {
          type: "string",
          enum: ["info", "warn", "error", "success"],
        },
        title: { type: "string" },
        message: { type: "string" },
        text: { type: "string" },
      },
    },
  ),
];

export const catalogAntd: PackageManifest = {
  id: PACKAGE_ID,
  title: "Ant Design",
  version: "0.1.0",
  description: "Schema-only Ant Design placeholders — may degrade to shadcn/base in Host",
  source: "builtin",
  renderStatus: "schema_only",
  components,
};

export function listAntdComponentTypes(): string[] {
  return components.map((c) => componentType(PACKAGE_ID, c.name));
}

export default catalogAntd;
