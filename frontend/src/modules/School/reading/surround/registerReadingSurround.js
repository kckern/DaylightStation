/**
 * Registers the reading session's surround chrome — `reading-credit` — into the
 * surround module registry.
 *
 * ## THE BOUNDARY, WHICH IS THE POINT
 *
 * This module lives under `School/reading/surround/`, NOT under
 * `modules/Surround/`. The surround framework gains nothing structural from
 * reading sessions: it already resolves a module name to a component, and
 * School has a component. So School registers INTO Surround and Surround stays
 * ignorant of School — the same one-way dependency `registerLessonSurround.js`
 * keeps, and the reason `registry.js` deliberately builds a SEPARATE
 * `WidgetRegistry` instance rather than sharing the screen framework's one. Two
 * namespaces cannot shadow each other's names.
 *
 * It is registered here rather than in `Surround/builtins.js` for a second
 * reason too: `builtins.js` is the shipped concert-hall set, and its exact
 * membership is pinned by a literal list in `registry.test.js`. A School module
 * is not a built-in and has no business in that list.
 *
 * ## SIDE EFFECT *AND* FUNCTION, EXACTLY AS `builtins.js` IS
 *
 * Importing this file registers. It also exports the registrar, because
 * `resetSurroundRegistry()` drops the singleton and several Surround specs call
 * it — a registration that existed only as an import-time side effect would be
 * gone for the rest of that file, and the region would render blank with a
 * `surround.module.missing` warning nobody connected to a test helper.
 *
 * ## HOW THE DEFINITION REACHES THE FRAME (NOT via `SurroundHost`)
 *
 * `SurroundHost` takes no definition prop. It POLLS the player's imperative
 * handle at 1 Hz for `getNowPlaying().item.surround` and turns the frame on
 * only when the BACKEND attached a sidecar payload to the item. A reading
 * session's chrome comes from its SESSION — who scanned in, what they owe today
 * — not from a content sidecar, so there is nothing for that poll to find and
 * no prop with which to tell it.
 *
 * `ReadingSessionScreen` therefore mounts `SurroundFrame` DIRECTLY, which does
 * take an explicit payload. Two consequences that mount owns, because
 * `SurroundStage` — not the frame — is what supplies them under the host:
 *
 *   1. THE CLOCK. `SurroundFrame` samples nothing; the host's `SurroundStage`
 *      runs `useMediaClockState({ getMediaEl, contentId })` and passes the four
 *      clock props down. A direct mount must run that hook itself.
 *   2. THE REGISTRATIONS. `SurroundHost` side-effect-imports `./builtins.js`;
 *      `SurroundFrame` imports no registrations at all. A direct mount must
 *      import THIS file or every region resolves to null and warns
 *      `surround.module.missing`. `Surround/builtins.js` is deliberately NOT
 *      imported — the reading definition names only the module below, and
 *      pulling the concert-hall chrome into a school bundle for nothing is the
 *      dependency this feature keeps out.
 */

import { registerSurroundModule } from '../../../Surround/registry.js';
import ReadingCredit from './ReadingCredit.jsx';

/**
 * `[name, Component, meta]`. One list, so the registrations and the declared
 * name list cannot drift — the same construction `builtins.js` uses, for the
 * same reason.
 *
 * `regions` is the module's declaration of the slot it was CUT FOR.
 * `SurroundFrame` reads it and warns `surround.module.misplaced` when a
 * definition puts it somewhere else; it does not refuse, because an author may
 * mean it. This one is a standing column — avatar over subject over cover over
 * pips — so it belongs in the rail and nowhere else.
 */
const READING_MODULES = [
  ['reading-credit', ReadingCredit, { regions: ['right'] }],
];

/** The module names a reading definition may author. DERIVED, never restated. */
export const READING_SURROUND_MODULES = Object.freeze(READING_MODULES.map(([name]) => name));

/**
 * Register. Idempotent by construction — the registry is a Map, so
 * re-registering a name is a no-op overwrite. Deliberately NOT guarded by a
 * module-level `registered` flag, which would make it a no-op after
 * `resetSurroundRegistry()`.
 */
export function registerReadingSurroundModules() {
  for (const [name, Component, meta] of READING_MODULES) {
    registerSurroundModule(name, Component, meta);
  }
}

registerReadingSurroundModules();
