import { useMemo, useState, useEffect, type ReactNode } from "react";
import { baseRenderers } from "./components/base/index.js";
import { shadcnRenderers } from "./components/shadcn/index.js";
import { chartsRenderers } from "./components/charts/index.js";
import {
  SCHEMA_ONLY_ALIASES,
  adaptAliasedProps,
  resolveAlias,
} from "./aliases.js";
import type { ComponentRenderer, RenderContext, UiNode } from "./types.js";
import { NodeMotionShell } from "./motion/NodeMotionShell.js";
import { SkeletonPlaceholder } from "./motion/SkeletonPlaceholder.js";
import {
  prefersReducedMotion,
  subscribePrefersReducedMotion,
} from "./motion/prefersReducedMotion.js";

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
  /** Host chrome mode: "0" for bubble / bare embed. */
  chrome?: string;
  /**
   * Lightweight Motion (ops progressive paint). Default true.
   * Not Claude Dashboards/Motion — CSS enter + shimmer only; no remount.
   */
  motion?: boolean;
  /** Session streaming / partial — show skeleton placeholder. */
  streaming?: boolean;
}) {
  const motionEnabled = props.motion !== false;
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" ? prefersReducedMotion() : false,
  );
  useEffect(() => {
    if (!motionEnabled) return;
    return subscribePrefersReducedMotion(setReduced);
  }, [motionEnabled]);

  const merged: Record<string, ComponentRenderer> = useMemo(
    () => ({
      ...registry,
      ...(props.extraRenderers ?? {}),
    }),
    [props.extraRenderers],
  );
  const ctx: RenderContext = {
    state: props.state ?? {},
    onAction: props.onAction,
  };
  const density = props.density ?? "full";
  const chrome = props.chrome ?? "";
  const streaming = Boolean(props.streaming);
  const rootClass = [
    "iui-root",
    density !== "full" ? `iui-density-${density}` : "",
    chrome === "0" || chrome === "bare" ? "iui-root-bubble" : "",
    motionEnabled && !reduced ? "iui-motion-on" : "",
    reduced || !motionEnabled ? "iui-motion-off" : "",
    streaming ? "iui-streaming" : "",
    props.className,
  ]
    .filter(Boolean)
    .join(" ");

  const renderNode = (node: UiNode, enterIndex = 0): ReactNode => {
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

    // Prefer stable node.id as React key — changing node.key remounts (loses iframe/local state).
    // NodeMotionShell keeps the same DOM across patch_props; enter anim runs once.
    return (
      <NodeMotionShell
        key={node.id}
        nodeId={node.id}
        type={node.type}
        motion={motionEnabled && !reduced}
        enterIndex={enterIndex}
        className={aliased ? "iui-aliased" : undefined}
      >
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
            (children ?? []).map((child, i) => renderNode(child, i)),
        })}
      </NodeMotionShell>
    );
  };

  if (!props.tree) {
    return (
      <div
        className={rootClass}
        data-iui-chrome={chrome || undefined}
        data-iui-reduced-motion={reduced ? "1" : "0"}
        data-iui-streaming={streaming ? "1" : undefined}
      >
        {streaming ? (
          <SkeletonPlaceholder rows={4} label="等待首个控件…" />
        ) : (
          <div className="iui-text-muted">等待 ui_open / ui_propose</div>
        )}
      </div>
    );
  }

  return (
    <div
      className={rootClass}
      data-iui-chrome={chrome || undefined}
      data-iui-reduced-motion={reduced ? "1" : "0"}
      data-iui-streaming={streaming ? "1" : undefined}
    >
      {renderNode(props.tree, 0)}
      {streaming ? (
        <SkeletonPlaceholder variant="inline" label="仍在生成…" />
      ) : null}
    </div>
  );
}

export { registry as componentRegistry };
export { NodeMotionShell } from "./motion/NodeMotionShell.js";
export { SkeletonPlaceholder } from "./motion/SkeletonPlaceholder.js";
export {
  prefersReducedMotion,
  subscribePrefersReducedMotion,
  resetPrefersReducedMotionCache,
} from "./motion/prefersReducedMotion.js";
