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
import LibrettoRail from './modules/LibrettoRail.jsx';

/**
 * Every built-in, as `[name, Component, meta]`. The single source the
 * registrations, the declared name list and the aliases are all derived from —
 * three hand-maintained copies of one list is how a module ends up registered
 * under a name nothing declares.
 */
const BUILTIN_MODULES = [
  ['segment-map', SegmentMap, { regions: ['bottom'] }],
  ['cue-ticker', CueTicker, { regions: ['bottom'] }],
  ['composer-card', ComposerCard, { regions: ['right'] }],
  ['country-map', CountryMapModule, { regions: ['right', 'bottom'] }],
  ['place-carousel', PlaceCarousel, { regions: ['right'] }],
  ['work-placard', WorkPlacard, { regions: ['top'] }],
  // The lyric rail. `lyric` is its OWN slot, not `right`: the frame renders
  // exactly one of the two, and declaring it as a right-hand module would
  // make every definition that already authors a right rail look like it
  // wanted both.
  ['libretto', LibrettoRail, { regions: ['lyric'] }],
];

/**
 * `alias -> the builtin name it stands for`.
 *
 * The name `segment-map` was `movement-map` until the vocabulary was unified,
 * and the definition YAML in the data volume is authored by hand. Both names
 * resolve to the same component so a definition may be migrated whenever
 * somebody gets to it — an unmigrated `_surrounds/*.yml` renders the rail, it
 * does not warn `surround.module.missing` and leave the region blank.
 *
 * EVERY ENTRY IS HONOURED, and every entry must name a real builtin. Nothing
 * here special-cases `segment-map`: the next rename adds a row and needs no
 * other edit. A row naming a module that does not exist is an authoring mistake
 * in this file, and `registry.test.js` fails on it rather than skipping it
 * quietly — a silently-dropped alias is the same blank region the aliases exist
 * to prevent.
 */
export const LEGACY_MODULE_ALIASES = Object.freeze({ 'movement-map': 'segment-map' });

/**
 * The module names `SurroundFrame` resolves, aliases included. DERIVED, not
 * restated, so it cannot drift from what `registerSurroundBuiltins` does.
 */
export const SURROUND_BUILTIN_MODULES = Object.freeze([
  ...BUILTIN_MODULES.map(([name]) => name),
  ...Object.keys(LEGACY_MODULE_ALIASES),
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
  const byName = new Map(BUILTIN_MODULES.map(([name, Component, meta]) => [name, [Component, meta]]));
  for (const [name, Component, meta] of BUILTIN_MODULES) registerSurroundModule(name, Component, meta);
  // Pre-rename names, each registered against the SAME component and the SAME
  // meta as the module it stands for. A registration rather than a
  // resolution-time fallback, so `list()` reports what actually resolves.
  for (const [alias, name] of Object.entries(LEGACY_MODULE_ALIASES)) {
    const [Component, meta] = byName.get(name) ?? [];
    registerSurroundModule(alias, Component, meta);
  }
}

registerSurroundBuiltins();
