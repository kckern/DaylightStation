# Skyline Glider Fitness-First Playability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Skyline Glider a forgiving five-minute fitness ride where sustained cadence is the main challenge and slowing nearly to a stop reliably commands a fast descent.

**Architecture:** Preserve the pure fixed-step engine and current persistence contracts. Add Skyline-only cadence-loss inference and calibration, contact-latched collisions, checkpoint restart altitude, a fitness-first Mountain Pass v3, and a dedicated bounded ingestion policy for one-Hz flight samples.

**Tech Stack:** React, JavaScript, YAML, Vitest, Node test runner, structured frontend logging.

**Spec:** Approved in-chat design from 2026-10-07; no separate tracked spec exists.

## Global Constraints

- NiceDay remains the first-choice bike and CycleAce second.
- Keep shared cadence freshness and shared equipment RPM calibration unchanged for non-Skyline consumers.
- Preserve `skyline-glider-run/v1`, `skyline-glider-checkpoint/v3`, and `gaming-result/v1`.
- Mountain Pass remains 300 seconds with checkpoints at 75, 150, and 225 seconds.
- Aesthetics are out of scope.

## Review Focus

- Near-zero cadence silence must descend before it can become a sensor-loss pause.
- A real transport stall must not accrue course progress.
- Continuous contact with one obstacle must cost at most one life.
- Resuming old course checkpoints must reject the version-2 geometry.
- One-Hz samples must survive ingestion without exempting arbitrary frontend floods.

---

### Task 1: Cadence inference, collision latching, and safe restarts

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/flightEngine.js`
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/flightEngine.test.js`
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/courseModel.js`
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/courseModel.test.js`

**Interfaces:**
- `resolveCalibration(equipment)` prefers `equipment.skyline_glider.rpm` over `equipment.rpm`.
- State exposes `inputMode` and `contactSegmentId`.
- Course motion accepts `slow_signal_grace_s` and `inferred_slowdown_s`; checkpoints accept `restart_altitude`.

- [ ] Add failing tests for 15-RPM calibration override, measured zero descent, five-second inferred slowdown, transport-stall pause, smooth recovery, one-hit contact, separate-obstacle damage, and restart altitude.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Implement the smallest engine/model changes satisfying those tests.
- [ ] Run focused tests green and commit.

### Task 2: Fitness-first Mountain Pass v3

**Files:**
- Modify: `backend/src/1_adapters/fitness/courses/mountain-pass.yml`
- Modify: relevant course API/acceptance tests

**Interfaces:**
- Produces Mountain Pass v3 with approved terrain schedule and nine safe collectibles.

- [ ] Add failing course assertions and cadence simulations for the approved geometry, steady 75 RPM completion without a crash, scripted obstacle clearance, and 12-second checkpoint recovery windows.
- [ ] Run them red.
- [ ] Replace the v2 gauntlet with the approved v3 schedule and run them green.
- [ ] Commit.

### Task 3: Gameplay telemetry and bounded ingestion

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/flightTelemetry.js`
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/flightTelemetry.test.js`
- Modify: `backend/src/1_adapters/logging/FrontendLogIngestion.mjs`
- Modify: `backend/src/1_adapters/logging/ingestRateLimiter.mjs` and tests
- Modify: `frontend/src/modules/Fitness/widgets/SkylineGlider/SkylineGlider.jsx` and tests

**Interfaces:**
- Samples expose `inputMode`.
- Discrete events expose inferred slowdown `started`, `recovered`, and `escalated` transitions.
- Skyline flight samples use a dedicated 180-capacity, 120/minute per-client/event limiter.

- [ ] Add failing telemetry, ingestion, and interrupted-run tests.
- [ ] Run them red.
- [ ] Implement the telemetry transitions, bounded sample limiter, and resumable suspension event.
- [ ] Run focused frontend/backend tests green and commit.

### Task 4: Active NiceDay configuration and verification

**Files:**
- Modify after code is verified: active household fitness configuration, NiceDay entry only.

- [ ] Validate a `skyline_glider.rpm: { min: 15, max: 100 }` fixture through the real configuration/API path.
- [ ] Run all Skyline tests, logging adapter tests, lint on changed files, architecture gates, and the production build.
- [ ] Obtain a fresh whole-branch review and fix Critical/Important findings test-first.
- [ ] Merge to main without disturbing unrelated changes.
- [ ] Update the active household config, run the deployment gate, build/deploy, reload the garage kiosk, and verify health/build/course API/logs.
- [ ] Conduct the supervised NiceDay acceptance when a rider is available; do not represent hardware acceptance as complete before that run.
