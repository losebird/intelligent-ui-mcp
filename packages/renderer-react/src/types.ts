import type { ReactNode } from "react";

export interface UiNode {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  children?: UiNode[];
  bind?: string;
  actions?: Record<
    string,
    { actionType: string; payload?: Record<string, unknown> }
  >;
  key?: string;
  meta?: Record<string, unknown>;
}

export interface RenderAction {
  type: string;
  nodeId: string;
  componentType: string;
  value?: unknown;
  path?: string;
  payload?: Record<string, unknown>;
}

export interface RenderContext {
  state: Record<string, unknown>;
  onAction?: (action: RenderAction) => void;
}

export type ComponentRenderer = (props: {
  node: UiNode;
  ctx: RenderContext;
  renderChildren: (children?: UiNode[]) => ReactNode;
}) => ReactNode;
