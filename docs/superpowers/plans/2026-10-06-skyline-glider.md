# Skyline Glider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved single-rider Skyline Glider vertical slice on the garage Fitness display.

**Architecture:** A pure Fitness-owned fixed-step engine consumes validated YAML courses and cadence snapshots. A dedicated React widget renders the experience; backend Fitness services load courses, persist idempotent run records, and project runs into session history.

**Tech Stack:** JavaScript/JSX, React, SVG/CSS, Vitest, YAML, Express, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-skyline-glider-design.md`

## Global Constraints

- Do not change Piano SideScrollerGame or Cycle Game behavior.
- Use structured logging; no raw console diagnostics.
- Continuous physics stays Fitness-owned; only terminal results use `gaming-result/v1`.
- No multiplayer or heart-rate gameplay modifiers in v1.
- Every production behavior is introduced test-first.

## Review Focus

- Connected zero RPM must descend; disconnected transport must pause without life loss.
- Large animation-frame gaps must not change deterministic outcomes or tunnel through terrain.
- Checkpoint retries and reloads must not duplicate collectibles or completion rings.
- Malformed or impossible household course overrides must fail closed without hiding the bundled course.
- Same run ID with different content must conflict rather than overwrite history.

---

### Task 1: Course Contracts and Pure Flight Engine

**Files:**
- Create: `frontend/src/modules/Fitness/lib/skylineGlider/courseModel.js`
- Create: `frontend/src/modules/Fitness/lib/skylineGlider/flightEngine.js`
- Test: matching `*.test.js` files

**Interfaces:**
- Produces `validateCourse`, `resolveCalibration`, `createFlightState`, and `stepFlight`.

- [ ] Write failing contract, reachability, calibration, motion, collision, checkpoint, sensor-loss, and determinism tests.
- [ ] Run the focused tests and confirm failures are caused by missing modules.
- [ ] Implement the minimum pure course compiler and fixed-step flight engine.
- [ ] Run focused tests and the existing Cycle Race engine tests.
- [ ] Commit `feat(fitness): add Skyline Glider flight engine`.

### Task 2: Course Catalog and Durable Run Backend

**Files:**
- Create bundled Mountain Pass YAML and Fitness course catalog adapter.
- Create Skyline Glider run datastore/service/activity provider.
- Modify Fitness API/composition wiring.

**Interfaces:**
- Produces `GET /api/v1/fitness/skyline-glider/courses`, `POST /runs`, and `GET /runs/:runId`.

- [ ] Write failing catalog, override, idempotency/conflict, route, and activity-projection tests.
- [ ] Confirm the focused tests fail for missing implementations.
- [ ] Implement validated bundled/override course loading and idempotent YAML run persistence.
- [ ] Wire routes and the `skyline-glider` Fitness activity provider.
- [ ] Run focused backend and existing ActivityRegistry tests.
- [ ] Commit `feat(fitness): persist Skyline Glider courses and runs`.

### Task 3: Fitness Widget, SVG Scene, and Recovery

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/SkylineGlider/`
- Modify: `frontend/src/modules/Fitness/index.js`
- Modify Fitness configuration bridge only as required for the new config block.

**Interfaces:**
- Consumes Task 1 engine and Task 2 APIs.
- Produces widget manifest `skyline_glider` and local checkpoint recovery.

- [ ] Write failing lobby, countdown, cadence, sensor pause, crash/restart, result, and Resume/Start Over component tests.
- [ ] Confirm focused tests fail because the widget does not exist.
- [ ] Implement the container, lifecycle hook, SVG/CSS scene, HUD, checkpoint repository, and audio cues.
- [ ] Register the widget and preserve existing Fitness module behavior.
- [ ] Run focused component and Fitness registry tests.
- [ ] Commit `feat(fitness): add Skyline Glider experience`.

### Task 4: Rewards, Result Contract, and Session Presentation

**Files:**
- Extend Skyline Glider run controller and tests.
- Modify Fitness activity display registry with a Skyline Glider poster.

**Interfaces:**
- Produces an idempotent TreasureBox award and valid `gaming-result/v1` terminal result.

- [ ] Write failing tests for reward formula, idempotency key, retry recovery, terminal result, and session activity display.
- [ ] Confirm failures precede implementation.
- [ ] Implement completion/abandon flows, save retry, result projection, and activity poster.
- [ ] Run focused tests plus TreasureBox bonus tests.
- [ ] Commit `feat(fitness): integrate Skyline Glider rewards and history`.

### Task 5: Live Flow, Documentation, and Deployment Verification

**Files:**
- Add a shortened Playwright Skyline Glider flow.
- Add `docs/reference/fitness/skyline-glider.md` and update the roadmap status.
- Update the production Fitness menu/config with the Skyline Glider tile and course defaults.

**Interfaces:**
- Consumes all earlier tasks; no new product interface.

- [ ] Add a live simulator flow for low/high flight, collision, checkpoint restart, reload/resume, completion, saved run, and one reward.
- [ ] Run focused unit/API/component suites, parse and SCSS checks, and the frontend build.
- [ ] Run the live flow against the test environment and record real-device tuning findings.
- [ ] Update reference and roadmap documentation.
- [ ] Commit `test(fitness): verify Skyline Glider end to end`.
- [ ] Run the deploy gate, build, gate again, replace the container, hard-reload the garage kiosk, and verify production telemetry and persistence.
