/**
 * Built-in surround modules.
 *
 * Imported for its side effect by `SurroundHost`, so neither mount seam
 * (`ScreenPlayer`, `MenuStack`) needs a registration call of its own.
 *
 * All three PoC modules are registered. A name that is NOT one of these still
 * resolves to null, and `SurroundFrame` renders an empty region and warns
 * `surround.module.missing` — the intended fail-soft path, not a crash.
 */

import { registerSurroundModule } from './registry.js';
import MovementMap from './modules/MovementMap.jsx';
import CueTicker from './modules/CueTicker.jsx';
import ComposerCard from './modules/ComposerCard.jsx';

/** The module names `SurroundFrame` resolves for the PoC. */
export const SURROUND_BUILTIN_MODULES = Object.freeze([
  'movement-map',
  'cue-ticker',
  'composer-card',
]);

/**
 * Register every built-in module. Idempotent by construction — the registry is a
 * Map, so re-registering the same name is a no-op overwrite. Deliberately NOT
 * guarded by a module-level `registered` flag: that would make the function a
 * no-op after `resetSurroundRegistry()` in a test.
 */
export function registerSurroundBuiltins() {
  registerSurroundModule('movement-map', MovementMap, { regions: ['bottom'] });
  registerSurroundModule('cue-ticker', CueTicker, { regions: ['bottom'] });
  registerSurroundModule('composer-card', ComposerCard, { regions: ['right'] });
}

registerSurroundBuiltins();
