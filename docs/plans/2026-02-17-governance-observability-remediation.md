# Governance Warning Observability Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the stale-data logging bug and enrich warning/lock events so governance issues are diagnosable from logs alone — no manual YAML inspection required.

**Architecture:** Three code fixes in `GovernanceEngine.js` plus one test file. Task 1 threads current evaluation data into `_setPhase()` so logging methods read fresh state instead of stale `_latestInputs`. Task 2 enriches `_getParticipantsBelowThreshold()` to include HR, zone threshold, and delta per user (sourced from `ZoneProfileStore`). Task 3 applies the same fix to `_getParticipantStates()` used by the `lock_triggered` event.

**Tech Stack:** Vanilla JS class (`GovernanceEngine.js`), Jest (ESM mode via `--experimental-vm-modules`)

**Source Audit:** `docs/_wip/audits/2026-02-17-governance-warning-observability-audit.md`

---

## Context

### The Bug

`_getParticipantsBelowThreshold()` (line 713) and `_getParticipantStates()` (line 739) read zone data from `this._latestInputs.userZoneMap`. But `_captureLatestInputs()` runs at line 1498 — AFTER `_setPhase()` at line 1488. So both methods read the **previous evaluation's** data, when everyone was above threshold.

Result: `participantsBelowThreshold` is always `[]` in every `warning_started` event. `participantStates` in `lock_triggered` events is similarly stale.

### What's Missing from Logs

Even with fresh zone data, the warning event doesn't log:
- Each user's current HR at evaluation time
- Each user's personal zone threshold (the `min` BPM of the required zone)
- The delta (HR - threshold) that makes diagnosis instant

### Execution Order (Current → Fixed)

```
CURRENT (broken):
  1. ZoneProfileStore populates userZoneMap (local var)
  2. _evaluateZoneRequirement() finds missingUsers (uses local var)
  3. _setPhase('warning')
     └─ _getParticipantsBelowThreshold() reads this._latestInputs (STALE)
  4. _captureLatestInputs({ userZoneMap })  (TOO LATE)

FIXED:
  1. ZoneProfileStore populates userZoneMap (local var)
  2. _evaluateZoneRequirement() finds missingUsers (uses local var)
  3. _setPhase('warning', { userZoneMap, zoneRankMap })  ← pass current data
     └─ _getParticipantsBelowThreshold(userZoneMap) uses FRESH data
  4. _captureLatestInputs({ userZoneMap })  (still here, unchanged)
```

### Key Files

| File | Role |
|------|------|
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Governance logic — contains all three bugs |
| `frontend/src/hooks/fitness/ZoneProfileStore.js` | Zone profiles with per-user `currentZoneThreshold`, `heartRate` |
| `tests/unit/governance/GovernanceEngine.test.mjs` | 34+ existing governance tests |
| `tests/unit/governance/governance-below-threshold-logging.test.mjs` | Existing tests for `_getParticipantsBelowThreshold` |

### Test Command

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/ --no-cache
```

---

## Task 1: Thread Current Data Through `_setPhase()`

**Problem:** `_setPhase()` is called with only `newPhase`. The logging methods inside it (`_getParticipantsBelowThreshold`, `_getParticipantStates`) fall back to `this._latestInputs` which is stale.

**Fix:** Add an optional second parameter `evalContext` to `_setPhase()` containing the current `userZoneMap` and `zoneRankMap`. Pass it from every call site in `evaluate()`. Logging methods use `evalContext` when available, falling back to `this._latestInputs` for non-evaluate callers.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:620` (`_setPhase` signature)
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:713` (`_getParticipantsBelowThreshold` signature)
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:739` (`_getParticipantStates` signature)
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1438-1488` (all `_setPhase` calls in evaluate)
- Test: `tests/unit/governance/governance-below-threshold-logging.test.mjs`

**Step 1: Write the failing test**

Add a new test to `tests/unit/governance/governance-below-threshold-logging.test.mjs` that proves the stale-data bug exists by running a full `evaluate()` cycle (not just setting `_latestInputs` manually):

```javascript
describe('stale data fix — full evaluate cycle', () => {
  it('should populate participantsBelowThreshold during warning_started via evaluate()', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // First evaluate: both above threshold → unlocked, satisfiedOnce = true
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap
    });
    expect(engine.phase).toBe('unlocked');

    // Capture the logger to inspect warning_started payload
    const { getLogger } = await import('#frontend/lib/logging/Logger.js');
    const logger = getLogger();
    logger.info.mockClear();

    // Second evaluate: bob drops to cool → warning
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'cool' },
      zoneRankMap,
      zoneInfoMap
    });
    expect(engine.phase).toBe('warning');

    // Find the warning_started log call
    const warningCall = logger.info.mock.calls.find(
      ([event]) => event === 'governance.warning_started'
    );
    expect(warningCall).toBeDefined();

    const payload = warningCall[1];
    const belowNames = (payload.participantsBelowThreshold || []).map(p => p.name);
    // THIS IS THE KEY ASSERTION: bob must appear (was [] before the fix)
    expect(belowNames).toContain('bob');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/governance-below-threshold-logging.test.mjs --no-cache -t "full evaluate cycle"
```

Expected: FAIL — `belowNames` is `[]` because `_getParticipantsBelowThreshold()` reads stale `_latestInputs`.

**Step 3: Implement the fix**

3a. Change `_setPhase` signature to accept an optional eval context (line 620):

```javascript
// Before:
_setPhase(newPhase) {

// After:
_setPhase(newPhase, evalContext = null) {
```

3b. Pass `evalContext` to `_getParticipantsBelowThreshold` and `_getParticipantStates` (lines 676 and 695):

```javascript
// Before (line 676):
const participantsBelowThreshold = this._getParticipantsBelowThreshold();

// After:
const participantsBelowThreshold = this._getParticipantsBelowThreshold(evalContext);

// Before (line 695):
participantStates: this._getParticipantStates(),

// After:
participantStates: this._getParticipantStates(evalContext),
```

3c. Update `_getParticipantsBelowThreshold` to use evalContext (line 713):

```javascript
// Before:
_getParticipantsBelowThreshold() {
  const requirements = this.requirementSummary?.requirements || [];
  const userZoneMap = this._latestInputs.userZoneMap || {};

// After:
_getParticipantsBelowThreshold(evalContext = null) {
  const requirements = this.requirementSummary?.requirements || [];
  const userZoneMap = evalContext?.userZoneMap || this._latestInputs.userZoneMap || {};
```

3d. Update `_getParticipantStates` to use evalContext (line 739):

```javascript
// Before:
_getParticipantStates() {
  const userZoneMap = this._latestInputs.userZoneMap || {};
  const zoneInfoMap = this._latestInputs.zoneInfoMap || {};

// After:
_getParticipantStates(evalContext = null) {
  const userZoneMap = evalContext?.userZoneMap || this._latestInputs.userZoneMap || {};
  const zoneInfoMap = evalContext?.zoneInfoMap || this._latestInputs.zoneInfoMap || {};
```

3e. Pass evalContext from all `_setPhase` call sites in `evaluate()` (lines 1381, 1400, 1438, 1449, 1464, 1475, 1483, 1488):

Every `_setPhase(...)` call inside `evaluate()` that happens BEFORE `_captureLatestInputs()` needs to pass the current local variables. Add this object at the top of the phase-determination block (after line 1427):

```javascript
const evalContext = { userZoneMap, zoneRankMap, zoneInfoMap };
```

Then change each call:
```javascript
// Each _setPhase call becomes:
this._setPhase('locked', evalContext);
this._setPhase('unlocked', evalContext);
this._setPhase('pending', evalContext);
this._setPhase('warning', evalContext);
```

Non-evaluate callers of `_setPhase` (e.g., `reset()`, `_deactivateGovernance()`) don't need changes — they pass no evalContext and the methods fall back to `_latestInputs`, which is correct for those paths.

**Step 4: Run all governance tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/ --no-cache
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/governance-below-threshold-logging.test.mjs
git commit -m "fix(governance): thread current eval data through _setPhase to fix stale logging

_getParticipantsBelowThreshold() and _getParticipantStates() read from
this._latestInputs which is updated AFTER _setPhase(). Pass an evalContext
with the current userZoneMap/zoneRankMap so logging reads fresh data.
Fixes participantsBelowThreshold always being [] in warning_started events
and stale participantStates in lock_triggered events."
```

---

## Task 2: Enrich Warning Logs With HR, Threshold, and Delta

**Problem:** Even with fresh zone data from Task 1, `participantsBelowThreshold` only contains `{ name, zone, required }` — no HR value, no zone threshold, no delta. Diagnosing "why did this user drop?" requires cross-referencing zone_change events and reading user profile YAMLs.

**Fix:** In `_getParticipantsBelowThreshold()`, look up each missing user's HR from the session roster and their zone threshold from the `ZoneProfileStore`. Log `{ name, zone, required, hr, threshold, delta }`.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:713-734` (`_getParticipantsBelowThreshold`)
- Test: `tests/unit/governance/governance-below-threshold-logging.test.mjs`

**Step 1: Write the failing test**

```javascript
it('should include hr, threshold, and delta in participantsBelowThreshold', () => {
  const participants = ['alice', 'bob'];
  const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

  // Mock session roster with HR data
  engine.session.roster = [
    { id: 'alice', name: 'Alice', heartRate: 140 },
    { id: 'bob', name: 'Bob', heartRate: 124 }
  ];

  // Mock ZoneProfileStore with per-user threshold data
  engine.session.zoneProfileStore = {
    getProfile: (id) => {
      if (id === 'bob') return {
        currentZoneId: 'cool',
        currentZoneThreshold: 100,  // cool zone min
        heartRate: 124,
        zoneConfig: [
          { id: 'cool', min: 0 },
          { id: 'active', min: 125 },
          { id: 'warm', min: 150 }
        ]
      };
      return null;
    }
  };

  // Get to unlocked first
  engine.evaluate({
    activeParticipants: participants,
    userZoneMap: { alice: 'active', bob: 'active' },
    zoneRankMap,
    zoneInfoMap
  });

  const { getLogger } = await import('#frontend/lib/logging/Logger.js');
  const logger = getLogger();
  logger.info.mockClear();

  // Bob drops below active → warning
  engine.evaluate({
    activeParticipants: participants,
    userZoneMap: { alice: 'active', bob: 'cool' },
    zoneRankMap,
    zoneInfoMap
  });

  const warningCall = logger.info.mock.calls.find(
    ([event]) => event === 'governance.warning_started'
  );
  const payload = warningCall[1];
  const bobEntry = payload.participantsBelowThreshold.find(p => p.name === 'bob');

  expect(bobEntry).toBeDefined();
  expect(bobEntry.hr).toBe(124);
  expect(bobEntry.threshold).toBe(125);  // active zone min from bob's zoneConfig
  expect(bobEntry.delta).toBe(-1);       // 124 - 125 = -1
});
```

**Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/governance-below-threshold-logging.test.mjs --no-cache -t "hr, threshold, and delta"
```

Expected: FAIL — current code doesn't return `hr`, `threshold`, or `delta` fields.

**Step 3: Implement the enrichment**

In `_getParticipantsBelowThreshold()` (after Task 1's changes), enhance the `below.push()` block to include HR and threshold data:

```javascript
_getParticipantsBelowThreshold(evalContext = null) {
  const requirements = this.requirementSummary?.requirements || [];
  const userZoneMap = evalContext?.userZoneMap || this._latestInputs.userZoneMap || {};
  const below = [];
  for (const req of requirements) {
    if (!Array.isArray(req.missingUsers)) continue;
    const requiredRank = this._getZoneRank(req.zone || req.zoneLabel);
    const requiredZoneId = (req.zone || req.zoneLabel || '').toLowerCase();
    for (const name of req.missingUsers) {
      const currentZone = userZoneMap[name];
      const currentRank = this._getZoneRank(currentZone) ?? 0;
      if (!Number.isFinite(requiredRank) || currentRank < requiredRank) {
        // Get HR from roster
        const rosterEntry = this.session?.roster?.find(
          e => (e.id || e.profileId) === name
        );
        const hr = Number.isFinite(rosterEntry?.heartRate) ? rosterEntry.heartRate : null;

        // Get per-user zone threshold from ZoneProfileStore
        let threshold = null;
        if (this.session?.zoneProfileStore) {
          const profile = this.session.zoneProfileStore.getProfile(name);
          if (profile?.zoneConfig) {
            const requiredZone = profile.zoneConfig.find(
              z => z.id === requiredZoneId
            );
            threshold = requiredZone?.min ?? null;
          }
        }

        const delta = (hr != null && threshold != null) ? hr - threshold : null;

        below.push({
          name,
          zone: currentZone || req.zone || req.zoneLabel,
          requiredZone: requiredZoneId,
          required: req.requiredCount,
          hr,
          threshold,
          delta
        });
      }
    }
  }
  return below.slice(0, 10);
}
```

**Step 4: Run all governance tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/ --no-cache
```

Expected: All tests pass. The existing `governance-below-threshold-logging.test.mjs` tests still pass because they only assert on `name` presence, not on the new fields.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/governance-below-threshold-logging.test.mjs
git commit -m "feat(governance): log HR, threshold, and delta in warning_started events

Enrich participantsBelowThreshold entries with each user's current HR
(from roster), their personal zone threshold (from ZoneProfileStore
zoneConfig), and the computed delta. Produces log entries like:
{name: 'alan', hr: 124, threshold: 125, delta: -1, zone: 'cool', requiredZone: 'active'}

This makes governance warning diagnosis immediate from logs alone —
no manual YAML inspection required."
```

---

## Task 3: Fix `_getParticipantStates()` Stale Data

**Problem:** `_getParticipantStates()` (used by `governance.lock_triggered` events) also reads from `this._latestInputs.userZoneMap` — the same stale-data bug as `_getParticipantsBelowThreshold()`.

**Fix:** Already partially addressed in Task 1 (evalContext parameter added). This task verifies it works and adds HR/threshold enrichment to match Task 2.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:739-756` (`_getParticipantStates`)
- Test: `tests/unit/governance/governance-below-threshold-logging.test.mjs`

**Step 1: Write the failing test**

```javascript
describe('_getParticipantStates — lock event enrichment', () => {
  it('should include fresh zone data in lock_triggered participantStates', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 0 });

    engine.session.roster = [
      { id: 'alice', name: 'Alice', heartRate: 140 },
      { id: 'bob', name: 'Bob', heartRate: 124 }
    ];

    // Get to unlocked first
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap
    });
    expect(engine.phase).toBe('unlocked');

    const { getLogger } = await import('#frontend/lib/logging/Logger.js');
    const logger = getLogger();
    logger.info.mockClear();

    // Bob drops — grace=0 so goes straight to locked
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'cool' },
      zoneRankMap,
      zoneInfoMap
    });
    expect(engine.phase).toBe('locked');

    const lockCall = logger.info.mock.calls.find(
      ([event]) => event === 'governance.lock_triggered'
    );
    expect(lockCall).toBeDefined();

    const payload = lockCall[1];
    const bobState = payload.participantStates.find(p => p.id === 'bob');
    // Must reflect CURRENT zone (cool), not stale (active)
    expect(bobState.zone).toBe('cool');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/governance-below-threshold-logging.test.mjs --no-cache -t "lock event enrichment"
```

Expected: FAIL — `bobState.zone` is `'active'` (stale) instead of `'cool'` (current).

**Step 3: Verify the fix from Task 1 covers this**

The evalContext parameter added in Task 1 Step 3d already threads fresh `userZoneMap` into `_getParticipantStates()`. Verify the `_setPhase('locked', evalContext)` calls (Task 1 Step 3e) cover all lock paths.

If the test still fails after Task 1, the issue is that `_getParticipantStates` doesn't use `evalContext.userZoneMap`. Confirm the Task 1 change at line 740:

```javascript
_getParticipantStates(evalContext = null) {
  const userZoneMap = evalContext?.userZoneMap || this._latestInputs.userZoneMap || {};
  const zoneInfoMap = evalContext?.zoneInfoMap || this._latestInputs.zoneInfoMap || {};
```

This should already be done in Task 1 Step 3d. If so, the test should pass after Task 1.

**Step 4: Run all governance tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/ --no-cache
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add tests/unit/governance/governance-below-threshold-logging.test.mjs
git commit -m "test(governance): verify lock_triggered uses fresh zone data via evalContext

Adds test proving _getParticipantStates() reads current evaluation data
instead of stale _latestInputs during lock_triggered events."
```

---

## Task 4: Update Existing Tests for New Field Shape

**Problem:** The existing tests in `governance-below-threshold-logging.test.mjs` set `_latestInputs` manually. After Task 1, the methods prefer `evalContext` over `_latestInputs`. The existing tests still work (they test the fallback path), but should be updated to also verify the new fields from Task 2.

**Files:**
- Modify: `tests/unit/governance/governance-below-threshold-logging.test.mjs`

**Step 1: Update existing test assertions**

In the `'should include users who are genuinely below threshold'` test, add assertions for the new fields:

```javascript
it('should include users who are genuinely below threshold', () => {
  // ... existing setup ...

  const below = engine._getParticipantsBelowThreshold();
  const bobEntry = below.find(b => b.name === 'bob');
  expect(bobEntry).toBeDefined();
  expect(bobEntry.zone).toBeDefined();
  expect(bobEntry.requiredZone).toBe('active');
  // hr/threshold/delta will be null in this test (no roster/ZoneProfileStore mocked)
  // That's fine — they're null-safe
});
```

**Step 2: Run tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/governance-below-threshold-logging.test.mjs --no-cache
```

Expected: All pass.

**Step 3: Commit**

```bash
git add tests/unit/governance/governance-below-threshold-logging.test.mjs
git commit -m "test(governance): update below-threshold tests for enriched field shape"
```

---

## Task 5: Run Full Test Suite and Verify

**Step 1: Run all governance tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/governance/ --no-cache
```

Expected: All tests pass.

**Step 2: Run broader test suite for regressions**

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest --no-cache 2>&1 | tail -20
```

Expected: No regressions in non-governance tests.

**Step 3: Verify no lint errors**

```bash
npx eslint frontend/src/hooks/fitness/GovernanceEngine.js
```

---

## Execution Summary

| Task | What | Files Modified | Tests |
|------|------|---------------|-------|
| 1 | Thread evalContext through `_setPhase` | `GovernanceEngine.js` | 1 new |
| 2 | Enrich below-threshold with HR/threshold/delta | `GovernanceEngine.js` | 1 new |
| 3 | Verify lock_triggered also uses fresh data | (covered by Task 1) | 1 new |
| 4 | Update existing test assertions | `governance-below-threshold-logging.test.mjs` | updated |
| 5 | Full suite verification | — | — |

**Dependencies:** Task 2 depends on Task 1 (needs evalContext). Task 3 depends on Task 1 (verifies its fix). Task 4 depends on Task 2 (new field shape). Task 5 runs last.

**What this plan does NOT do:**
- Does NOT adjust per-user HR zone thresholds — threshold calibration is a config concern, not a code fix
- Does NOT remove `warning_cooldown_seconds` — it's already implemented and serves as a UX safety net
- Does NOT change zone-level hysteresis — the audit confirmed it's working correctly

**After this plan:** Warning events will produce logs like:
```json
"participantsBelowThreshold": [
  {"name": "alan", "hr": 124, "threshold": 125, "delta": -1, "zone": "cool", "requiredZone": "active"}
]
```
From this alone, any future governance issue is immediately diagnosable.
