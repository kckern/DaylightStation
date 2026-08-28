# Task 2 report — stage resolution consolidates under the schema

**Status:** done.
**Files:** created `frontend/src/modules/Piano/ask/stagecraft.js`; modified
`frontend/src/modules/Piano/ask/askSchema.js`,
`frontend/src/modules/Piano/ask/askSchema.test.js`,
`frontend/src/modules/Piano/PianoKiosk/modes/Exercises/runPresentation.js`.
`runPresentation.test.js` is **byte-identical** to its pre-task state (`git
diff` shows no change) and still passes — the proof the shim is faithful.

## What was built

**`ask/stagecraft.js`** (new, 242 lines) — the theory/geometry helpers moved
**verbatim** (no logic rewrites) from `runPresentation.js`: `accidentalForKey`,
`instanceKeySignature` (+ its `DEGREE_OF`/`LETTERS`/`LETTER_SEMITONE`/
`DEGREE_SEMITONE` tables), `clefForAsk`, `clefForInstance`,
`sequenceStaffCanDraw` (+ its `SEQUENCE_STAFF_SPAN` constant), plus the shared
internals `askMidis`, `within`, `TREBLE_WINDOW`/`BASS_WINDOW`. `askMidis` and
`MAX_ASK_SPAN` are exported (not just internal) because `staffFitsAsk` — which
stays in `runPresentation.js` as an `ExerciseRun`-only concern — needs them
too; re-deriving `askMidis` a second time there would be a second place for it
to drift from `clefForAsk`'s own reading of the same events.

**`askSchema.js`** gains `deriveStage(tuple, instance)` →
`'keys'|'sequence'|'notation'|'score'`, a thin adapter from tuple-space onto
`stagecraft.js`'s geometry (imports only `sequenceStaffCanDraw`). Precedence,
most-specific first:

1. `notationStyle: 'score'` → `'score'` (a tuple only carries this for
   score-sourced material per `validateAsk`'s own constraint; today's
   `ExerciseRun` short-circuits to this stage before `stageForTier` is ever
   called, so this is that same precedence expressed inside one function).
2. `instance.ordering === 'any'` → `'keys'` (overrides every tier/preset).
3. `prompt: 'follow'` (tiers 0–1) → `'keys'`.
4. `notationStyle: 'sequence'` (tier 2) → `'sequence'` if
   `sequenceStaffCanDraw(instance)`, else `'notation'`.
5. Otherwise → `'notation'` (tier 3's `engraved`/cued reading).

File is 339 lines — under the brief's ~400-line guidance, so no need for a
second sibling file for `deriveStage` itself; the geometry/theory helpers went
to `stagecraft.js` as the brief allowed ("your call, state it").

**`runPresentation.js`** (86 lines, down from 286) is now a shim: imports the
five moved helpers from `../../../ask/stagecraft.js` and re-exports them
unchanged (`export { accidentalForKey, instanceKeySignature, clefForAsk,
clefForInstance, sequenceStaffCanDraw };`), keeps `staffFitsAsk` and
`eventsToStaffNotes` (ExerciseRun-only, never moved), and keeps
`deriveRunTier`/`stageForTier` verbatim — the tier-numbered routing
`ExerciseRun` still calls today. `deriveStage` is **not** wired into
`ExerciseRun` in this task; per the brief, "no other file changes in this
task" — `ExerciseRun.jsx`, `KeysAsk.jsx`, `ExerciseNotation.jsx` all still
import from `runPresentation.js` exactly as before, and none of them changed.

## A deliberate scope decision: no secondary-staff boolean on `deriveStage`

The brief's "shape" section floated `deriveStage` returning "+ whatever
secondary-staff boolean the callers need." I checked what `ExerciseRun`
actually does: it computes its own reinforcement-staff flag
(`askStaff = !score && runTier >= 1 && staffFitsAsk(instance.events)`)
independently of `stageForTier`'s return value — `stageForTier` today answers
*only* the stage name, never a staff flag. Since this task explicitly keeps
`ExerciseRun.jsx` unmodified, there's no consumer yet for a bundled boolean,
and inventing one un-consumed would be speculative surface. `deriveStage`
therefore matches `stageForTier`'s existing contract exactly: one stage
string. A follow-on task that wires `deriveStage` into `ExerciseRun` can
decide then whether the staff flag belongs on this function or stays
separate (mirroring today's `staffFitsAsk`, itself untouched).

## Testing (TDD)

New truth-table tests appended to `askSchema.test.js`, describe block
`deriveStage — tuple-space stage resolution`: every `{preset (tier-0..3)} ×
{ordering: strict/any} × {canDraw: yes/no}` cell (16 tests), plus direct
parity tests against each `runPresentation.test.js` `stageForTier` case
(tier-0/1 → keys, tier-2 canDraw → sequence, tier-2 Hanon-shape → notation,
tier-3 → notation regardless of canDraw, `ordering:'any'` → keys for every
preset), plus the `notationStyle:'score'` precedence case and a
null/undefined-safety case. 25 new tests.

Command and real output, scoped per the brief:

```
$ npx vitest run --config vitest.config.mjs frontend/src/modules/Piano/ask/ frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ frontend/src/modules/Piano/PianoKiosk/modes/Games/

 Test Files  20 passed (20)
      Tests  494 passed (494)
   Duration  17.40s
```

`runPresentation.test.js` is in that 20/494 — unmodified, green.

Full Piano-module regression (unrelated to this change, run to confirm no
collateral breakage), run twice:

```
$ npx vitest run --config vitest.config.mjs frontend/src/modules/Piano/
 Test Files  387 passed (387)
      Tests  4688 passed (4688)
   Duration  57.52s
```

(First run of the full suite showed one failure —
`ExerciseRun.component.test.jsx`, a fake-timer `waitFor` assertion on the
metronome mock — that did not reproduce in isolation or in the scoped run
above; a second full-suite run was clean at 4688/4688. Pre-existing
timer-under-load flake, not caused by this change: the file that failed
imports only `stageForTier`/`clefForInstance`/etc. through the shim, whose
implementations are byte-identical to before.)

## Concerns

- One pre-existing flaky test surfaced under full-suite load (see above) —
  unrelated to this task's files, not reproducible in isolation, not
  reproducible on a second full-suite run. Worth knowing about if it
  resurfaces in CI, but not something this task should "fix" by touching a
  file outside its scope.
- `deriveStage` is unconsumed in this task (see scope decision above) — a
  later task must wire it into `ExerciseRun` (replacing `stageForTier` +
  `deriveRunTier`'s tier-number path with tuple-space `presentation` reads)
  for the consolidation to actually retire `stageForTier`. Until then both
  routing paths exist and are independently tested to agree.
