import type { PackageManifest, ComponentDef } from "@intelligent-ui/catalog-base";
import { componentType } from "@intelligent-ui/catalog-base";

const PACKAGE_ID = "catalog.shadcn";

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

const optionSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    label: { type: "string" },
  },
  required: ["id", "label"],
};

const components: ComponentDef[] = [
  def(
    "Button",
    "Clickable button",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        variant: {
          type: "string",
          enum: ["default", "secondary", "outline", "destructive", "ghost"],
          default: "default",
        },
        size: { type: "string", enum: ["sm", "md", "lg"], default: "md" },
        disabled: { type: "boolean", default: false },
      },
      required: ["label"],
    },
    { actions: ["click"] },
  ),
  def(
    "ButtonGroup",
    "Group of option buttons",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        options: { type: "array", items: optionSchema },
        variant: {
          type: "string",
          enum: ["default", "secondary", "outline"],
          default: "outline",
        },
      },
      required: ["options"],
    },
    { actions: ["click"] },
  ),
  def("Badge", "Small status label", {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string" },
      variant: {
        type: "string",
        enum: ["default", "secondary", "outline", "destructive"],
        default: "default",
      },
    },
    required: ["text"],
  }),
  def(
    "Card",
    "Card container with optional title",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
      },
    },
    { children: true },
  ),
  def(
    "Input",
    "Single-line text input",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        placeholder: { type: "string" },
        inputType: {
          type: "string",
          enum: ["text", "email", "number", "password"],
          default: "text",
        },
        value: { type: ["string", "number"] },
        disabled: { type: "boolean", default: false },
      },
    },
    { actions: ["change", "submit"] },
  ),
  def(
    "Textarea",
    "Multi-line text input",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        placeholder: { type: "string" },
        value: { type: "string" },
        rows: { type: "number", default: 4 },
        disabled: { type: "boolean", default: false },
      },
    },
    { actions: ["change", "submit"] },
  ),
  def(
    "Slider",
    "Numeric slider",
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
    "Switch",
    "Boolean toggle",
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
    "Checkbox with label",
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
    "Select",
    "Dropdown select",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              value: { type: "string" },
              label: { type: "string" },
            },
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
    "Tabs",
    "Tabbed panels; children align with items order or props.tabId",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
            },
            required: ["id", "label"],
          },
        },
        value: { type: "string" },
      },
      required: ["items"],
    },
    { children: true, actions: ["change"] },
  ),
  def("DataTable", "Simple data table", {
    type: "object",
    additionalProperties: false,
    properties: {
      columns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            header: { type: "string" },
            align: { type: "string", enum: ["left", "center", "right"] },
          },
          required: ["id", "header"],
        },
      },
      rows: {
        type: "array",
        items: { type: "object" },
      },
      caption: { type: "string" },
    },
    required: ["columns", "rows"],
  }),
  def(
    "Form",
    "Form wrapper collecting child field values on submit",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        submitLabel: { type: "string", default: "提交" },
      },
    },
    { children: true, actions: ["submit"] },
  ),
  def(
    "AlertDialog",
    "Confirm dialog (① may render as inline card)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        confirmLabel: { type: "string", default: "确认" },
        cancelLabel: { type: "string", default: "取消" },
        open: { type: "boolean", default: true },
      },
    },
    { actions: ["confirm", "cancel"] },
  ),
  def("Progress", "Progress bar 0–100", {
    type: "object",
    additionalProperties: false,
    properties: {
      value: { type: "number", minimum: 0, maximum: 100 },
      label: { type: "string" },
    },
  }),
  def("Separator", "Shadcn-skinned divider", {
    type: "object",
    additionalProperties: false,
    properties: {
      label: { type: "string" },
    },
  }),
  def("Accordion", "Expandable sections", {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["id", "title", "content"],
        },
      },
      type: { type: "string", enum: ["single", "multiple"], default: "single" },
    },
    required: ["items"],
  }),
  def(
    "Calculator",
    "Self-contained calculator keypad (local compute + actions)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        expression: { type: "string", description: "Initial expression / display" },
        result: { type: "string", description: "Initial result string" },
        title: { type: "string" },
      },
    },
    { actions: ["press", "equals", "clear"] },
  ),
  def(
    "Comparison",
    "Product / phone comparison cards or table with selectable winner",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        layout: {
          type: "string",
          enum: ["cards", "table"],
          default: "cards",
        },
        aspects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
            },
            required: ["id", "label"],
          },
          description: "Rows/aspects shared across items",
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              subtitle: { type: "string" },
              badge: { type: "string" },
              highlight: { type: "boolean" },
              values: { type: "object", additionalProperties: true },
            },
            required: ["id", "name"],
          },
        },
        selectedId: { type: "string" },
        selectLabel: { type: "string", default: "选这个" },
      },
      required: ["items"],
    },
    { actions: ["select"] },
  ),
  def(
    "Stepper",
    "Multi-step wizard with next/prev/goto",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        orientation: {
          type: "string",
          enum: ["horizontal", "vertical"],
          default: "horizontal",
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
            },
            required: ["id", "title"],
          },
        },
        current: {
          description: "Step index (0-based) or step id",
          oneOf: [{ type: "number" }, { type: "string" }],
        },
        nextLabel: { type: "string", default: "下一步" },
        prevLabel: { type: "string", default: "上一步" },
        completeLabel: { type: "string", default: "完成" },
      },
      required: ["steps"],
    },
    { actions: ["next", "prev", "goto", "complete"] },
  ),
  def(
    "Checklist",
    "Interactive checklist with toggle / complete",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              description: { type: "string" },
              checked: { type: "boolean", default: false },
            },
            required: ["id", "label"],
          },
        },
        showProgress: { type: "boolean", default: true },
        completeLabel: { type: "string", default: "全部完成" },
      },
      required: ["items"],
    },
    { actions: ["toggle", "check_all", "complete"] },
  ),
  def(
    "MapStub",
    "Lightweight map placeholder with markers (no tile API)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        caption: { type: "string" },
        center: {
          type: "object",
          properties: {
            lat: { type: "number" },
            lng: { type: "number" },
          },
          required: ["lat", "lng"],
        },
        zoom: { type: "number", default: 12 },
        markers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              lat: { type: "number" },
              lng: { type: "number" },
              label: { type: "string" },
            },
            required: ["id", "lat", "lng"],
          },
        },
      },
    },
    { actions: ["marker_click"] },
  ),
  def(
    "GameShell",
    "Simple interactive game shell (tic-tac-toe)",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", default: "井字棋" },
        kind: {
          type: "string",
          enum: ["tictactoe"],
          default: "tictactoe",
        },
        board: {
          type: "array",
          items: { type: ["string", "null"] },
          description: "9 cells: X / O / null",
        },
        status: { type: "string" },
      },
    },
    { actions: ["move", "reset", "win"] },
  ),
];

export const catalogShadcn: PackageManifest = {
  id: PACKAGE_ID,
  title: "shadcn/ui",
  version: "0.1.0",
  description: "Interactive controls aligned with shadcn/ui patterns",
  source: "builtin",
  renderStatus: "full",
  components,
};

export function listShadcnComponentTypes(): string[] {
  return components.map((c) => componentType(PACKAGE_ID, c.name));
}

export default catalogShadcn;
