import type { PackageManifest, ComponentDef } from "./types.js";
import { componentType } from "./types.js";

export type {
  JsonSchema,
  RenderStatus,
  ComponentDef,
  PackageManifest,
} from "./types.js";
export { componentType } from "./types.js";

const PACKAGE_ID = "catalog.base";

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
    "Stack",
    "Vertical/horizontal layout of children",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        direction: {
          type: "string",
          enum: ["vertical", "horizontal"],
          default: "vertical",
        },
        gap: { type: "number", default: 8, description: "Gap in px" },
        align: {
          type: "string",
          enum: ["start", "center", "end", "stretch"],
          default: "stretch",
        },
        wrap: { type: "boolean", default: false },
      },
    },
    { children: true },
  ),
  def(
    "Grid",
    "Simple responsive grid",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        columns: { type: "number", default: 2 },
        gap: { type: "number", default: 12 },
      },
    },
    { children: true },
  ),
  def("Markdown", "Safe Markdown subset (no raw HTML)", {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string", description: "Markdown source" },
    },
    required: ["text"],
  }),
  def("Text", "Plain text with variant", {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string" },
      variant: {
        type: "string",
        enum: ["body", "muted", "title", "caption"],
        default: "body",
      },
    },
    required: ["text"],
  }),
  def("Divider", "Horizontal separator", {
    type: "object",
    additionalProperties: false,
    properties: {
      label: { type: "string" },
    },
  }),
  def("Spacer", "Empty vertical/horizontal space", {
    type: "object",
    additionalProperties: false,
    properties: {
      size: { type: "number", default: 16 },
    },
  }),
  def("Image", "Image from http(s) or data URL", {
    type: "object",
    additionalProperties: false,
    properties: {
      src: { type: "string" },
      alt: { type: "string", default: "" },
      width: { type: "number" },
      height: { type: "number" },
    },
    required: ["src"],
  }),
  def("CodeBlock", "Fenced code block", {
    type: "object",
    additionalProperties: false,
    properties: {
      code: { type: "string" },
      language: { type: "string" },
      showLineNumbers: { type: "boolean", default: false },
    },
    required: ["code"],
  }),
  def("Unknown", "Fallback for unknown component types (system use)", {
    type: "object",
    additionalProperties: false,
    properties: {
      requestedType: { type: "string" },
      message: { type: "string" },
    },
  }),
  def("Callout", "Highlighted info/warn/error/success box", {
    type: "object",
    additionalProperties: false,
    properties: {
      tone: {
        type: "string",
        enum: ["info", "warn", "error", "success"],
        default: "info",
      },
      title: { type: "string" },
      text: { type: "string" },
    },
    required: ["text"],
  }),
];

export const catalogBase: PackageManifest = {
  id: PACKAGE_ID,
  title: "Base",
  version: "0.1.0",
  description: "Layout and neutral display primitives for Intelligent UI trees",
  source: "builtin",
  renderStatus: "full",
  components,
};

export function listBaseComponentTypes(): string[] {
  return components.map((c) => componentType(PACKAGE_ID, c.name));
}

export default catalogBase;
