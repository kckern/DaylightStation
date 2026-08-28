/**
 * Registers the media lesson's surround chrome — `checkpoint-map` and
 * `lesson-score` — into the surround module registry.
 *
 * ## THE BOUNDARY, WHICH IS THE POINT
 *
 * These two modules live under `School/lesson/surround/`, NOT under
 * `modules/Surround/`. The surround framework gains nothing structural from
 * media lessons: it already resolves a module name to a component, and School
 * has a component. So School registers INTO Surround and Surround stays
 * ignorant of School — the same one-way dependency the screen widgets keep, and
 * the reason `registry.js` deliberately builds a SEPARATE `WidgetRegistry`
 * instance rather than sharing the screen framework's one. Two namespaces
 * cannot shadow each other's names. `registerLessonSurround.test.jsx` walks the
 * Surround tree and fails on any import pointing back at School.
 *
 * ## SIDE EFFECT *AND* FUNCTION, EXACTLY AS `builtins.js` IS
 *
 * Importing this file registers. It also exports the registrar, because
 * `resetSurroundRegistry()` drops the singleton and several Surround specs call
 * it — a registration that existed only as an import-time side effect would be
 * gone for the rest of that file, and the region would render blank with a
 * `surround.module.missing` warning nobody connected to a test helper.
 *
 * ## HOW THE DEFINITION REACHES THE FRAME (verified, and NOT via `SurroundHost`)
 *
 * `SurroundHost` takes no definition prop. It POLLS the player's imperative
 * handle at 1 Hz for `getNowPlaying().item.surround` and turns the frame on
 * only when the BACKEND attached a sidecar payload to the item
 * (`SurroundHost.jsx`, `resolveSurround` / `active`). A lesson's chrome comes
 * from its SESSION, not from a content sidecar, so there is nothing for that
 * poll to find and no prop with which to tell it.
 *
 * The lesson widget therefore mounts `SurroundFrame` DIRECTLY, which does take
 * an explicit payload: `<SurroundFrame active data={{ id, definition, lesson }}
 * contentId position duration playing seeking logger>{player}</SurroundFrame>`.
 * Two consequences the widget owns, because `SurroundStage` — not the frame —
 * is what supplies them under the host:
 *
 *   1. THE CLOCK. `SurroundFrame` samples nothing; the host's `SurroundStage`
 *      runs `useMediaClockState({ getMediaEl, contentId })` and passes the four
 *      clock props down. A direct mount must run that hook itself.
 *   2. THE REGISTRATIONS. `SurroundHost` side-effect-imports `./builtins.js`;
 *      `SurroundFrame` imports no registrations at all. A direct mount must
 *      import THIS file (and `Surround/builtins.js` too, if its definition also
 *      names a built-in module) or every region resolves to null and warns
 *      `surround.module.missing`.
 */

import { registerSurroundModule } from '../../../Surround/registry.js';
import CheckpointMap from './CheckpointMap.jsx';
import LessonScore from './LessonScore.jsx';

/**
 * `[name, Component, meta]`. One list, so the registrations and the declared
 * name list cannot drift — the same construction `builtins.js` uses, for the
 * same reason.
 *
 * `regions` is each module's declaration of the slot it was CUT FOR.
 * `SurroundFrame` reads it and warns `surround.module.misplaced` when a
 * definition puts one somewhere else; it does not refuse, because an author may
 * mean it. The map is a strip and belongs under the picture; the placard is a
 * badge and works either straddling the top edge or standing in the rail.
 */
const LESSON_MODULES = [
  ['checkpoint-map', CheckpointMap, { regions: ['bottom'] }],
  ['lesson-score', LessonScore, { regions: ['top', 'right'] }],
];

/** The module names a lesson definition may author. DERIVED, never restated. */
export const LESSON_SURROUND_MODULES = Object.freeze(LESSON_MODULES.map(([name]) => name));

/**
 * Register both. Idempotent by construction — the registry is a Map, so
 * re-registering a name is a no-op overwrite. Deliberately NOT guarded by a
 * module-level `registered` flag, which would make it a no-op after
 * `resetSurroundRegistry()`.
 */
export function registerLessonSurroundModules() {
  for (const [name, Component, meta] of LESSON_MODULES) {
    registerSurroundModule(name, Component, meta);
  }
}

registerLessonSurroundModules();
