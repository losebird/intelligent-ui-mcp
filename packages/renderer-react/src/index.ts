export type { UiNode, RenderAction, RenderContext, ComponentRenderer } from "./types.js";
export {
  UiRenderer,
  getRenderer,
  listMappedTypes,
  listAliasTypes,
  componentRegistry,
  SCHEMA_ONLY_ALIASES,
  resolveAlias,
  adaptAliasedProps,
  NodeMotionShell,
  SkeletonPlaceholder,
  prefersReducedMotion,
  subscribePrefersReducedMotion,
  resetPrefersReducedMotionCache,
} from "./UiRenderer.js";
export {
  normalizeRenderAction,
  coerceActionInput,
  toHostActionRecord,
  type LooseAction,
} from "./actionNormalize.js";
