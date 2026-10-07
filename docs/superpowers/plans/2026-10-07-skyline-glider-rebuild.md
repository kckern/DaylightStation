# Skyline Glider Side-Scroller Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use TDD.

**Goal:** Rebuild Skyline Glider as a legible, fast-moving course-driven side-scroller with a vertical RPM gauge and diagnostic telemetry.

**Architecture:** Keep the pure cadence/altitude engine, course API, persistence, and reward contracts. Add a pure course projection model consumed by an SVG scene, expose vertical motion for presentation, and derive structured play events at the React boundary.

**Tech Stack:** React, SVG/CSS, Vitest/Testing Library, YAML, structured frontend logger.

**Spec:** `docs/superpowers/specs/2026-10-06-skyline-glider-design.md`

## Global Constraints

- NiceDay is first-choice cadence equipment; CycleAce is second.
- Five-minute course, 14 seconds per viewport, glider anchored near 24% with visual-only ±3% elastic drift.
- One telemetry snapshot per course second plus unsampled discrete gameplay events; never frame logs.
- Preserve `skyline-glider-run/v1`, rewards, resume, collision, lives, and sensor-loss behavior.
- Do not touch unrelated changes in the main working tree.

## Tasks

### Task 1: Projection and motion state

- Add failing unit tests for 14-second world projection, obstacle/collectible placement, clipping, and vertical rate.
- Implement a pure course projection module and expose `verticalRate` from flight state.
- Run Skyline model/engine tests and commit.

### Task 2: Course-driven scene and RPM gauge

- Add failing component tests for a fixed right-facing glider, scrolling semantic terrain, parallax layers, the vertical calibrated RPM gauge, pitch/effects, and mute control.
- Replace the static scene with course-driven SVG/CSS presentation while preserving lifecycle behavior.
- Run Skyline component and library tests and commit.

### Task 3: Playtest observability

- Add failing tests for one sample per course second and discrete connection, collision, collectible, checkpoint, crash/restart, completion/exit, and save events.
- Implement pure event derivation plus run-correlated structured logging.
- Run Skyline tests and commit.

### Task 4: Mountain Pass v2

- Add failing catalog/model tests for version 2, first obstacle by 10 seconds, maneuver counts, checkpoints, finish, collectibles, and reachability.
- Author a denser five-minute course with over/under/through maneuvers every 10–18 seconds.
- Run frontend/backend course tests and commit.

### Task 5: Verification and rollout

- Run focused tests, frontend lint, production build, and relevant backend tests.
- Review the full branch against this plan and the design spec; fix important findings test-first.
- Merge the feature branch into main without disturbing unrelated working-tree changes, run the deployment gate/build/deploy, verify health/build ID, and inspect Skyline logs.

## Acceptance

- During flight the glider remains in the left flight zone, clearly faces right, rises/falls with cadence, and terrain visibly streams right-to-left.
- Actual course obstacles are visible early and align with collisions.
- The left gauge mirrors altitude and shows live RPM/calibration.
- Logs can reconstruct a run at 1 Hz and identify every meaningful gameplay/effect transition.
- NiceDay is selected over CycleAce and the production garage loads the deployed build.
