# ExerciseRun UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the exercise/challenge surface around presentation tiers and a config-driven graded repertoire, so a gate challenge is readable by the child it stands in front of — from a preschooler's lit keys to a cued scale to four bars of real sheet music.

**Architecture:** A pure repertoire module replaces the five-axis ladder (`{levelId}` rungs walking an ordered, config-driven level list with a built-in fallback). Presentation is tier-driven: tiers 0–1 render lit keys (no/small staff), tier 2 renders an SVG sequence staff with ghost-note feedback (extension of the house `SvgStaffRenderer`), tier 3 keeps ABC engraving for cued rhythm. Free asks auto-arm on the first correct note; cued asks arm on any key and run a one-measure metronome count-in. The `score` material kind compiles MusicXML passages through the existing `compileScoreExpectation` range support.

**Tech Stack:** React 18, vitest (+ `@testing-library/react`, happy-dom), Playwright + `sass-embedded` for rendered-DOM measurement (the `GameGate.measure.test.jsx` harness), abcjs via `AbcRenderer` (cued only), OSMD via `MusicXmlRenderer` (score kind), hand-rolled SVG staff via `SvgStaffRenderer`.

**Spec:** `docs/superpowers/specs/2026-08-28-exercise-run-ux-design.md`
**Bug report this answers:** `docs/_wip/bugs/2026-08-28-match-gate-challenge-is-unreadable.md`

## Global Constraints

- Tier table (spec): tier 0 keys/no staff, tier 1 keys+small staff, tier 2 staff-first single staff, tier 3 tier-2+count-in/cued. The rung decides what the screen IS.
- Grading: **completeness-only through tier 2** — child contract: *"Play all the notes, in order. Wrong ones don't count against you."* Rubric `{ criteria: { completeness: 1 } }`, `passScore: null`, pass = `verdict.passed` (the existing floor contract, promoted). Cleanliness/placement only where a level's `grading` block says so (tier 3).
- **D9 preserved:** a built-in unfailable tier-0 floor sits beneath whatever the config declares; no config can remove it.
- Start model: free = auto-arm on first **correct** note, no button; cued = *"Press any key to start"* → one-measure metronome count-in with visible countdown → play, placement graded. The "Begin challenge" button and the "tempo and pass criteria are fixed for this run" copy are deleted.
- Repertoire is config-driven (`gameGate.repertoire`), levels easiest-first; built-in fallback level = C major scale RH (`scales/modes@root=C,mode=ionian,direction=up,span_octaves=1` — verified live, 8 events C60→C72). Rotation: no immediate repeat within a level (`lastMaterialId` in rung state).
- Material kinds `keys | exercise | score` — `kind` is the discriminator; a level may mix kinds.
- Engraving accountability (spec rules 1–6): clef chosen never defaulted (hand → `staff` key → pitch range); staff count = hands in use; notes in viewport; cursor legible; **played notes ghost semi-transparently on the staff at true position** (benchmark: `SvgStaffRenderer` ghosts); one engraver per job (SVG sequence staff for free, ABC for cued, OSMD for score; `generateAbc` grand-staff serves nothing here); rendered DOM is the authority.
- Mode vocabulary `free | cued` — never a matcher name.
- No raw `console.*` — structured logger only (`frontend/src/lib/logging/Logger.js`).
- Unchanged: gate host state machine (fail-open on infrastructure, `no-access` non-granting, D12), budget meter, persistence/evidence pipeline, `runPassed` contract, `onUnavailable`/`onFailed` contracts, `gateStateKey` (`piano.game-gate.rung.{learnerId}`).
- Every gate event still carries `learnerId, deviceId, studyDate, sessionId`; `gate.rung-changed` payload becomes `{ from: levelId, to: levelId, direction: 'degrade'|'climb' }`.
- Test invocation: `npx vitest run --config vitest.config.mjs <paths>` from the worktree root.

## Verified facts (do not re-derive; re-verify only if something contradicts them)

- Bank instance id format: `scales/modes@root=C,mode=ionian,direction=up,span_octaves=1`; axes `root` (12 values), `mode` (7), `direction` (`up`/`down`), `span_octaves`; `ordering: strict`, `staff: treble`, `tempo.start_bpm: 60`, `supports: [free, metronome, cued]`, events carry `value: 8th`, `hand: right`. `pianoLearningApi.instance(id)` splits on `@` and turns the axes into a query string (`modes/Exercises/pianoLearningApi.js:21-25`).
- `SvgStaffRenderer({ targetPitches, activeNotes, matched })` at `frontend/src/modules/MusicNotation/renderers/SvgStaffRenderer.jsx` — clef from first pitch (C4+ treble), ledger lines, accidentals, ghost notes at 50% opacity excluding targets, `.action-staff__*` markup, exported `STAFF_ASPECT`. Consumers: `ActionStaff`, `StaffNoteLabel`.
- `countInPlan({ beats, bpm, tempoMult })` at `modes/SheetMusic/countIn.js:59`; `CountInOverlay({ active, beat })` at `modes/SheetMusic/CountInOverlay.jsx`.
- Runtime: `createAssessmentRuntime(...)` exposes `start({ leadInMs, clock })`, `observe({ midi, time, clock })`; `ExerciseRun.start` currently hardcodes `leadInMs = 2000` for cued.
- `compileScoreExpectation({ notes, source, tempoMap, fallbackBpm, activeParts, range })` at `performance/assessmentAttempt.js:102`; `range` filters by `measureIndex` (`:121`). `createAssessmentAttempt` accepts a compiled expectation directly. `ScorePlayer.jsx:710-719` shows the notes shape (`{...note, onsetQuarter, measureIndex}` from OSMD layout steps).
- MusicXML loading: `SheetMusic.jsx:127` hands `ScorePlayer` `{ id, musicXml }` with raw XML fetched from the media stream endpoint (see `SheetMusic.jsx` upstream of `:127` for the exact fetch; `SheetMusic.test.jsx:115` pins it). Engraving: `MusicXmlRenderer` (`modules/MusicNotation/renderers/MusicXmlRenderer.jsx`) with `onLayout` returning `{ events, notes, steps, measures, tempoEntries, ... }`.
- `gateConfigForLearner(raw, learnerId)` (`modes/Games/gateScope.js`) already merges `users.{id}` key-over-key and strips `users`; `gameGate` is whole-node threaded through `pianoConfigModel.js` — new keys (`repertoire`, `startLevel`) arrive without resolver work.
- `gameGateLadder.js` consumers: `GameGate.jsx`, `gateMaterial.js` (comment only), `gameGateLadder.test.js`, `GameGate.test.jsx`, `gateEvents.test.jsx`, `ExerciseRun.component.test.jsx` (the D9 floor regression test imports `requirementForRung`).
- The office screen (`PianoVisualizer`) and practice/program-challenge callers of `ExerciseRun` must keep working; `Exercises.jsx:396-421` is the practice mount (URL-driven), `GameGate.jsx` the gate mount (prop-driven).

## File Structure

```
frontend/src/modules/Piano/PianoKiosk/modes/Games/
  gateRepertoire.js        NEW  pure: config → levels, walk, rotation, fallback, floor
  gateAsk.js               NEW  pure: level+material → requirement + plain-words ask
  gameGateLadder.js        DELETED (axes die; D9 floor moves to gateRepertoire)
  GameGate.jsx             MODIFIED  rung-state v2, resolve via repertoire, events
  gateMaterial.js          MODIFIED  keys kind, exercise-by-spec picking, score kind
frontend/src/modules/MusicNotation/renderers/
  SvgSequenceStaff.jsx     NEW  ordered noteheads, cursor, ghosts (extends house engraver)
frontend/src/modules/Piano/PianoKiosk/modes/Exercises/
  ExerciseRun.jsx          MODIFIED  tiers, framing, auto-arm, count-in, chrome rewrite
  KeysAsk.jsx              NEW  tier 0–1 lit-keyboard ask
  exerciseAbc.js           MODIFIED  ordering:any never grand-staff; staff-key clef fallback
  ScorePassage.jsx         NEW  score-kind engraving + note extraction (OSMD)
```

---

### Task 1: The repertoire — `gateRepertoire.js`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateRepertoire.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateRepertoire.test.js`

**Interfaces — Produces (pure, no fetching):**

```js
BUILT_IN_FLOOR   // { id:'floor-key', tier:0, grading:null, material:[{ kind:'keys', notes:1, arrangement:'together' }] }
FALLBACK_LEVEL   // { id:'fallback-c-major', tier:2, grading:null,
                 //   material:[{ kind:'exercise', instanceId:'scales/modes@root=C,mode=ionian,direction=up,span_octaves=1' }] }
resolveRepertoire(raw) → Level[]
  // raw = gameGate.repertoire from config. Valid levels only (id string, tier 0-3,
  // material non-empty array of objects with a string kind). No valid levels →
  // [FALLBACK_LEVEL]. ALWAYS appends BUILT_IN_FLOOR beneath index 0 unless the
  // first level is already tier 0 with null grading (D9: unfailable floor exists
  // regardless of config). Result ordered easiest-first.
levelById(levels, id) → Level | null
startLevelFor(levels, config) → Level      // config.startLevel if found, else levels[1] ?? levels[0]
degradeLevel(levels, id) → Level           // one index down; clamps at 0 (the floor)
climbLevel(levels, id) → Level             // one index up; clamps at top
isFloorLevel(levels, id) → boolean         // index 0
pickMaterial(level, lastMaterialId, pickIndex) → spec
  // deterministic rotation: candidates = level.material; if length > 1, drop the
  // one whose materialKey equals lastMaterialId; return candidates[pickIndex % length].
materialKey(spec) → string                 // stable identity: kind + instanceId/collection+roots/source+measures
```

- [ ] **Step 1: Write failing tests** — table-driven:

```js
import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_FLOOR, FALLBACK_LEVEL, resolveRepertoire, levelById, startLevelFor,
  degradeLevel, climbLevel, isFloorLevel, pickMaterial, materialKey,
} from './gateRepertoire.js';

const CONFIG = [
  { id: 'L1', tier: 2, material: [{ kind: 'exercise', collection: 'scales', roots: ['C'], hands: 'right' }] },
  { id: 'L2', tier: 2, material: [
    { kind: 'exercise', collection: 'scales', roots: ['G'], hands: 'right' },
    { kind: 'exercise', collection: 'scales', roots: ['D'], hands: 'right' },
  ] },
  { id: 'L7', tier: 3, grading: { cleanliness: 0.8 }, material: [{ kind: 'exercise', collection: 'scales', roots: ['C'], cued: true }] },
];

describe('resolveRepertoire', () => {
  it('prepends the built-in floor so no config can remove D9', () => {
    const levels = resolveRepertoire(CONFIG);
    expect(levels[0]).toEqual(BUILT_IN_FLOOR);
    expect(levels.map((l) => l.id)).toEqual(['floor-key', 'L1', 'L2', 'L7']);
  });
  it('keeps a config-authored tier-0 unfailable floor as THE floor', () => {
    const withFloor = [{ id: 'keys-1', tier: 0, material: [{ kind: 'keys', notes: 1 }] }, ...CONFIG];
    expect(resolveRepertoire(withFloor)[0].id).toBe('keys-1');
  });
  it.each([undefined, null, [], 'yes', 42, [{ id: 'bad' }], [{ tier: 2, material: [] }]])(
    'falls back to the built-in C major level on unusable config (%s)', (raw) => {
      const levels = resolveRepertoire(raw);
      expect(levels.map((l) => l.id)).toEqual(['floor-key', 'fallback-c-major']);
    });
});

describe('the walk', () => {
  const levels = resolveRepertoire(CONFIG);
  it('every degrade changes the level id until the floor, then holds', () => {
    let level = levelById(levels, 'L7');
    const walk = [];
    for (let i = 0; i < 6; i += 1) { level = degradeLevel(levels, level.id); walk.push(level.id); }
    expect(walk).toEqual(['L2', 'L1', 'floor-key', 'floor-key', 'floor-key', 'floor-key']);
  });
  it('climb is the inverse and clamps at the top', () => {
    expect(climbLevel(levels, 'floor-key').id).toBe('L1');
    expect(climbLevel(levels, 'L7').id).toBe('L7');
  });
  it('isFloorLevel is true only at index 0', () => {
    expect(isFloorLevel(levels, 'floor-key')).toBe(true);
    expect(isFloorLevel(levels, 'L1')).toBe(false);
  });
  it('startLevelFor honors config.startLevel and defaults above the floor', () => {
    expect(startLevelFor(levels, { startLevel: 'L2' }).id).toBe('L2');
    expect(startLevelFor(levels, {}).id).toBe('L1');
    expect(startLevelFor(resolveRepertoire(null), {}).id).toBe('fallback-c-major');
  });
});

describe('rotation', () => {
  const l2 = levelById(resolveRepertoire(CONFIG), 'L2');
  it('never serves the same material twice running within a level', () => {
    const first = pickMaterial(l2, null, 0);
    const second = pickMaterial(l2, materialKey(first), 1);
    expect(materialKey(second)).not.toBe(materialKey(first));
  });
  it('a single-material level serves its one spec regardless', () => {
    const l1 = levelById(resolveRepertoire(CONFIG), 'L1');
    expect(pickMaterial(l1, materialKey(l1.material[0]), 3)).toEqual(l1.material[0]);
  });
});
```

- [ ] **Step 2: Run to verify failure** (module not found). `npx vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Games/gateRepertoire.test.js`
- [ ] **Step 3: Implement** (~90 lines, pure; no imports beyond nothing — it is data logic).
- [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): the gate repertoire — config-driven levels with an unremovable floor"`

---

### Task 2: The ask — `gateAsk.js`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateAsk.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateAsk.test.js`

**Interfaces — Produces (pure):**

```js
requirementForLevel(level) → requirement
  // tier 0-2 (grading null/absent): { mode:'free', rubric:{ criteria:{ completeness:1 } }, passScore:null }
  // tier 3 or grading present: { mode:'cued', rubric:{ criteria:{ completeness:1, cleanliness: grading.cleanliness ?? 0.8 } },
  //                              passScore:null }   // pass stays verdict-driven; thresholds live in the rubric
askForMaterial(spec, instance?) → string
  // keys, notes:1                          → 'Press the lit key.'
  // keys, notes>1, arrangement:'together'  → 'Play these notes together.'
  // keys, notes>1, arrangement:'sequence'  → 'Play the lit keys in order.'
  // exercise (instance given)              → e.g. 'C major scale, right hand.' from axes/hand
  //                                          (root + mode label + 'scale', hand when single-hand)
  // score                                  → 'Play this passage as written.'
framingFor(context) → string
  // { kind:'gate', gameLabel:'Piano Chess' } → 'Play this to start Piano Chess'
  // { kind:'program', stepLabel }            → 'Pass this to finish ' + stepLabel
  // { kind:'practice' } (or null)            → null   (practice keeps the exercise title as its headline)
```

The rubric-carried cleanliness (not `passScore`) is deliberate: the engine already fails
any criterion present in the requirement's own rubric (`assessmentAttempt.js:497-498`),
so a cued level fails on cleanliness below threshold through `verdict.passed` — one pass
signal everywhere, and `runPassed`'s floor path handles every level. **Do not add
`cleanliness` to a tier 0–2 rubric** (D9).

- [ ] **Step 1: Write failing tests** — pin all three requirement shapes verbatim (`toEqual`); the D9 test name from the previous wave applies: `a free level's rubric omits cleanliness so a stray key cannot fail it`; ask strings for each material row above, including the exercise case built from a real instance fixture (`axes: { root:'C', mode:'ionian' }`, all `hand:'right'` → `'C major scale, right hand.'`); framing rows for all three contexts.
- [ ] **Step 2: Verify failure. Step 3: Implement** (~70 lines). **Step 4: Verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): a level becomes a requirement and a sentence a child can read"`

---

### Task 3: `SvgSequenceStaff` — ordered noteheads, cursor, ghosts

**Files:**
- Create: `frontend/src/modules/MusicNotation/renderers/SvgSequenceStaff.jsx`
- Test: `frontend/src/modules/MusicNotation/renderers/SvgSequenceStaff.test.jsx`

**Interfaces — Produces:**

```jsx
<SvgSequenceStaff
  notes={[{ midi:60 }, { midi:62 }, …]}   // ordered; simultaneous asks pass one entry with midis:[...]
  cursorIndex={2}                          // notes < index done, === index next, > index todo
  wrongMidi={61 | null}                    // ghost the played wrong note at true position
  activeNotes={Map | null}                 // held keys ghost at 50% like SvgStaffRenderer
  clef={'treble' | 'bass' | null}          // null → derived from majority pitch (rule 1)
/>
```

Build on the same primitives `SvgStaffRenderer` uses (import the staff-position model it
imports — read its import block and reuse, do not fork the math). Emit `.action-staff__*`
markup plus per-note state classes `sequence-note-done|next|todo|wrong-ghost` so SCSS and
tests share a vocabulary. One staff, always; clef per rule 1 (explicit prop → derived).
Accidentals and ledger lines come from the shared model, as `StaffNoteLabel` proves.

- [ ] **Step 1: Failing tests** (jsdom sees SVG *structure*): exactly one clef glyph and it is treble for an all-C4+ sequence, bass for an all-below-C3 sequence; note count equals input; classes follow `cursorIndex`; `wrongMidi` renders one extra ghost notehead with the ghost class and does not disturb the target count; no second staff ever (`querySelectorAll` on the staff group === 1).
- [ ] **Step 2–4: Fail → implement (~120 lines) → pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(notation): a sequence staff that shows the wrong note where it actually is"`

---

### Task 4: `KeysAsk` — the tier 0–1 lit-keyboard ask

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/KeysAsk.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/KeysAsk.test.jsx`

**Interfaces — Produces:**

```jsx
<KeysAsk
  events={instance.events}      // the ask, same event shape the engine grades
  cursorIndex={n}               // sequence asks light one event at a time; together-asks light all
  activeNotes={Map}
  wrongMidi={m|null}
  showStaff={false|true}        // tier 1 adds a small SvgSequenceStaff above the keys
/>
```

Renders a **large** `PianoKeyboard` (existing component; `targetNotes` lights the current
event's notes, `wrongNotes` reds a wrong press — both already exist) with a numbered badge
row for in-order asks (1…n above the lit keys, done ones dimmed). Range = ask range ±3
semitones, clamped like `ExerciseRun` does today (`Math.max(21, min-5)` idiom). No
percentages anywhere in this component.

- [ ] **Step 1: Failing tests:** together-ask lights all target midis at once; sequence-ask lights only event `cursorIndex`'s notes; badges render 1…n and advance; `showStaff` toggles the presence of the `SvgSequenceStaff` (mock it, assert the boundary + props); wrong press flows through to `wrongNotes`.
- [ ] **Step 2–4: Fail → implement (~80 lines) → pass.** **Step 5: Commit** — `git commit -m "feat(piano): the lit-keys ask — a challenge a preschooler can read"`

---

### Task 5: Start model — auto-arm and the one-measure count-in

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx` (the `start` callback, the ready-phase JSX, the note-observation effect)
- Test: extend `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.component.test.jsx`

**Behaviour contract:**

1. **Free:** no ready button. While `snapshot.status === 'prepared'`, incoming note-ons are
   watched; when one matches the first expected midi, call `runtime.start({ leadInMs: 0, clock: 'date-now' })`
   **then** `runtime.observe({ midi, time, clock: 'date-now' })` with that same note, in
   that order, so the arming note is also the first graded note. A non-matching note-on in
   `prepared` does nothing (it is a child finding their hands, not a wrong answer).
2. **Cued:** ready panel says *"Press any key to start. You'll hear {beats} clicks, then
   play at that speed."* ANY note-on in `prepared` calls
   `runtime.start({ leadInMs: measureMs, clock: 'date-now' })` where
   `measureMs = beatsPerMeasure * 60000 / bpm` (beats from `instance.meter`, default 4;
   bpm from the existing `clickBpm`). The arming key is NOT observed. Countdown UI uses
   the existing countdown state driven by `leadInMs` (replace the hardcoded `2000`);
   render `CountInOverlay` (`modes/SheetMusic/CountInOverlay.jsx`) with the beat derived
   from remaining lead-in — reuse `countInPlan({ beats, bpm })` from
   `modes/SheetMusic/countIn.js` for the beat schedule rather than reinventing it.
3. The metronome click during count-in comes from the existing `useMetronomeClick`
   (already enabled for cued running state — extend its `enabled` to cover the lead-in
   window).
4. Delete: the "Begin challenge"/"Begin practice" button and the ready copy block
   (practice keeps a one-line ready hint: *"Play the first note to begin."*).

- [ ] **Step 1: Failing tests** (extend the existing harness, which drives notes through the runtime double): free ask — feeding the first expected note starts and grades it (assert attempt consumed it: cursor advanced); feeding a *wrong* note first does nothing (status still `prepared`, no wrong flash); cued ask — any note starts a lead-in of one measure at the instance bpm (assert `start` called with `leadInMs: 4 * 60000/60` for the 4/4\@60 fixture) and the arming note was not observed; no button exists in either mode (`queryByRole('button', { name: /begin/i })` null).
- [ ] **Step 2–4: Fail → implement → pass**, then run the whole Exercises directory — practice flows must stay green apart from the deleted-button assertions, which change with the diff.
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): the piano starts the attempt — no button between a child and eight notes"`

---

### Task 6: Tier-driven presentation and chrome

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx` (header, stage selection, chips, result panel)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/Exercises.scss` (tier layouts)
- Test: extend `ExerciseRun.component.test.jsx`

**Behaviour contract:**

- New props: `framing = null` (string, from Task 2's `framingFor`), `tier = null`
  (0–3; `null` = legacy callers → derive: cued requirement → 3, else 2).
- Header: `Exit · [framing ?? intent-label] · ask` — the ask line (from `gateAsk`'s
  `askForMaterial`, passed as prop `ask`; practice callers omit it and keep the
  exercise title). Chips: `Key of {instance.key}` only when a staff is shown (tiers
  1–3), labeled exactly so; meter chip only when cued; BPM chip only when a pace gate
  exists (existing condition). The bare `{instance.key}` span is deleted.
- Stage by tier: 0 → `KeysAsk` (no staff), 1 → `KeysAsk showStaff` (small
  `SvgSequenceStaff`), 2 → `SvgSequenceStaff` primary + existing keyboard footer,
  3 → `ExerciseNotation` (ABC) + keyboard footer, as today. `wrongMidi` =
  `lastWrong?.midi` flows into whichever stage renders (rule 4 ghosts).
- Result panel: tiers 0–1 render pass/fail copy with **no percentages**; tiers 2–3 keep
  the score readout. `hostOwnsFailure` behaviour unchanged.
- Practice compat: practice callers (no `tier` prop) with `ordering:'any'` material now
  render tier-appropriate keys+staff (`KeysAsk showStaff`) instead of the grand staff —
  this is the deliberate practice-surface change; sequential practice derives tier 2/3
  as above and looks the same as before except the corrected chrome.

- [ ] **Step 1: Failing tests:** framing renders when given and the intent label when not; ask line present before start in every tier; `Key of C` labeled and absent at tier 0; per-tier stage boundary (mock `KeysAsk`/`SvgSequenceStaff`/`ExerciseNotation`, assert exactly one mounts per tier and receives `wrongMidi`); tier-0 result panel contains no `%` character; practice `ordering:any` fixture mounts `KeysAsk`, not `ExerciseNotation`.
- [ ] **Step 2–4: Fail → implement → pass**, then the full Exercises + Games directories.
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): the rung decides what the screen is"`

---

### Task 7: Notation routing — the grand staff serves nothing here

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/exerciseAbc.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/exerciseAbc.test.js` (new)

**Behaviour contract:** `instanceToAbc` no longer imports or calls `generateAbc`. The
`ordering:'any'` branch is deleted (those instances render through `KeysAsk`/
`SvgSequenceStaff` after Task 6; ABC is cued-only). The single-voice branch gains the
rule-1 clef chain: explicit `hand` → `instance.staff` → pitch-range majority (below
middle C → bass). `generateMelodyAbc` (two genuine hands) is untouched.

- [ ] **Step 1: Failing tests** (string-level unit guards; the rendered-DOM authority is Task 10): an all-right-hand strict instance yields exactly one `V:` line with `clef=treble` and no `V:LH`; a hand-less instance with `staff: bass` yields `clef=bass`; a hand-less, staff-less instance with median pitch 48 yields `clef=bass`; `ordering:'any'` input returns `''` (and `ExerciseNotation` renders nothing for it — one assertion in its spec).
- [ ] **Step 2–4: Fail → implement → pass.** **Step 5: Commit** — `git commit -m "fix(notation): exercise engraving picks its clef and never borrows the live grand staff"`

---

### Task 8: `GameGate` on the repertoire

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Games/GameGate.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateMaterial.js` (`keys` kind + exercise-by-spec picking)
- Delete: `frontend/src/modules/Piano/PianoKiosk/modes/Games/gameGateLadder.js`, `gameGateLadder.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Games/Games.jsx` (pass `gameLabel` to `GameGate`)
- Test: update `GameGate.test.jsx`, `gateEvents.test.jsx`, and the D9 floor regression test in `ExerciseRun.component.test.jsx` (moves onto `requirementForLevel`)

**Behaviour contract:**

- Rung state v2 at the same key: `{ levelId, failuresAtLevel, cleanPasses, lastMaterialId }`.
  `readGateState` validates `levelId` against the resolved repertoire; anything else —
  including every old five-axis rung — resets to `startLevelFor(levels, config)`.
  Persisted writes carry `lastMaterialId` from the served material.
- Resolve: `levels = resolveRepertoire(config.repertoire)` → `level = levelById(state.levelId)`
  → `spec = pickMaterial(level, state.lastMaterialId, attemptCount)` → material:
  - `kind:'keys'` → **no fetch**: synthesize an instance locally in `gateMaterial.js`
    (`keysInstance(spec)`: `notes:1` → one random white key C4–B4; dyad → two lit keys a
    third–fifth apart; `arrangement:'together'` → one event with n notes,
    `'sequence'` → n single-note events; `ordering` `'any'`/`'strict'` to match). Seeded
    from `pickIndex` so tests are deterministic.
  - `kind:'exercise'` with `instanceId` → existing `resolveGateMaterial` path; with
    `collection/roots/hands` → build the instance id for the scales bank
    (`scales/modes@root={root},mode=ionian,direction=up,span_octaves=1`) choosing a root
    by rotation; other collections resolve through the existing `instances()` +
    `supports` filter path.
  - `kind:'score'` → Task 9 (until then the existing `score-material-phase-2` refusal
    stands and fails open — unchanged behaviour).
- Requirement: `requirementForLevel(level)` (Task 2); ask: `askForMaterial(spec, instance)`;
  `tier` and `ask` and `framing` (`framingFor({ kind:'gate', gameLabel })`) flow into
  `ExerciseRun` as props. `Games.jsx` passes `gameLabel={entry?.label ?? gameId}`.
- Ladder movement: unchanged counters (`retriesBeforeDegrade`, `climbAfterCleanPasses`,
  abandonment never moves it), but over `degradeLevel`/`climbLevel`. `gate.rung-changed`
  emits `{ from, to, direction }`; `gate.floor-reached` fires on arriving at
  `isFloorLevel` — once per arrival, as today. All events keep the four identity fields.
- The banner copy *"We made it a little easier"* is now always TRUE (every degrade
  changes the level) — keep it.

- [ ] **Step 1: Failing tests** — update in place: rung-v2 persistence + old-shape reset (corrupt table gains a five-axis rung entry asserting reset-to-start); degrade walk L2→L1→floor with `rung-changed {from,to,direction:'degrade'}` payloads; rotation (two consecutive gates at L2 serve different roots — assert via the resolved instance ids in `runProps`); keys-kind floor serves a synthesized one-key instance with no network call (assert `instances`/`instance` fetch mocks uncalled); `framing`/`ask`/`tier` reach the mocked `ExerciseRun`; D9 regression test re-pointed at `requirementForLevel(BUILT_IN_FLOOR)` keeps its name and its teeth (completed run with 3 wrongs still passes).
- [ ] **Step 2–4: Fail → implement → pass**, then the full Games directory.
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): the gate walks a real repertoire — every step down is a step a child can feel"`

---

### Task 9: The `score` material kind

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateMaterial.js` (score branch resolves; `score-material-phase-2` retires)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx` (score-kind stage + attempt path)
- Test: `ScorePassage.test.jsx` + extend `gateMaterial.test.js`

**Behaviour contract:**

- `resolveGateMaterial({ kind:'score', source, measures:[start,end] })` fetches the
  MusicXML the way `SheetMusic.jsx` does (read its fetch above `:127` and reuse the
  endpoint — do not invent a new one), returning
  `{ ok:true, kind:'score', score:{ id: source, musicXml, measures } }`. Fetch failure →
  `{ ok:false, error:'score-unavailable' }` (gate fails open, as all infrastructure does).
- `ScorePassage` mounts `MusicXmlRenderer` with the xml; `onLayout` yields notes/steps;
  it calls `onExpectation(compileScoreExpectation({ notes: <ScorePlayer.jsx:711-716 shape>,
  source:{ id }, tempoMap, range:{ start, end } }))` once layout settles, and renders the
  engraved passage (the measure range visually focused; out-of-range measures may render
  dimmed — do not build scroll/zoom polish).
- `ExerciseRun`: score material renders `ScorePassage` as the stage; the attempt is
  created from the compiled expectation directly
  (`createAssessmentAttempt({ expectation, matcher: mode==='cued'?'timed':'cursor', mode, requirement })`
  — the engine accepts this; `prepareExerciseAssessment` is bank-only and is not called).
  Free = completeness cursor through the passage; cued = timed with the score's tempo.
  Cursor feedback on the engraving: reuse the note-element classes the SheetMusic layers
  use (`NoteHighlightLayer` shows the pattern) at minimum viable fidelity — current-note
  highlight and wrong flash; no measure grades, no ink layers.
- [ ] **Step 1: Failing tests:** `resolveGateMaterial` score branch returns ok with xml (fetch mocked) and `score-unavailable` on failure; `ScorePassage` with a 4-bar fixture XML calls `onExpectation` whose `events` all carry `measureIndex` within range; `ExerciseRun` given score material builds an attempt from the expectation (spy on `createAssessmentAttempt`, assert no `prepareExerciseAssessment` call) and completes a free run when the expected midis are fed.
- [ ] **Step 2–4: Fail → implement → pass.** This is the heaviest task; if OSMD-in-happy-dom cannot engrave, mock `MusicXmlRenderer` at the boundary and let Task 10's Playwright scenario carry the real-engraving assertion — say which happened in the report.
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): four bars of real music can stand at the gate"`

---

### Task 10: Rendered-DOM authority — the per-tier Playwright spec

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.measure.test.jsx`
- Test: itself (the `GameGate.measure.test.jsx` harness: happy-dom produces markup, `sass-embedded` compiles the real SCSS, headless Chromium measures; fails closed if Chromium is absent)

**Scenarios (one per tier + score), each asserting the engraving-accountability rules on the real rendered DOM:**

- Tier 0 (keys, one note): **zero** staves; lit key present; ask line (*"Press the lit key."*) visible before any input; no start button.
- Tier 1 (dyad + small staff): exactly one staff; clef glyph treble for a C4+ dyad; both target noteheads inside the staff group's bounding box.
- Tier 2 (C major RH scale): one staff, treble clef; 8 noteheads inside the staff box; cursor class on notehead 0; after simulating one correct + one wrong note (drive the same runtime double the component tests use): cursor on notehead 1 and one `wrong-ghost` notehead present at a distinct vertical position; no `%` on screen at tier 0 vs `%` present at tier 2's result.
- Tier 3 (cued): count-in overlay present after a key press; one staff; BPM chip present.
- Score (4-bar fixture): the OSMD engraving mounts and the in-range measures render (skip-with-stated-reason if Chromium OSMD proves unworkable — then the assertion lands as a component test with real `MusicXmlRenderer` in Chromium via `page.setContent` of the engraved HTML).
- [ ] **Steps: write → run (3× to prove stability) → commit** — `git commit -m "test(piano): the screen a child sees is now the thing under test"`

---

### Task 11: Config, docs, sweeps, live smoke

**Files:**
- Modify: `docs/reference/piano/games-budget-gate.md` (repertoire config section, new `rung-changed` payload, retire the Phase-2 score note, tier table)
- Modify: `docs/_wip/bugs/2026-08-28-match-gate-challenge-is-unreadable.md` (append resolution)
- Live: `data/household/piano/config.yml` via `sudo docker exec` heredoc (repertoire block + `users.kckern.startLevel: L1`), container restart, smoke

- [ ] **Step 1:** Reference doc: replace the ladder/axes section with the tier table and the repertoire config (mark `every` still unconsumed if it remains so); document the fallback and the unremovable floor; update the event table. Bug report gains a `## Resolution` section mapping each of the 14 issues to what shipped.
- [ ] **Step 2:** Sweeps: full `frontend/src/modules/Piano/` (expect ≥ current 378 files green), the Games + Exercises directories, and `npm run test:unit:vitest` once — a NEW failing file in this plan's files is yours; known roaming flakes and the pre-existing `band.measure`/`GetRecentCourseActivity` failures are not. Do not baseline anything.
- [ ] **Step 3:** Deploy per house rules (gate → build → gate → deploy), then live smoke as `kckern` on chess: C major scale renders one treble staff; wrong notes ghost and do not fail; completing the scale opens chess; the next gate serves a different root at L2; `gate.rung-changed` events carry `{from,to,direction}` in the log store.
- [ ] **Step 4: Commit** — `git commit -m "feat(piano): gate challenges children can read — config, reference, and the receipts"`

---

## Self-review (performed while writing)

- **Spec coverage:** tier table → Tasks 4/6; repertoire+fallback+floor → Task 1; grading contract → Task 2 (D9 test carried); ask model arrive/start/running/done → Tasks 5/6; material kinds → Tasks 1/8 (`keys`), 8 (`exercise`), 9 (`score`); rotation → Tasks 1/8; notation rules 1–3 → Tasks 3/7; rule 4 ghosts → Tasks 3/6; rule 5 one-engraver → Tasks 6/7/9; rule 6 rendered authority → Task 10; chrome/copy → Task 6; ladder mechanics/state/events → Task 8; config-driven + `startLevel` → Tasks 1/8/11 (threading already exists — verified); "what does not change" → constraint block, enforced by reusing existing contracts.
- **Placeholder scan:** none; the two deliberate escape hatches (OSMD-in-happy-dom fallback in Task 9, OSMD-in-Chromium fallback in Task 10) name their conditions and their alternate assertion homes.
- **Type consistency:** `Level { id, tier, grading, material }` consistent across Tasks 1/2/8; `requirementForLevel` (not `ForRung`) everywhere; rung-state v2 field names identical in Tasks 8's read/write/tests; `wrongMidi` prop name identical in Tasks 3/4/6; `framing`/`ask`/`tier` prop names identical in Tasks 2/6/8.
- **Known risk, stated:** Task 9 is the widest task; its boundary-mock escape hatch keeps it landable without dragging OSMD internals into the plan.
