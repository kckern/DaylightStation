/**
 * Built-in surround modules.
 *
 * Imported for its side effect by `SurroundHost`, so neither mount seam
 * (`ScreenPlayer`, `MenuStack`) needs a registration call of its own.
 *
 * Every built-in module is registered here. A name that is NOT one of these
 * still resolves to null, and `SurroundFrame` renders an empty region and warns
 * `surround.module.missing` — the intended fail-soft path, not a crash.
 *
 * `country-map` is registered through `CountryMapModule`, a thin adapter: the
 * map component itself takes a country and a coordinate and knows nothing about
 * surround payloads, which is what keeps it reusable.
 *
 * `place-carousel` shows that same map as one of its slides, so the concert-hall
 * definition no longer authors `country-map` anywhere. The registration stays:
 * a definition that wants a bare, non-cycling map in a region of its own is a
 * legitimate thing to author, and the two share `mapPinFrom` rather than each
 * re-deriving the pin from the payload.
 */

import { registerSurroundModule } from './registry.js';
import MovementMap from './modules/MovementMap.jsx';
import CueTicker from './modules/CueTicker.jsx';
import ComposerCard from './modules/ComposerCard.jsx';
import CountryMapModule from './modules/CountryMapModule.jsx';
import PlaceCarousel from './modules/PlaceCarousel.jsx';
import WorkPlacard from './modules/WorkPlacard.jsx';

/** The module names `SurroundFrame` resolves. */
export const SURROUND_BUILTIN_MODULES = Object.freeze([
  'movement-map',
  'cue-ticker',
  'composer-card',
  'country-map',
  'place-carousel',
  'work-placard',
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
  registerSurroundModule('country-map', CountryMapModule, { regions: ['right', 'bottom'] });
  registerSurroundModule('place-carousel', PlaceCarousel, { regions: ['right'] });
  registerSurroundModule('work-placard', WorkPlacard, { regions: ['top'] });
}

registerSurroundBuiltins();
