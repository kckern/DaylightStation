# Sheet Music Learn Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sheet Music Learn learner-controlled, interruptible, configurable, visibly graded, observable, and actually delivered.

**Architecture:** Preserve `ExerciseRun` as the only grading authority. Add runtime control and verdict projections there, expose them through a focused Learn Lab session shell, and keep launch configuration in ScorePlayer/Launchpad state.

**Tech Stack:** React, JavaScript, Vitest/Testing Library, SCSS, Playwright/runtime contract, structured logger.

**Spec:** `docs/superpowers/specs/2026-10-05-sheetmusic-learn-recovery-design.md`

## Global Constraints

- Never bank or fail a take because the learner paused, restarted, changed configuration, or left.
- Minimum touch target is 64px; primary actions remain at least 88px.
- Keep a beat grades pitch only; Play on time grades pitch and timing.
- All visible and logged verdict totals derive from existing engine observations.
- No raw MIDI telemetry.
- Deployment must pass the safety gate and be verified by build identity.

## Review Focus

- A deep link with `learnRung` must still stop at the chooser.
- Paused and resume-count-in notes must not affect clocks, deadlines, or evidence.
- Restart after earned reps must preserve those reps while clearing the current take.
- Wrong pitches without score noteheads must survive in tally/result/log evidence.
- 15% tempo must survive configuration clamps for metronome and cued modes.

---

### Task 1: Choice-first launch and retained configuration

**Files:** Modify `ScorePlayer.jsx`, `LearnLaunchpad.jsx`, `learnLaunch.js`, `tempoStages.js`, Sheet Music tempo defaults/clamps, and focused tests.

**Interfaces:** Produce a launch descriptor plus retained `{ parts, mode, tempoStage, tempoPercent }`; consume URL selection only as chooser context.

- [ ] Write failing tests for deep-link choice-first entry, completed drill access, Together/No beat, RH/Keep a beat/15%, retained setup, and 15% surviving tempo defaults/clamps.
- [ ] Run them and confirm behavior failures.
- [ ] Implement controlled launchpad selection state and remove deep-link auto-launch fallback.
- [ ] Run focused tests green and commit.

### Task 2: Authoritative pause, resume, restart, and abandonment

**Files:** Modify the exercise runtime/control path, `ExerciseRun.jsx`, `LearnLab.jsx`, and tests.

**Interfaces:** `ExerciseRun` accepts a control state/commands and emits control/summary callbacks without creating a second judge.

- [ ] Write failing clock/runtime tests proving pause freezes observations, misses, timeout, count-in, and click; resume uses a clean count-in.
- [ ] Write failing Learn Lab tests for visible Pause, Start over, Change practice, tempo-change restart, and preserved earned reps.
- [ ] Implement minimal runtime suspension and session-shell controls.
- [ ] Run exercise and Learn Lab suites green and commit.

### Task 3: Persistent truthful verdicts and tally

**Files:** Modify verdict projection helpers, `ExerciseRun.jsx`, `ScorePassage.jsx`/styles as needed, and tests.

**Interfaces:** Produce one normalized verdict summary/sequence used by notation, live tally, result, and telemetry.

- [ ] Write failing tests for persistent pitch verdicts in free/metronome, full timed verdicts, wrong pitches without noteheads, symbols plus colors, and tally agreement.
- [ ] Implement read-only projections from existing runtime records and render the tally/marks.
- [ ] Run notation, exercise, and Learn Lab suites green and commit.

### Task 4: Reconstructable telemetry and delivery contract

**Files:** Modify Sheet Music logging call sites/tests, add the 1280×800 runtime contract, and update the piano reference doc.

**Interfaces:** Emit chooser/launch/control/abandonment/terminal events with stable run identity and normalized totals.

- [ ] Write failing telemetry tests for required fields and absence of raw MIDI.
- [ ] Write the failing 1280×800 recovery-flow runtime contract that executes timed run → pause → restart → Together/No beat → Right hand/Keep a beat/15% and checks visible feedback.
- [ ] Implement telemetry and layout adjustments; update documentation.
- [ ] Run focused tests, full ScorePlayer suite, parse/SCSS/audit gates, and production build.
- [ ] Commit, merge locally, run deploy gate, build image, re-run gate, deploy, and verify `/build.txt` plus kiosk client build logs.
