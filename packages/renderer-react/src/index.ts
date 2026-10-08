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
} from "./UiRenderer.js";
