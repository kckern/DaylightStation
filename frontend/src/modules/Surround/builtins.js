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
import SegmentMap from './modules/SegmentMap.jsx';
import CueTicker from './modules/CueTicker.jsx';
import ComposerCard from './modules/ComposerCard.jsx';
import CountryMapModule from './modules/CountryMapModule.jsx';
import PlaceCarousel from './modules/PlaceCarousel.jsx';
import WorkPlacard from './modules/WorkPlacard.jsx';

/**
 * The name `segment-map` was `movement-map` until the vocabulary was unified,
 * and the definition YAML in the data volume is authored by hand. Both names
 * resolve to the same component so a definition may be migrated whenever
 * somebody gets to it — an unmigrated `_surrounds/*.yml` renders the rail, it
 * does not warn `surround.module.missing` and leave the region blank.
 */
export const LEGACY_MODULE_ALIASES = Object.freeze({ 'movement-map': 'segment-map' });

/** The module names `SurroundFrame` resolves, aliases included. */
export const SURROUND_BUILTIN_MODULES = Object.freeze([
  'segment-map',
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
 *
 * The `regions` meta is each module's declaration of the slots it was CUT FOR: a
 * rail module is a column and a band module is a strip, and one dropped into the
 * other renders perfectly and looks wrong. `SurroundFrame` reads it and warns
 * `surround.module.misplaced` — it does not refuse, because an author may mean
 * it, but it says so once with both ends named.
 */
export function registerSurroundBuiltins() {
  registerSurroundModule('segment-map', SegmentMap, { regions: ['bottom'] });
  // The pre-rename name, registered against the same component and the same
  // meta — see LEGACY_MODULE_ALIASES. It is a registration rather than a
  // resolution-time fallback so `list()` reports what actually resolves.
  for (const [alias, name] of Object.entries(LEGACY_MODULE_ALIASES)) {
    if (name === 'segment-map') registerSurroundModule(alias, SegmentMap, { regions: ['bottom'] });
  }
  registerSurroundModule('cue-ticker', CueTicker, { regions: ['bottom'] });
  registerSurroundModule('composer-card', ComposerCard, { regions: ['right'] });
  registerSurroundModule('country-map', CountryMapModule, { regions: ['right', 'bottom'] });
  registerSurroundModule('place-carousel', PlaceCarousel, { regions: ['right'] });
  registerSurroundModule('work-placard', WorkPlacard, { regions: ['top'] });
}

registerSurroundBuiltins();
