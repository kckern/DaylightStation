/**
 * Eink Rendering Framework
 * @module 1_rendering/eink
 */

export { render } from './EinkRenderer.mjs';
export { resolveLayout } from './PanelRenderer.mjs';
export { resolveData } from './providers/DataResolver.mjs';
export * as widgetRegistry from './widgets/registry.mjs';
export { registerBuiltins } from './widgets/builtins.mjs';
