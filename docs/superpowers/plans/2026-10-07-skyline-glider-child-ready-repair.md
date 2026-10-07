# Skyline Glider Child-Ready Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Skyline Glider a smooth, fair, responsive child-facing side-scroller with identity-safe recovery and truthful feedback telemetry.

**Architecture:** Preserve the pure 60 Hz fixed-step flight engine and SVG course projection. Share one craft geometry contract between physics and presentation, drive frames with `requestAnimationFrame`, isolate device selection, checkpoint lifecycle, and Web Audio feedback, and keep telemetry at one motion sample per course second plus actual discrete events.

**Tech Stack:** React, SVG/CSS, Web Audio, Vitest/Testing Library, Playwright, YAML, structured frontend logging.

**Spec:** `docs/superpowers/specs/2026-10-06-skyline-glider-design.md`

## Global Constraints

- NiceDay is the automatic first usable bike, CycleAce second, then other cadence bikes; the chosen rider/equipment is locked for the attempt.
- Five-minute Mountain Pass and 14 seconds per viewport remain.
- Motion tuning is `filter_s: 0.25`, `response_s: 0.6`; existing deadband and climb/descent caps remain.
- Craft anchor is x=240 with front span 0.8 seconds, rear span 0.67 seconds, and vertical radius 0.035.
- One motion sample per course second plus discrete domain and executed-effect events; never frame logs.
- Preserve `skyline-glider-run/v1` backward compatibility and `gaming-result/v1`.
- Do not touch unrelated changes in the main working tree.

## Review Focus

- Single-sided terrain must never create an invisible opposite boundary; full playable altitude remains safe on its open side.
- Visual nose/tail contact and engine collision timing must share the exact craft geometry.
- A configured but unusable NiceDay must not prevent a usable CycleAce from starting.
- A mismatched or terminal-pending checkpoint must never be resumed or silently overwritten.
- Audio/visual effect logs must describe effects that actually executed, including muted or failed audio.

---

### Task 1: Fair shared flight geometry and responsive input

**Files:**
- Create: `frontend/src/modules/Fitness/lib/skylineGlider/flightGeometry.js`
- Create: `frontend/src/modules/Fitness/lib/skylineGlider/flightGeometry.test.js`
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/courseModel.js`
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/flightEngine.js`
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/flightEngine.test.js`
- Modify: `backend/src/1_adapters/fitness/courses/mountain-pass.yml`

**Interfaces:**
- Produces `SKYLINE_CRAFT_GEOMETRY`, `terrainOverlappingCraft(course, courseTime, geometry)`, and playable-altitude conversion helpers.
- Flight state gains `inputReady` and `lastInputTs`; `stepFlight` accepts cadence `ts` and will not advance before a post-arm sample.

- [ ] Add RED tests for both invisible collision reproductions, swept nose/tail timing, collectible contact, first-reading gate, and the 30→65 RPM response reaching approximately 0.57 altitude at one second.
- [ ] Implement single-sided collision geometry, shared swept overlap, timestamp gating, and selected motion tuning.
- [ ] Run all Skyline library and course catalog tests; commit.

### Task 2: Smooth aligned presentation and real feedback

**Files:**
- Create: `frontend/src/modules/Fitness/lib/skylineGlider/skylineAudio.js`
- Create: `frontend/src/modules/Fitness/lib/skylineGlider/skylineAudio.test.js`
- Modify: `frontend/src/modules/Fitness/widgets/SkylineGlider/SkylineGlider.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/SkylineGlider/SkylineGlider.scss`
- Modify: `frontend/src/modules/Fitness/widgets/SkylineGlider/SkylineGlider.test.jsx`
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/flightTelemetry.js`

**Interfaces:**
- Produces `createSkylineAudio(options)` with `prime`, `startWind`, `playCue`, `setMuted`, and `stop`.
- Presentation consumes shared craft geometry; domain telemetry no longer predicts effects.

- [ ] Add RED tests for RAF-driven motion, fixed anchor, full-range gauge mapping, first-reading wait, collected-bell removal, one-shot presentations, real mute gain, and executed/failed effect logs.
- [ ] Implement RAF simulation, aligned terrain decoration, gauge mapping, synthesized wind/cues, visual effects, and truthful effect execution logging.
- [ ] Run component, audio, telemetry, and library tests; commit.

### Task 3: Usable bike selection and identity-safe lifecycle

**Files:**
- Create: `frontend/src/modules/Fitness/lib/skylineGlider/bikeSelection.js`
- Create: `frontend/src/modules/Fitness/lib/skylineGlider/bikeSelection.test.js`
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/checkpointRepository.js`
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/checkpointRepository.test.js`
- Modify: `frontend/src/modules/Fitness/lib/skylineGlider/runResult.js`
- Modify: `frontend/src/modules/Fitness/widgets/SkylineGlider/SkylineGlider.jsx`
- Modify: relevant backend Skyline run tests.

**Interfaces:**
- Produces `selectSkylineBike(equipment, session, preferredId)`.
- Checkpoint v3 loaders return `missing | compatible | incompatible | pending_terminal | invalid` and carry course/session/rider/equipment/calibration/run identity.
- `skyline-glider-run/v1` adds optional `fitness_session_id`, `equipment_id`, and calibration.

- [ ] Add RED tests for usable-bike fallback/manual selection/locking, exact-compatible resume, every identity mismatch, original run preservation, v2 discard, terminal save retry, and no overwrite.
- [ ] Implement the pure selector, v3 envelope, pending-terminal lifecycle, immediate freeze, and backward-compatible run identity fields.
- [ ] Run component, repository, run-result, router, service, and datastore tests; commit.

### Task 4: Production-course acceptance and observability

**Files:**
- Modify: `tests/live/flow/fitness/skyline-glider-lifecycle.runtime.test.mjs`
- Modify: focused Skyline tests as needed.

**Interfaces:**
- Browser acceptance uses shipped Mountain Pass tuning/geometry, not an obstacle-free accelerated substitute.
- Render health logs once per ten seconds with frame count, update rate, and long-frame count.

- [ ] Add RED browser/component acceptance for at least 20 distinct terrain positions over 500 ms, real response, lower/upper/corridor navigation, checkpoint identity, terminal saving, and render-health logging.
- [ ] Add minimal acceptance plumbing without production-only debug controls.
- [ ] Run focused unit/integration/browser tests; commit.

### Task 5: Review, verification, deployment, and supervised acceptance

- [ ] Run changed-file lint, all focused Skyline tests, architecture gates, production build, and broad suite with baseline comparison.
- [ ] Dispatch a fresh whole-branch reviewer; fix all Critical/Important findings test-first in one pass and ledger deferred minors.
- [ ] Merge without disturbing unrelated main changes, run the idle deployment gate, build/deploy from the clean worktree, and verify health, build ID, course API, and logs.
- [ ] Conduct or request the supervised three-minute NiceDay/CycleAce playtest; inspect its correlated logs before declaring child-ready.

