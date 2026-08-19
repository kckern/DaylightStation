/**
 * Surround module registry — resolves the module names authored in a surround
 * sidecar (`regions.right.module: movement-map`) to React components.
 *
 * Reuses the `WidgetRegistry` CLASS from the screen framework (it is a plain
 * name -> component Map, with no UI-framework coupling) but as a SEPARATE
 * INSTANCE. The screen widget registry is a different namespace with a different
 * lifecycle; sharing it would let a screen widget name shadow a surround module
 * and vice versa.
 *
 * `PanelRenderer` is deliberately NOT used: it renders static YAML props only and
 * offers no per-tick channel, so it cannot carry the 10Hz playhead that every
 * surround module is driven by.
 */

import { WidgetRegistry } from '../../screen-framework/widgets/registry.js';

let surroundRegistry = null;

/** The singleton surround registry. Independent of `getWidgetRegistry()`. */
export function getSurroundRegistry() {
  if (!surroundRegistry) surroundRegistry = new WidgetRegistry();
  return surroundRegistry;
}

/**
 * Register a component under a surround module name.
 *
 * @param {string} name       Name as authored in the sidecar, e.g. 'movement-map'.
 * @param {Function} Component React component. It receives the region definition
 *                             plus the sampled clock state from `SurroundFrame`.
 * @param {object} [meta]     Optional metadata (e.g. preferred regions).
 * @returns {Function} the component, so a registration can wrap an export.
 */
export function registerSurroundModule(name, Component, meta = null) {
  getSurroundRegistry().register(name, Component, meta);
  return Component;
}

/** Test seam: drop the singleton so specs start from an empty registry. */
export function resetSurroundRegistry() {
  surroundRegistry = null;
}
