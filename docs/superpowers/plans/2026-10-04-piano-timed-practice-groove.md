# Piano Timed Practice Groove Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Sheet Music Learn timed runs a clear four-pulse countdown, direct named tempo choices, adjustable click loudness, and a synchronized visual beat.

**Architecture:** Keep `ExerciseRun` and its anchored assessment timeline authoritative. Add pure projection/configuration modules for countdown, tempo stages, and click levels; feed their values into the existing CountIn overlay, WebAudio scheduler, Learn toolbar, and stage CSS without adding an independent clock.

**Tech Stack:** React 18, Vitest, Testing Library, WebAudio, SCSS, existing Chromium measurement harness.

**Spec:** `docs/superpowers/specs/2026-10-04-piano-timed-practice-groove-design.md`

## Global Constraints

- Count down `4 · 3 · 2 · 1 · PLAY`; never count upward.
- Count-in contains at most four pulses and hands off to grading without a phase break.
- Tempo choices are `Very slow` 25%, `Slow` 40%, `Steady` 60%, `Nearly there` 80%, and `Full speed` 100%.
- Mastery and Test Out remain locked to Full speed.
- Click levels are `Soft`, `Medium`, `Loud`, and `Max`; default is Loud and selection persists on the kiosk.
- Beat presentation may not obscure notation or reflow the stage and must honor `prefers-reduced-motion`.
- Do not add a second timer for countdown or visual beat state.

## Review Focus

- Very slow scores whose original full-measure count-in would exceed ten seconds still receive exactly four pulses and a deterministic grading boundary (Task 1 test).
- Tempo config bounds that exclude one or more default stages produce a non-empty valid picker and clamp the current selection (Task 2 test).
- Corrupt or unavailable local storage falls back to Loud without breaking the run (Task 3 test).
- Changing volume during an anchored run changes future gains without restarting or shifting the scheduler phase (Task 3 test).
- Countdown completion, delayed render ticks, and reduced-motion mode never announce `PLAY` twice or leave the run in countdown styling (Tasks 1 and 4 tests).

---

### Task 1: Four-Pulse Countdown Projection

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/countIn.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/countIn.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.component.test.jsx`

**Interfaces:**
- Produces: `exerciseCountInPlan({ beatsPerMeasure, gradedBpm, onsetQuarters }): { clicks, periodMs, leadInMs, pulseBpm } | null`.
- Produces: `countdownPresentation({ clicks, elapsedMs, leadInMs }): { remaining, progress, play }`.
- Later tasks consume `remaining`, `progress`, and the existing anchored timeline beat.

- [ ] **Step 1: Write failing pure tests** proving a slow triplet/eighth-note passage yields exactly four clicks, `leadInMs === clicks * periodMs`, and presentation moves `4 → 3 → 2 → 1 → PLAY` while clamping delayed ticks to one terminal `play: true` state.
- [ ] **Step 2: Run `npx vitest run src/modules/Piano/PianoKiosk/modes/SheetMusic/countIn.test.js`** and verify the new exports/tests fail.
- [ ] **Step 3: Implement the two pure functions** in `countIn.js`; reuse `askPulseQuarters`, cap clicks at four, and calculate lead-in from the selected pulse rather than a full measure.
- [ ] **Step 4: Write failing ExerciseRun tests** asserting the runtime starts with the four-pulse lead-in and the existing anchored metronome continues at the same phase/BPM after countdown.
- [ ] **Step 5: Replace ExerciseRun’s local count-in calculation** with `exerciseCountInPlan` and derive the visible countdown from the runtime’s existing countdown elapsed/remaining values.
- [ ] **Step 6: Run the two focused suites** and expect all tests to pass.
- [ ] **Step 7: Commit** with `git commit -m "fix(piano): make timed count-in four clear pulses"`.

### Task 2: Named Tempo Stage Model and Modal

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/tempoStages.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/tempoStages.test.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnTempoSheet.jsx`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnTempoSheet.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnLab.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnLab.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/sheetMusicConfig.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/sheetMusicConfig.test.js`
- Modify: `frontend/src/Apps/PianoApp.scss`

**Interfaces:**
- Produces: `TEMPO_STAGES` with ids `very-slow|slow|steady|nearly-there|full-speed` and exact percentages `25|40|60|80|100`.
- Produces: `availableTempoStages({ minimumPercent, maximumPercent }): TempoStage[]` and `nearestTempoStage(percent, stages): TempoStage`.
- Produces: `<LearnTempoSheet open stages selectedId effectiveBpm onPick onClose />`.

- [ ] **Step 1: Write failing model tests** for exact labels/percentages, the 25% default floor, bounds filtering, and nearest-stage clamping when bounds exclude the configured percentage.
- [ ] **Step 2: Run the model/config tests** and verify failures against the 40% default and missing stage model.
- [ ] **Step 3: Implement `tempoStages.js` and change `SHEET_MUSIC_DEFAULTS.learn.tempo.minimumPercent` to 25** without changing the MusicXML scaling interface.
- [ ] **Step 4: Write failing modal tests** for five direct buttons, selected state, focus return, Escape/Back close, and one `onPick(stage)` call.
- [ ] **Step 5: Implement `LearnTempoSheet.jsx`** using the repo’s existing dialog/sheet primitives and accessible button semantics.
- [ ] **Step 6: Replace LearnLab’s minus/plus controls** with a launcher showing the stage label plus effective BPM; selection updates `score.tempoPercent`, while mastery/test-out render Full speed without opening the modal.
- [ ] **Step 7: Run `tempoStages`, `sheetMusicConfig`, `LearnTempoSheet`, and `LearnLab` tests** and expect all to pass.
- [ ] **Step 8: Commit** with `git commit -m "feat(piano): add named learn tempo stages"`.

### Task 3: Persistent Metronome Loudness

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/clickLevel.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/clickLevel.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/click.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/clickScheduler.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/clickScheduler.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useMetronomeClick.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnLab.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnLab.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx`

**Interfaces:**
- Produces: `CLICK_LEVELS`, `readClickLevel(storage): ClickLevel`, and `writeClickLevel(storage, id): void` using storage key `piano.learn.click-level` and default `loud`.
- Changes: `scheduleBlipAt(ac, time, { accent, gain })` and `useMetronomeClick({ ..., gain })`.
- Changes: scheduler method `setGain(gain)` updates future scheduled beats without calling `start`.

- [ ] **Step 1: Write failing click-level tests** for four ordered levels, Loud default, round-trip persistence, unknown values, throwing storage, and unavailable storage.
- [ ] **Step 2: Run `clickLevel.test.js`** and verify failure before implementation.
- [ ] **Step 3: Implement the semantic level model and defensive storage adapter**; keep gain values below clipping and accents proportionally stronger.
- [ ] **Step 4: Write failing scheduler tests** proving gain reaches `scheduleBlip`, `setGain` changes later scheduled clicks, and neither scheduler `start` nor beat phase resets.
- [ ] **Step 5: Thread gain through `click.js`, `clickScheduler.js`, and `useMetronomeClick.js`** while preserving existing defaults for callers that omit it.
- [ ] **Step 6: Add LearnLab click-level buttons** (`Soft · Medium · Loud · Max`), persist selection, and pass resolved gain through ExerciseRun to the anchored metronome.
- [ ] **Step 7: Run click, LearnLab, and ExerciseRun component suites** and expect all to pass.
- [ ] **Step 8: Commit** with `git commit -m "feat(piano): add persistent learn click loudness"`.

### Task 4: Countdown Overlay and Synchronized Beat Treatment

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/CountInOverlay.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/CountInOverlay.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.component.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/Exercises.scss`
- Modify: `frontend/src/Apps/PianoApp.scss`

**Interfaces:**
- Consumes: Task 1 `countdownPresentation` and ExerciseRun’s existing `timeline.beat`/phase.
- Changes: `<CountInOverlay active remaining progress play />`.
- Produces: run attributes `data-beat-pulse`, `data-downbeat`, and CSS variable `--countdown-progress`.

- [ ] **Step 1: Write failing overlay tests** for accessible `Starting in 4`, descending numbers, drain progress, exactly one `PLAY` announcement, and no old `Count in, beat N` language.
- [ ] **Step 2: Run the overlay test** and verify failure against the old upward numeral API.
- [ ] **Step 3: Implement the countdown numeral, PLAY state, and draining bar** without internal timers.
- [ ] **Step 4: Write failing ExerciseRun presentation tests** asserting beat/downbeat attributes follow the existing timeline only during running timed work and clear after completion/countdown.
- [ ] **Step 5: Wire timeline-derived attributes and style the score-stage halo** with a stronger downbeat; add a non-animated reduced-motion marker and ensure the score/keyboard remain unobscured.
- [ ] **Step 6: Run overlay and ExerciseRun component suites** and expect all to pass.
- [ ] **Step 7: Commit** with `git commit -m "feat(piano): show countdown and visual beat groove"`.

### Task 5: Real-Kiosk Acceptance and Documentation

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.measure.test.jsx`
- Modify: `docs/reference/piano/sheet-music-player.md`
- Modify: `docs/reference/piano/exercise-bank.md`

**Interfaces:**
- Consumes all prior task interfaces; produces no new runtime interface.

- [ ] **Step 1: Add real-Chromium scenarios** at 1920×1200 for the tempo modal, loudness controls, `4` and `PLAY` countdown states, draining bar, running beat/downbeat treatment, reduced-motion fallback, and no overlap with notation/progress/keyboard.
- [ ] **Step 2: Run the new scenarios alone** and verify they fail if the modal, countdown, or beat treatment is removed.
- [ ] **Step 3: Update the two reference documents** to replace the twelve/upward count-in and 5% stepper contracts with the implemented named-stage, four-pulse, gain, and visual-beat behavior.
- [ ] **Step 4: Run focused unit/component suites** for `countIn`, `CountInOverlay`, `tempoStages`, `sheetMusicConfig`, `LearnTempoSheet`, `LearnLab`, `clickLevel`, `clickScheduler`, and `ExerciseRun`.
- [ ] **Step 5: Run the complete Chromium ExerciseRun measurement suite** with `npx vitest run src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.measure.test.jsx`; expect all scenarios to pass.
- [ ] **Step 6: Run `npm run build` from `frontend/`** and accept only a zero exit code; record unrelated existing warnings separately.
- [ ] **Step 7: Run `git diff --check` and review the final diff** for independent timers, hidden numeric steppers, unbounded animation, and accidental changes to non-Learn ScorePlayer controls.
- [ ] **Step 8: Commit** with `git commit -m "test(piano): verify timed practice groove UX"`.

### Task 6: Deployment Gate and Physical Verification

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes the completed implementation and repository deployment scripts.

- [ ] **Step 1: Run `./scripts/deploy-gate.sh` as a separate command.** If it reports active piano/Portal/living-room use, stop without deploying unless the user supplies a fresh explicit override.
- [ ] **Step 2: Deploy using the repository’s documented deployment command** only after the gate passes or a fresh override is given.
- [ ] **Step 3: Use `scripts/reload-piano-kiosk.sh` rather than manually clearing storage/reloading**; obey its activity gate unless freshly overridden.
- [ ] **Step 4: Open the Jesu passage timed Learn rung on the physical piano tablet** and verify four descending pulses, PLAY boundary, audible selected click level, named tempo modal reaching Very slow, synchronized visual beat, and readable complete grand staff.
- [ ] **Step 5: Capture a Fully Kiosk screenshot and query the session log** for countdown pulse count, lead-in duration, tempo stage, and click level; do not claim deployment complete without both visible and logged evidence.
