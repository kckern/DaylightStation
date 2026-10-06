# Sheet Music Learn Launchpad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the compact Sheet Music Learn ladder with a large, repeatable segment launchpad and custom-practice flow.

**Architecture:** Add pure launch/credit projections, then compose focused launchpad, builder, and result components around the existing Learn Lab and ExerciseRun engine. Keep persistence backward-compatible and attach launch metadata to existing attempt evidence.

**Tech Stack:** React, Vitest/Testing Library, SCSS, Playwright runtime contracts.

**Spec:** `docs/superpowers/specs/2026-10-05-sheetmusic-learn-launchpad-design.md`

## Global Constraints

- Preserve existing grading, notation, click, countdown, practice YAML, and API behavior.
- Minimum touch target is 64px; primary choice cards are at least 88px.
- Completed work is replayable and never regresses.
- Custom practice exposes hands, beat mode, and named tempo only.
- Use structured logging, never `console.*`.

## Review Focus

- A completed rung must launch with fresh temporary progress while preserving its achievement.
- Optional credit must require an exact unlocked unfinished-rung match.
- Single-staff excerpts must not offer impossible hand choices.
- 1280×800 must not clip long labels, result actions, or custom choices.
- Back/Escape and unavailable excerpts must return to a usable launchpad.

---

### Task 1: Pure launch and credit model

**Files:** Create `learnLaunch.js` and its test beside the Sheet Music components.

**Interfaces:** Produce launch builders/projections and exact-match credit selection consumed by UI and persistence.

- [ ] Write failing tests for recommended, review, custom, replay reset, exact credit, and single-staff cases.
- [ ] Run tests and confirm feature failures.
- [ ] Implement the pure model.
- [ ] Run tests green and commit.

### Task 2: Launchpad, builder, navigator, and result UI

**Files:** Create focused Sheet Music components and tests; modify Piano SCSS and the house icon set only as needed.

**Interfaces:** Consume Task 1 projections; emit launch descriptions and result actions.

- [ ] Write failing interaction and accessibility tests.
- [ ] Run tests and confirm missing UI behavior.
- [ ] Implement large icon-and-label controls and result choices.
- [ ] Run component tests green and commit.

### Task 3: ScorePlayer, Learn Lab, and persistence integration

**Files:** Modify `ScorePlayer.jsx`, `LearnLab.jsx`, and `usePracticeRecord.js` with focused tests.

**Interfaces:** Route launch descriptions into ExerciseRun, record context, and award only eligible credit.

- [ ] Write failing integration tests for navigation, fresh replay, exact credit, telemetry, and result flow.
- [ ] Run tests and confirm current behavior fails.
- [ ] Integrate the launch flow without forking the assessment engine.
- [ ] Run Sheet Music and practice API tests green and commit.

### Task 4: Runtime acceptance and documentation

**Files:** Add a 1280×800 runtime contract and update `docs/reference/piano/sheet-music-player.md`.

- [ ] Write the failing geometry/accessibility runtime contract.
- [ ] Make layout adjustments until representative states pass.
- [ ] Run focused, frontend, and repository verification gates.
- [ ] Update documentation and commit.

