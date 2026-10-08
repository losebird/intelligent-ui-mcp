import type { UiNode } from "./protocol.js";

export interface LintIssue {
  severity: "error" | "warn";
  code: string;
  message: string;
  nodeId?: string;
}

export interface LintResult {
  passed: boolean;
  issues: LintIssue[];
}

const CHART_TYPE_RE =
  /(^|\/)(LineChart|BarChart|AreaChart|PieChart|ScatterChart|Chart)$/i;

function isChartType(type: string): boolean {
  return (
    CHART_TYPE_RE.test(type) ||
    type.startsWith("catalog.charts/") ||
    /Chart/i.test(type.split("/").pop() ?? "")
  );
}

function collectText(node: UiNode): string {
  const parts: string[] = [];
  const props = node.props ?? {};
  for (const k of ["text", "markdown", "content", "label", "title", "description"]) {
    const v = props[k];
    if (typeof v === "string") parts.push(v);
  }
  if (node.children) {
    for (const c of node.children) parts.push(collectText(c));
  }
  return parts.join(" ");
}

function countNodes(node: UiNode): number {
  let n = 1;
  if (node.children) for (const c of node.children) n += countNodes(c);
  return n;
}

function collectTypes(node: UiNode, out: string[]): void {
  out.push(node.type);
  if (node.children) for (const c of node.children) collectTypes(c, out);
}

function hasChartData(props: Record<string, unknown> | undefined): boolean {
  if (!props) return false;
  const data = props.data ?? props.series ?? props.datasets;
  if (Array.isArray(data) && data.length > 0) return true;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const vals = Object.values(data as Record<string, unknown>);
    if (vals.some((v) => Array.isArray(v) && v.length > 0)) return true;
  }
  return false;
}

export function lintTree(
  tree: UiNode,
  isTypeEnabled: (type: string) => boolean,
): LintResult {
  const issues: LintIssue[] = [];
  const seen = new Set<string>();
  const allTypes: string[] = [];
  collectTypes(tree, allTypes);

  function walk(node: UiNode, depth: number): void {
    if (!node.id || typeof node.id !== "string") {
      issues.push({
        severity: "error",
        code: "MISSING_ID",
        message: "Node missing id",
      });
      return;
    }
    if (seen.has(node.id)) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_ID",
        message: `Duplicate node id: ${node.id}`,
        nodeId: node.id,
      });
    }
    seen.add(node.id);

    if (!node.type || typeof node.type !== "string") {
      issues.push({
        severity: "error",
        code: "MISSING_TYPE",
        message: `Node ${node.id} missing type`,
        nodeId: node.id,
      });
      return;
    }

    if (!isTypeEnabled(node.type)) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_TYPE",
        message: `Type not enabled or unknown: ${node.type}`,
        nodeId: node.id,
      });
    }

    if (isChartType(node.type) && !hasChartData(node.props)) {
      issues.push({
        severity: "error",
        code: "CHART_MISSING_DATA",
        message: `Chart-like type ${node.type} requires non-empty data/series`,
        nodeId: node.id,
      });
    }

    if (node.props) {
      for (const key of Object.keys(node.props)) {
        if (key.startsWith("__")) {
          issues.push({
            severity: "error",
            code: "FORBIDDEN_PROP",
            message: `Prop key starting with __ is forbidden: ${key}`,
            nodeId: node.id,
          });
        }
      }
      if ("children" in node.props) {
        issues.push({
          severity: "error",
          code: "PROPS_CHILDREN",
          message: "Do not put children inside props; use children array",
          nodeId: node.id,
        });
      }
      if (node.type === "catalog.base/Image") {
        const src = node.props.src;
        if (typeof src === "string" && /^javascript:/i.test(src)) {
          issues.push({
            severity: "error",
            code: "UNSAFE_URL",
            message: "javascript: URLs are not allowed for Image",
            nodeId: node.id,
          });
        }
      }
    }

    if (node.expr && typeof node.expr === "object") {
      for (const [k, v] of Object.entries(node.expr)) {
        if (typeof v !== "string") {
          issues.push({
            severity: "error",
            code: "EXPR_NOT_STRING",
            message: `expr.${k} must be a string`,
            nodeId: node.id,
          });
        }
      }
    }

    if (depth > 32) {
      issues.push({
        severity: "warn",
        code: "DEEP_TREE",
        message: `Tree depth > 32 at ${node.id}`,
        nodeId: node.id,
      });
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child, depth + 1);
      }
    }
  }

  walk(tree, 0);

  // CARD_OVERWRAP: short single-paragraph text wrapped only in Card
  const text = collectText(tree).replace(/\s+/g, " ").trim();
  const nodeCount = countNodes(tree);
  const hasCard = allTypes.some(
    (t) => t === "catalog.shadcn/Card" || t.endsWith("/Card"),
  );
  const hasRich = allTypes.some((t) =>
    /DataTable|List|Chart|Form|Slider|Tabs|Accordion|ButtonGroup|Select|Switch|Progress|Input/i.test(
      t,
    ),
  );
  if (
    hasCard &&
    !hasRich &&
    text.length > 0 &&
    text.length < 80 &&
    nodeCount <= 4
  ) {
    issues.push({
      severity: "warn",
      code: "CARD_OVERWRAP",
      message:
        "Short single-paragraph content wrapped in Card — prefer plain text or bare Markdown",
      nodeId: tree.id,
    });
  }

  const passed = !issues.some((i) => i.severity === "error");
  return { passed, issues };
}
