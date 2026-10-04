# Sheet Music Learn Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engraved score the Learn roadmap and config-driven passage `ExerciseRun`s the training modules.

**Architecture:** Pure planners normalize the Learn program, split the score, and project progress. A small Learn host owns roadmap/run navigation and persistence while `ExerciseRun` remains the assessment surface. Existing score rendering, assessment evidence, and drill-progress components are reused.

**Tech Stack:** React 18, React Router 6, Vitest, MusicXML/OSMD, Express data-store router.

**Spec:** `docs/superpowers/specs/2026-10-03-sheetmusic-learn-roadmap-design.md`

## Global Constraints

- Ladder behavior is config-driven; only overridable defaults are hardcoded.
- Default passages target four measures and remain stable.
- Default normal ladder is RH 2×3, LH 2×3, together-free 2×3, together-cued 1×3.
- Default Test Out is always available and requires three consecutive two-hand cued passes.
- Use structured logging, preserve guest access, and do not alter Listen, Polish, or Perform.

## Review Focus

- Scores without a conventional two-staff grand staff must not expose impossible hand rungs.
- Rehearsal regions of 1, 2, 5, 6, and 9 measures must not produce accidental one-bar tails.
- Config changes must not reuse incompatible completed-rung state.
- A failed Test Out must reset only its own streak.
- Partial progress PUTs must preserve sibling passages/rungs and reject unsafe keys.

---

### Task 1: Normalize the Learn program and plan passages

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/sheetMusicConfig.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/learnRoadmap.js`
- Test: adjacent `*.test.js` files

**Interfaces:**
- Produces: `resolveSheetMusicConfig(raw).learn`, including `passages`, normalized `ladder`, and `revision`.
- Produces: `buildLearnPassages({ sections, measures, steps })` and progress projection helpers.

- [ ] Write failing config and passage-planner tests covering defaults, overrides, invalid fallback, balanced regions, rehearsal boundaries, and empty passages.
- [ ] Run the focused tests and verify the new assertions fail.
- [ ] Implement the normalizer and pure roadmap planner.
- [ ] Run the focused tests and commit the passing task.

### Task 2: Persist passage/rung progress safely

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/usePracticeRecord.js`
- Modify: `backend/src/4_api/v1/routers/piano.mjs`
- Test: frontend hook and backend practice endpoint tests

**Interfaces:**
- Consumes: passage IDs and ladder revision from Task 1.
- Produces: `recordLearnRep({ revision, passageId, rungId, result, consecutive, completesPassage })` and session-local guest updates.

- [ ] Write failing tests for cumulative reps, Test Out reset, passage completion, guest session state, deep merging, fingerprint replacement, and unsafe keys.
- [ ] Run both focused suites and verify expected failures.
- [ ] Implement frontend record transitions and backend nested merging.
- [ ] Run both focused suites and commit the passing task.

### Task 3: Make score ExerciseRuns part-aware and practice-gradable

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ScorePassage.jsx`
- Test: their focused component tests

**Interfaces:**
- Produces: optional `practiceRequirement` and `score.activeParts` contracts.
- Preserves: all existing callers when those fields are absent.

- [ ] Write failing tests proving RH/LH expectation filtering, inactive-staff presentation, explicit practice rubric enforcement, and unchanged legacy score runs.
- [ ] Run the focused tests and verify expected failures.
- [ ] Implement the minimal additive contracts.
- [ ] Run the focused tests and commit the passing task.

### Task 4: Add the roadmap and passage-session UX

**Files:**
- Create: focused Learn roadmap/session components beside `ScorePlayer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Modify: Sheet Music styles and focused component tests

**Interfaces:**
- Consumes: Tasks 1–3 planners, record API, and run contracts.
- Produces: Learn roadmap → ladder → dedicated run navigation with query-backed selection.

- [ ] Write failing interaction tests for roadmap states, open passage selection, sequential rung unlocks, always-available Test Out, rep banking/retry, completion, Back restoration, and non-grand-staff applicability.
- [ ] Run the focused tests and verify expected failures.
- [ ] Implement the roadmap overlay, ladder panel, session host, and Learn branch; retire the old Learn gate only after parity is covered.
- [ ] Run the focused and full Sheet Music suites and commit the passing task.

### Task 5: Document and verify the integrated feature

**Files:**
- Modify: `docs/reference/piano/sheet-music-player.md`
- Modify: `docs/reference/piano/performance-assessment.md`

**Interfaces:**
- Consumes: final runtime and persistence behavior.
- Produces: current operational/reference documentation.

- [ ] Update the Learn-mode, config, progress, and assessment reference sections.
- [ ] Run focused frontend/backend suites, lint affected files, and run the production frontend build.
- [ ] Commit documentation and any verification-only corrections.
