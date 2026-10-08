import type { PackageManifest, ComponentDef } from "@intelligent-ui/catalog-base";
import { componentType } from "@intelligent-ui/catalog-base";

const PACKAGE_ID = "catalog.radix";

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
    "Dialog",
    "Headless dialog (schema-only; Host maps → AlertDialog / Card)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        open: { type: "boolean", default: true },
      },
    },
    { children: true, actions: ["confirm", "cancel"] },
  ),
  def(
    "DropdownMenu",
    "Dropdown menu (schema-only; Host maps → Select / ButtonGroup)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, label: { type: "string" } },
            required: ["id", "label"],
          },
        },
      },
      required: ["items"],
    },
    { actions: ["select"] },
  ),
  def(
    "Tabs",
    "Radix tabs (schema-only; Host maps → catalog.shadcn/Tabs)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, label: { type: "string" } },
            required: ["id", "label"],
          },
        },
        value: { type: "string" },
      },
      required: ["items"],
    },
    { children: true, actions: ["change"] },
  ),
  def(
    "Switch",
    "Radix switch (schema-only; Host maps → catalog.shadcn/Switch)",
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
    "Checkbox",
    "Radix checkbox (schema-only; Host maps → catalog.shadcn/Checkbox)",
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
];

export const catalogRadix: PackageManifest = {
  id: PACKAGE_ID,
  title: "Radix UI",
  version: "0.1.0",
  description: "Schema-only Radix placeholders — may degrade to shadcn/base in Host",
  source: "builtin",
  renderStatus: "schema_only",
  components,
};

export function listRadixComponentTypes(): string[] {
  return components.map((c) => componentType(PACKAGE_ID, c.name));
}

export default catalogRadix;
