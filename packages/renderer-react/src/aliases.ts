/**
 * Schema-only catalog types → full-render base/shadcn targets (G5 / ⑥).
 * Unlisted schema-only types fall through to Unknown + yellow strip.
 */
export const SCHEMA_ONLY_ALIASES: Record<string, string> = {
  // antd
  "catalog.antd/Button": "catalog.shadcn/Button",
  "catalog.antd/Input": "catalog.shadcn/Input",
  "catalog.antd/Select": "catalog.shadcn/Select",
  "catalog.antd/Switch": "catalog.shadcn/Switch",
  "catalog.antd/Progress": "catalog.shadcn/Progress",
  "catalog.antd/Table": "catalog.shadcn/DataTable",
  "catalog.antd/Alert": "catalog.base/Callout",
  // mui
  "catalog.mui/Button": "catalog.shadcn/Button",
  "catalog.mui/TextField": "catalog.shadcn/Input",
  "catalog.mui/Switch": "catalog.shadcn/Switch",
  "catalog.mui/Slider": "catalog.shadcn/Slider",
  "catalog.mui/Alert": "catalog.base/Callout",
  "catalog.mui/LinearProgress": "catalog.shadcn/Progress",
  // chakra
  "catalog.chakra/Button": "catalog.shadcn/Button",
  "catalog.chakra/Input": "catalog.shadcn/Input",
  "catalog.chakra/Switch": "catalog.shadcn/Switch",
  "catalog.chakra/Progress": "catalog.shadcn/Progress",
  "catalog.chakra/Alert": "catalog.base/Callout",
  "catalog.chakra/Tabs": "catalog.shadcn/Tabs",
  // radix
  "catalog.radix/Tabs": "catalog.shadcn/Tabs",
  "catalog.radix/Switch": "catalog.shadcn/Switch",
  "catalog.radix/Checkbox": "catalog.shadcn/Checkbox",
  "catalog.radix/Dialog": "catalog.shadcn/AlertDialog",
  "catalog.radix/DropdownMenu": "catalog.shadcn/Select",
};

/** Normalize common schema-only prop names onto the alias target. */
export function adaptAliasedProps(
  originalType: string,
  targetType: string,
  props: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const p = { ...(props ?? {}) };

  // Alert / Callout tone mapping
  if (targetType === "catalog.base/Callout") {
    const sev = String(p.severity ?? p.status ?? p.type ?? p.tone ?? "info");
    const toneMap: Record<string, string> = {
      info: "info",
      warning: "warn",
      warn: "warn",
      error: "error",
      success: "success",
    };
    p.tone = toneMap[sev] ?? "info";
    if (!p.text && typeof p.message === "string") p.text = p.message;
  }

  // antd Button type/danger → shadcn variant
  if (originalType === "catalog.antd/Button") {
    if (!p.variant) {
      if (p.danger) p.variant = "destructive";
      else if (p.type === "primary") p.variant = "default";
      else if (p.type === "default" || p.type === "dashed") p.variant = "outline";
      else if (p.type === "text" || p.type === "link") p.variant = "ghost";
    }
  }

  // mui / antd / chakra size tokens
  if (typeof p.size === "string") {
    const sizeMap: Record<string, string> = {
      small: "sm",
      middle: "md",
      medium: "md",
      large: "lg",
      xs: "sm",
    };
    p.size = sizeMap[p.size] ?? p.size;
  }

  // mui variant tokens
  if (typeof p.variant === "string") {
    const vMap: Record<string, string> = {
      contained: "default",
      outlined: "outline",
      text: "ghost",
      solid: "default",
    };
    p.variant = vMap[p.variant] ?? p.variant;
  }

  // antd Progress percent → value
  if (targetType === "catalog.shadcn/Progress" && p.value == null && p.percent != null) {
    p.value = p.percent;
  }

  // antd Table dataSource/columns → DataTable
  if (targetType === "catalog.shadcn/DataTable") {
    if (!p.rows && Array.isArray(p.dataSource)) p.rows = p.dataSource;
    if (Array.isArray(p.columns)) {
      p.columns = (p.columns as Array<Record<string, unknown>>).map((c, i) => ({
        id: String(c.id ?? c.dataIndex ?? `c${i}`),
        header: String(c.header ?? c.title ?? c.id ?? c.dataIndex ?? `col${i}`),
        align: c.align,
      }));
    }
  }

  // radix DropdownMenu items → Select options
  if (originalType === "catalog.radix/DropdownMenu" && Array.isArray(p.items) && !p.options) {
    p.options = (p.items as Array<{ id: string; label: string }>).map((it) => ({
      value: it.id,
      label: it.label,
    }));
  }

  return p;
}

export function resolveAlias(type: string): string | undefined {
  return SCHEMA_ONLY_ALIASES[type];
}
