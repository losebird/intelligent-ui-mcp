import type { PackageManifest, ComponentDef } from "@intelligent-ui/catalog-base";
import { componentType } from "@intelligent-ui/catalog-base";

const PACKAGE_ID = "catalog.charts";

const dataPointSchema = {
  type: "object",
  properties: {
    label: { type: "string" },
    x: { type: ["string", "number"] },
    y: { type: "number" },
    value: { type: "number" },
  },
  additionalProperties: true,
};

function def(
  name: string,
  description: string,
  propsSchema: ComponentDef["propsSchema"],
): ComponentDef {
  return {
    name,
    packageId: PACKAGE_ID,
    description,
    propsSchema,
    children: false,
    actions: [],
    enabled: true,
  };
}

const components: ComponentDef[] = [
  def("LineChart", "SVG line chart for trends / time series", {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      data: {
        type: "array",
        minItems: 1,
        items: dataPointSchema,
        description: "Points: {label|x, value|y}[]",
      },
      xKey: { type: "string", default: "label" },
      yKey: { type: "string", default: "value" },
      height: { type: "number", default: 180 },
      color: { type: "string", default: "#2563eb" },
      showDots: { type: "boolean", default: true },
      ariaLabel: { type: "string" },
    },
    required: ["data"],
  }),
  def("BarChart", "SVG bar chart for categorical comparisons", {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      data: {
        type: "array",
        minItems: 1,
        items: dataPointSchema,
        description: "Bars: {label, value}[]",
      },
      xKey: { type: "string", default: "label" },
      yKey: { type: "string", default: "value" },
      height: { type: "number", default: 180 },
      color: { type: "string", default: "#0f766e" },
      ariaLabel: { type: "string" },
    },
    required: ["data"],
  }),
  def("PieChart", "SVG pie / donut chart for part-to-whole", {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      data: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "number" },
          },
          required: ["label", "value"],
          additionalProperties: true,
        },
      },
      size: { type: "number", default: 160 },
      donut: { type: "boolean", default: false },
      ariaLabel: { type: "string" },
    },
    required: ["data"],
  }),
];

export const catalogCharts: PackageManifest = {
  id: PACKAGE_ID,
  title: "Charts",
  version: "0.1.0",
  description: "Lightweight SVG charts (Line / Bar / Pie) — full render in Host",
  source: "builtin",
  renderStatus: "full",
  components,
};

export function listChartsComponentTypes(): string[] {
  return components.map((c) => componentType(PACKAGE_ID, c.name));
}

export default catalogCharts;
