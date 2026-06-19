/**
 * Eink Rendering Framework
 * @module 1_rendering/eink
 */

// Version of the rendering pipeline (renderer + widgets + theme defaults). BUMP
// THIS whenever a change here would alter the pixels produced for identical
// inputs — it is folded into the panel's content fingerprint (EinkPanelService
// .stateSnapshot) so a renderer/widget edit invalidates every panel's cached
// image_hash and forces one fresh /panel pull, even when the data is unchanged.
export const RENDERER_VERSION = 1;

export { render } from './EinkRenderer.mjs';
export { resolveLayout } from './PanelRenderer.mjs';
export { resolveData } from './providers/DataResolver.mjs';
export * as widgetRegistry from './widgets/registry.mjs';
export { registerBuiltins } from './widgets/builtins.mjs';
