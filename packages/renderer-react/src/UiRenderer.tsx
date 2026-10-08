import type { ReactNode } from "react";
import { baseRenderers } from "./components/base/index.js";
import { shadcnRenderers } from "./components/shadcn/index.js";
import { chartsRenderers } from "./components/charts/index.js";
import {
  SCHEMA_ONLY_ALIASES,
  adaptAliasedProps,
  resolveAlias,
} from "./aliases.js";
import type { ComponentRenderer, RenderContext, UiNode } from "./types.js";

const registry: Record<string, ComponentRenderer> = {
  ...baseRenderers,
  ...shadcnRenderers,
  ...chartsRenderers,
};

export function getRenderer(type: string): ComponentRenderer | undefined {
  const alias = resolveAlias(type);
  return registry[type] ?? (alias ? registry[alias] : undefined);
}

export function listMappedTypes(): string[] {
  return Object.keys(registry).sort();
}

export function listAliasTypes(): string[] {
  return Object.keys(SCHEMA_ONLY_ALIASES).sort();
}

export { SCHEMA_ONLY_ALIASES, resolveAlias, adaptAliasedProps };

export function UiRenderer(props: {
  tree: UiNode | null | undefined;
  state?: Record<string, unknown>;
  onAction?: RenderContext["onAction"];
  className?: string;
  /** Dynamic custom-package renderers (④); merged over builtins. */
  extraRenderers?: Record<string, ComponentRenderer>;
  /** G10 density preference (Host chrome). */
  density?: "full" | "compact" | "plain_prefer";
}) {
  const merged: Record<string, ComponentRenderer> = {
    ...registry,
    ...(props.extraRenderers ?? {}),
  };
  const ctx: RenderContext = {
    state: props.state ?? {},
    onAction: props.onAction,
  };
  const density = props.density ?? "full";
  const rootClass = [
    "iui-root",
    density !== "full" ? `iui-density-${density}` : "",
    props.className,
  ]
    .filter(Boolean)
    .join(" ");

  const renderNode = (node: UiNode): ReactNode => {
    const aliasTarget = resolveAlias(node.type);
    const mappedType = aliasTarget ?? node.type;
    const has = Boolean(merged[mappedType]);
    const renderer = merged[mappedType] ?? merged["catalog.base/Unknown"];

    let effective: UiNode;
    if (has && aliasTarget) {
      effective = {
        ...node,
        type: aliasTarget,
        props: adaptAliasedProps(node.type, aliasTarget, node.props),
        meta: {
          ...(node.meta ?? {}),
          aliasedFrom: node.type,
          schemaOnlyAlias: true,
        },
      };
    } else if (has) {
      effective = node;
    } else {
      effective = {
        ...node,
        type: "catalog.base/Unknown",
        props: {
          requestedType: node.type,
          message: "No renderer mapping",
        },
      };
    }

    const degraded = !has;
    const aliased = Boolean(has && aliasTarget);

    return (
      <div key={node.key ?? node.id} className={aliased ? "iui-aliased" : undefined}>
        {aliased ? (
          <div className="iui-alias-hint" title={`schema_only → ${aliasTarget}`}>
            {node.type} → {aliasTarget}
          </div>
        ) : null}
        {degraded && node.type !== "catalog.base/Unknown" ? (
          <div className="iui-unknown-banner">未映射类型：{node.type}</div>
        ) : null}
        {renderer({
          node: effective,
          ctx,
          renderChildren: (children) =>
            (children ?? []).map((child) => renderNode(child)),
        })}
      </div>
    );
  };

  if (!props.tree) {
    return (
      <div className={rootClass}>
        <div className="iui-text-muted">等待 ui_open / ui_propose</div>
      </div>
    );
  }

  return <div className={rootClass}>{renderNode(props.tree)}</div>;
}

export { registry as componentRegistry };
