import type { PackageManifest, ComponentDef } from "@intelligent-ui/catalog-base";
import { componentType } from "@intelligent-ui/catalog-base";

const PACKAGE_ID = "catalog.chakra";

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
    "Chakra Button (schema-only; Host maps → catalog.shadcn/Button)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        variant: {
          type: "string",
          enum: ["solid", "outline", "ghost", "link", "default", "secondary"],
          default: "solid",
        },
        size: { type: "string", enum: ["xs", "sm", "md", "lg"], default: "md" },
        disabled: { type: "boolean", default: false },
        colorScheme: { type: "string" },
      },
      required: ["label"],
    },
    { actions: ["click"] },
  ),
  def(
    "Input",
    "Chakra Input (schema-only; Host maps → catalog.shadcn/Input)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        placeholder: { type: "string" },
        value: { type: ["string", "number"] },
        disabled: { type: "boolean", default: false },
      },
    },
    { actions: ["change", "submit"] },
  ),
  def(
    "Switch",
    "Chakra Switch (schema-only; Host maps → catalog.shadcn/Switch)",
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
    "Chakra Progress (schema-only; Host maps → catalog.shadcn/Progress)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        value: { type: "number", minimum: 0, maximum: 100 },
        label: { type: "string" },
      },
    },
  ),
  def(
    "Alert",
    "Chakra Alert (schema-only; Host maps → catalog.base/Callout)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          enum: ["info", "warning", "error", "success", "warn"],
          default: "info",
        },
        tone: { type: "string", enum: ["info", "warn", "error", "success"] },
        title: { type: "string" },
        text: { type: "string" },
      },
      required: ["text"],
    },
  ),
  def(
    "Tabs",
    "Chakra Tabs (schema-only; Host maps → catalog.shadcn/Tabs)",
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
];

export const catalogChakra: PackageManifest = {
  id: PACKAGE_ID,
  title: "Chakra UI",
  version: "0.1.0",
  description: "Schema-only Chakra placeholders — may degrade to shadcn/base in Host",
  source: "builtin",
  renderStatus: "schema_only",
  components,
};

export function listChakraComponentTypes(): string[] {
  return components.map((c) => componentType(PACKAGE_ID, c.name));
}

export default catalogChakra;
