/**
 * Built-in surround modules.
 *
 * Imported for its side effect by `SurroundHost`, so neither mount seam
 * (`ScreenPlayer`, `MenuStack`) needs a registration call of its own.
 *
 * NOTHING IS REGISTERED YET. The three built-in components do not exist:
 *
 *   movement-map   -> Task 11, modules/MovementMap.jsx
 *   cue-ticker     -> Task 12, modules/CueTicker.jsx
 *   composer-card  -> Task 13, modules/ComposerCard.jsx
 *
 * Each of those tasks adds its import here and a `registerSurroundModule(...)`
 * line inside `registerSurroundBuiltins()`. Until then an unknown module name
 * resolves to null and `SurroundFrame` renders an empty region and warns
 * `surround.module.missing` — the intended fail-soft path, not a crash.
 */

// eslint-disable-next-line no-unused-vars -- used by Tasks 11-13 registrations below.
import { registerSurroundModule } from './registry.js';

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
  // Tasks 11-13 add their registerSurroundModule(...) calls here.
}

registerSurroundBuiltins();
