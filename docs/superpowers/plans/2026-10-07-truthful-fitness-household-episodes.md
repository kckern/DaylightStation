# Truthful Fitness Household Episodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make fitness history report truthful household workout episodes and prevent a deliberate End from immediately restarting the same devices.

**Architecture:** Keep raw YAML sessions unchanged as evidence and derive episode summaries through the existing grouping service. Add a persisted frontend ended-device hold at the pre-session-buffer boundary, extend the existing API/view model with elapsed and participant measured durations, then apply today's correction with existing invariant-checked split and recoverable-trash paths.

**Tech Stack:** Node.js 22, ESM, React, Vitest, YAML fitness history.

**Spec:** `docs/superpowers/specs/2026-10-07-truthful-fitness-household-episodes-design.md`

## Global Constraints

- Episode gap is exactly 15 minutes.
- Explicitly finalized sessions and non-cycling Strava activities are hard boundaries.
- Media and roster changes are not boundaries.
- Preserve `group:` route compatibility and raw telemetry.
- The deliberate-end hold clears per device only after the configured removal interval and expires at the local day boundary.
- Historical changes are recoverable and must pass reconciliation checks.

## Review Focus

- Overlapping Strava runs must not cause adjacent home sessions to join across the run.
- A finalized singleton must be a barrier both before and after itself.
- Participants repeated across segments must not lose or double-count rings or measured minutes.
- A page reload must not clear a deliberate-end device hold.
- A newly arriving device must remain able to start while an ended device is held.

---

### Task 1: Canonical Household Episode Aggregation

**Files:**
- Modify: `backend/src/2_domains/fitness/services/groupSessions.mjs`
- Test: `backend/src/2_domains/fitness/services/groupSessions.test.mjs`
- Test: `backend/src/3_applications/fitness/services/SessionGroupingService.detail.test.mjs`

**Interfaces:**
- Produces: grouped summaries with `elapsedMs` and `participants[id].measuredDurationMs`.
- Preserves: `durationMs`, `group:` IDs, segments, Strava isolation, and activity enrichment.

- [ ] Add failing tests for 15-minute grouping, finalized barriers, media continuity, Strava barriers, and aggregate participant metrics.
- [ ] Run the focused tests and verify the new assertions fail for existing behavior.
- [ ] Implement the minimal grouping and aggregation changes.
- [ ] Run focused grouping/detail tests and verify they pass.
- [ ] Commit the task.

### Task 2: Deliberate-End Device Hold

**Files:**
- Create: `frontend/src/hooks/fitness/EndedDeviceHold.js`
- Create: `frontend/src/hooks/fitness/EndedDeviceHold.test.js`
- Modify: `frontend/src/hooks/fitness/FitnessSession.js`
- Test: `frontend/src/hooks/fitness/FitnessSession.manualEndCooldown.test.js`

**Interfaces:**
- Produces: `EndedDeviceHold` with hold, filter, observe-absence, persistence, and day-expiry behavior.
- Consumes: active device IDs and configured `remove` timeout from `FitnessSession`.

- [ ] Add failing tests for same-device suppression, different-device start, absence clearing, reload restoration, and day expiry.
- [ ] Run focused tests and verify the failures describe the missing hold.
- [ ] Implement the hold and integrate it before pre-session buffering.
- [ ] Run focused lifecycle tests and verify they pass.
- [ ] Commit the task.

### Task 3: Episode Duration Presentation and Documentation

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/GroupSummaryPanel.jsx`
- Modify: `docs/reference/fitness/fitness-system-architecture.md`
- Test: colocated widget/detail tests.

**Interfaces:**
- Consumes: `elapsedMs` and participant `measuredDurationMs` from Task 1.
- Produces: elapsed clock range plus per-participant measured-time presentation.

- [ ] Add failing UI tests for elapsed range and participant measured time.
- [ ] Run focused tests and verify they fail on current copy.
- [ ] Implement the minimal presentation changes and update reference documentation.
- [ ] Run focused UI tests and verify they pass.
- [ ] Commit the task.

### Task 4: Historical Repair, Verification, and Rollout

**Files:**
- Use: `cli/lib/fitness/split.mjs`
- Use: existing fitness session recoverable-trash API/store.
- Update: `.claude/settings.local.json` in the host checkout only, not repository history.

**Interfaces:**
- Consumes: split dry-run reconciliation and recoverable delete behavior.
- Produces: four truthful 2026-10-07 history entries with unchanged reconciled totals.

- [ ] Run relevant backend/frontend/CLI suites and the project parse/build gates.
- [ ] Request a fresh whole-branch code review and fix Critical/Important findings test-first.
- [ ] Run the deployment gate, build, rerun the gate, deploy, and hard-reload the garage kiosk.
- [ ] Dry-run the the learner split at epoch `1791415817548`; require every invariant to pass.
- [ ] Apply the split, recoverably trash the Test Sibling-only head and three artifacts, and invalidate the day index.
- [ ] Verify the live API returns exactly four episodes with totals 178, 3473, 2381, and 254 rings.
- [ ] Commit tracked documentation/code and record production verification.

