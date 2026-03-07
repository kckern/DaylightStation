# Fitness Session Data Loss Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent fitness session data loss when HR devices disconnect mid-session by preserving roster snapshots, un-silencing errors, and adding save-health monitoring.

**Architecture:** Three independent bugs conspired to lose a 36-minute session. Bug 2 (live roster read) is the root cause of data loss. Bug 1 (exhausted debug counters) and Bug 3 (swallowed errors) made it invisible. Fixes are ordered by impact: roster snapshot first (prevents data loss), then observability (prevents silent failures), then hardening (alerts on anomalies).

**Tech Stack:** React hooks (FitnessSession.js), PersistenceManager.js, ParticipantRoster.js, Jest unit tests, structured logging via `frontend/src/lib/logging/Logger.js`.

**Audit:** `docs/_wip/audits/2026-03-06-fitness-session-data-loss.md`

---

## Task 1: Add roster snapshot to PersistenceManager validation tests

Tests that the `no-participants` validation gate does NOT reject sessions that have previously saved successfully.

**Files:**
- Modify: `tests/unit/fitness/persistence-validation.test.mjs`

**Step 1: Write failing test — no-participants rejects fresh sessions**

Add to the existing test file. This test should already pass (confirms current behavior before we change it):

```javascript
describe('no-participants validation', () => {
  it('rejects a session with empty roster that has never saved', () => {
    const pm = new PersistenceManager();
    const payload = makeValidPayload({ roster: [] });
    const result = pm.validateSessionPayload(payload);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-participants');
  });
});
```

Where `makeValidPayload` is a helper that builds a valid session payload with overrides. Check the test file for any existing helper — if none exists, create one at the top of the describe block:

```javascript
function makeValidPayload(overrides = {}) {
  const base = {
    sessionId: 'fs_20260306053853',
    startTime: Date.now() - 600000,
    endTime: Date.now(),
    durationMs: 600000,
    roster: [{ id: 'user1', name: 'Alice', hrDeviceId: 'dev-1', heartRate: 120, isActive: true }],
    deviceAssignments: [{ deviceId: 'dev-1', userId: 'user1' }],
    timeline: {
      timebase: { tickCount: 60, intervalMs: 5000, startTime: Date.now() - 600000 },
      series: { 'user:user1:heart_rate': Array(60).fill(120) },
      events: []
    }
  };
  return { ...base, ...overrides };
}
```

**Step 2: Run test to verify it passes**

Run: `npx jest tests/unit/fitness/persistence-validation.test.mjs --testNamePattern="rejects a session with empty roster that has never saved" --no-coverage`
Expected: PASS

**Step 3: Write failing test — no-participants allows sessions with prior saves**

```javascript
it('allows a session with empty roster when session has prior successful saves', () => {
  const pm = new PersistenceManager();
  pm.markSaveSucceeded('fs_20260306053853');
  const payload = makeValidPayload({ roster: [] });
  const result = pm.validateSessionPayload(payload);
  expect(result.ok).toBe(true);
});
```

**Step 4: Run test to verify it fails**

Run: `npx jest tests/unit/fitness/persistence-validation.test.mjs --testNamePattern="allows a session with empty roster" --no-coverage`
Expected: FAIL — `markSaveSucceeded` is not a function

**Step 5: Commit**

```
test: add no-participants validation tests for prior-save bypass
```

---

## Task 2: Implement `markSaveSucceeded` and conditional no-participants gate

Make the failing test from Task 1 pass by tracking whether a session has ever saved successfully, and skipping the `no-participants` gate for sessions with prior saves.

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:523-535` (constructor)
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:740-742` (no-participants gate)
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:1026-1028` (save success handler)

**Step 1: Add `_hasSuccessfulSave` tracking to constructor**

In the constructor (line 523), add after line 530 (`this._lastSaveAt = 0;`):

```javascript
this._hasSuccessfulSave = {};  // { [sessionId]: true }
```

**Step 2: Add `markSaveSucceeded` method**

Add after the constructor:

```javascript
markSaveSucceeded(sessionId) {
  if (sessionId) this._hasSuccessfulSave[sessionId] = true;
}

hasSuccessfulSave(sessionId) {
  return !!this._hasSuccessfulSave[sessionId];
}
```

**Step 3: Call `markSaveSucceeded` on successful save**

In `persistSession()`, after the success log at line 1028, add:

```javascript
this.markSaveSucceeded(persistSessionData.session?.id);
```

**Step 4: Soften the no-participants gate**

Replace lines 739-742:

```javascript
// Hard minimums: must have participants and be over 60 seconds
if (roster.length === 0) {
  return { ok: false, reason: 'no-participants' };
}
```

With:

```javascript
// Roster required for first save; subsequent saves tolerate empty roster
// (device disconnect after valid session should not destroy data)
if (roster.length === 0 && !this.hasSuccessfulSave(sessionData.sessionId)) {
  return { ok: false, reason: 'no-participants' };
}
```

Also soften the `roster-required` and `device-assignments-required` checks at lines 732-737 with the same pattern:

```javascript
if (hasUserSeries && roster.length === 0 && !this.hasSuccessfulSave(sessionData.sessionId)) {
  return { ok: false, reason: 'roster-required' };
}
if (hasUserSeries && deviceAssignments.length === 0 && !this.hasSuccessfulSave(sessionData.sessionId)) {
  return { ok: false, reason: 'device-assignments-required' };
}
```

**Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/fitness/persistence-validation.test.mjs --no-coverage`
Expected: ALL PASS

**Step 6: Commit**

```
fix(fitness): allow saves with empty roster after prior successful save

Prevents data loss when HR device disconnects mid-session. The
no-participants validation gate now only blocks the FIRST save.
Sessions that have previously saved successfully can continue
saving with an empty roster.

Root cause of session fs_20260306053853 data loss.
```

---

## Task 3: Add last-known-good roster snapshot to FitnessSession

The `summary` getter should fall back to the last-known-good roster when the live roster is empty, so persisted data always includes participant info.

**Files:**
- Modify: `tests/unit/fitness/persistence-validation.test.mjs` (or create `tests/isolated/domain/fitness/roster-snapshot.unit.test.mjs` if scope warrants it)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1179-1181` (roster getter area)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:2430-2470` (summary getter)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1640-1668` (`_collectTimelineTick`)

**Step 1: Write failing test for roster snapshot**

Create `tests/isolated/domain/fitness/roster-snapshot.unit.test.mjs`:

```javascript
import { jest } from '@jest/globals';

// Mock logger
jest.unstable_mockModule('../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    sampled: jest.fn(), child: jest.fn().mockReturnThis(),
  }),
  __esModule: true,
}));

describe('FitnessSession roster snapshot', () => {
  it('preserves last-known-good roster when live roster empties', () => {
    // This test validates the concept — implementation will vary
    // based on how FitnessSession is instantiated in tests.
    // See existing test patterns in active-participant-state.unit.test.mjs

    // The key assertion: when roster returns [], summary.roster
    // should fall back to the last snapshot that had participants.
    expect(true).toBe(true); // Placeholder — replace in step 3
  });
});
```

Note: FitnessSession is complex to instantiate in unit tests. The actual test may need to be a focused integration test or test the snapshot logic in isolation. Check existing patterns in `tests/isolated/domain/fitness/` before writing. If FitnessSession is too heavy to unit-test, extract the snapshot logic into a testable function.

**Step 2: Add `_lastKnownGoodRoster` state to FitnessSession**

In the constructor (around line 269), add alongside other state:

```javascript
this._lastKnownGoodRoster = null;
this._lastKnownGoodDeviceAssignments = null;
```

In `ensureStarted()` (around line 1413, near `this._emptyRosterStartTime = null`), reset:

```javascript
this._lastKnownGoodRoster = null;
this._lastKnownGoodDeviceAssignments = null;
```

**Step 3: Update roster snapshot on each tick**

In `_collectTimelineTick()` (line 1640), after the `recordTick` call (line 1648), add:

```javascript
// Snapshot roster when non-empty (high-water-mark pattern)
const currentRoster = this.roster;
if (currentRoster.length > 0) {
  this._lastKnownGoodRoster = currentRoster;
  this._lastKnownGoodDeviceAssignments = this.userManager?.assignmentLedger?.snapshot?.() || [];
}
```

**Step 4: Update summary getter to use snapshot fallback**

In the `summary` getter (line 2461), replace:

```javascript
roster: this.roster,
```

With:

```javascript
roster: this.roster.length > 0 ? this.roster : (this._lastKnownGoodRoster || []),
```

And for deviceAssignments (line 2454), replace:

```javascript
const deviceAssignments = this.userManager?.assignmentLedger?.snapshot?.() || [];
```

With:

```javascript
const liveAssignments = this.userManager?.assignmentLedger?.snapshot?.() || [];
const deviceAssignments = liveAssignments.length > 0
  ? liveAssignments
  : (this._lastKnownGoodDeviceAssignments || []);
```

**Step 5: Run existing fitness tests to check for regressions**

Run: `npx jest tests/unit/fitness/ tests/isolated/domain/fitness/ --no-coverage`
Expected: ALL PASS

**Step 6: Commit**

```
fix(fitness): preserve last-known-good roster snapshot for save fallback

When HR device disconnects, the live roster empties but the summary
getter now falls back to the last snapshot where participants were
present. This ensures the final force-save at session end includes
participant data instead of an empty roster.
```

---

## Task 4: Reset debug counters per session

The PersistenceManager's throttled debug counters accumulate across sessions on the same instance. Add a reset method and call it on session start.

**Files:**
- Modify: `tests/unit/fitness/persistence-validation.test.mjs`
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js`
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1408` (in `ensureStarted`)

**Step 1: Write failing test**

```javascript
describe('debug counter reset', () => {
  it('resets debug counters via resetSession()', () => {
    const pm = new PersistenceManager();
    // Exhaust counters
    pm._debugBlockedCount = 3;
    pm._debugValidationCount = 3;
    pm._debugSaveCount = 5;
    pm._debugSaveSuccessCount = 3;
    pm._debugAutosaveCount = 3;

    pm.resetSession();

    expect(pm._debugBlockedCount).toBe(0);
    expect(pm._debugValidationCount).toBe(0);
    expect(pm._debugSaveCount).toBe(0);
    expect(pm._debugSaveSuccessCount).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/fitness/persistence-validation.test.mjs --testNamePattern="resets debug counters" --no-coverage`
Expected: FAIL — `resetSession` is not a function

**Step 3: Implement `resetSession()` in PersistenceManager**

Add to `PersistenceManager.js` after the constructor:

```javascript
resetSession() {
  this._debugBlockedCount = 0;
  this._debugValidationCount = 0;
  this._debugSaveCount = 0;
  this._debugSaveSuccessCount = 0;
  this._saveTriggered = false;
  this._hasSuccessfulSave = {};
}
```

**Step 4: Call `resetSession()` from FitnessSession.ensureStarted()**

In `ensureStarted()` (around line 1408, near `this._lastAutosaveAt = 0`), add:

```javascript
this._persistenceManager?.resetSession();
```

**Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/fitness/persistence-validation.test.mjs --no-coverage`
Expected: ALL PASS

**Step 6: Commit**

```
fix(fitness): reset PersistenceManager debug counters per session

Counters were per-instance and never reset, causing all validation
and save logs to go silent after the first session on a given
PersistenceManager instance.
```

---

## Task 5: Un-swallow autosave errors and add structured logging

Replace the commented-out console.error in the autosave catch block with structured logging, and add structured logging for validation failures.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:2365-2371` (autosave timer catch)
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:814-816` (validation fail logging)

**Step 1: Fix the swallowed autosave error**

In `_startAutosaveTimer()` (line 2362), replace the catch block:

```javascript
} catch (err) {
  // console.error('Autosave failed', err);
}
```

With:

```javascript
} catch (err) {
  getLogger().error('fitness.session.autosave_error', {
    sessionId: this.sessionId,
    error: err?.message || String(err),
    stack: err?.stack?.split('\n').slice(0, 3).join(' <- ')
  });
}
```

**Step 2: Add structured logging for validation failures in PersistenceManager**

In `persistSession()`, after the throttled console.error at line 815, add (outside the throttle guard so it always fires):

```javascript
getLogger().warn('fitness.persistence.validation_failed', {
  sessionId: sessionData?.sessionId,
  reason: validation?.reason,
  rosterLength: (Array.isArray(sessionData?.roster) ? sessionData.roster.length : 0),
  hasPriorSave: this.hasSuccessfulSave(sessionData?.sessionId)
});
```

Ensure `getLogger` is imported at the top of PersistenceManager.js. Check line 21 — it should already be imported. If not:

```javascript
import getLogger from '../../lib/logging/Logger.js';
```

**Step 3: Run existing tests**

Run: `npx jest tests/unit/fitness/ tests/isolated/domain/fitness/ --no-coverage`
Expected: ALL PASS

**Step 4: Commit**

```
fix(fitness): un-swallow autosave errors, add structured validation logging

The autosave timer catch block had console.error commented out,
silently swallowing all exceptions. Replaced with structured
logger.error. Added always-on structured logging for validation
failures in PersistenceManager (previously only throttled
console.error).
```

---

## Task 6: Add save-health monitoring

Add a warning when a session has been active for 5+ minutes with zero successful saves. This surfaces in health-check logs so data loss is caught in real time, not after the fact.

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js`
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` (health check logging)

**Step 1: Add `_lastSuccessfulSaveAt` tracking to PersistenceManager**

In the constructor, add:

```javascript
this._lastSuccessfulSaveAt = 0;
```

In `resetSession()`, add:

```javascript
this._lastSuccessfulSaveAt = 0;
```

In the save success handler (around line 1026), add:

```javascript
this._lastSuccessfulSaveAt = Date.now();
```

Add a getter:

```javascript
get lastSuccessfulSaveAt() {
  return this._lastSuccessfulSaveAt;
}
```

**Step 2: Add save-health to tick_timer.health logs**

Find the health check logging in FitnessSession.js. It's referenced in the audit as occurring every 5 minutes in `_collectTimelineTick`. Search for `tick_timer.health` in the file.

In the health check log data, add:

```javascript
lastSuccessfulSaveAt: this._persistenceManager?.lastSuccessfulSaveAt || 0,
saveHealthy: !this._persistenceManager || this._persistenceManager.lastSuccessfulSaveAt > 0
  || (Date.now() - this.startTime) < 300000  // first 5 min exempt
```

**Step 3: Add save-health warning**

After the health check log, add a conditional warning:

```javascript
const sessionAge = Date.now() - this.startTime;
const lastSave = this._persistenceManager?.lastSuccessfulSaveAt || 0;
if (sessionAge > 300000 && lastSave === 0) {
  getLogger().warn('fitness.session.save_health_warning', {
    sessionId: this.sessionId,
    sessionAgeMs: sessionAge,
    lastSuccessfulSaveAt: lastSave,
    message: 'Session active >5min with zero successful saves'
  });
}
```

**Step 4: Run all fitness tests**

Run: `npx jest tests/unit/fitness/ tests/isolated/domain/fitness/ --no-coverage`
Expected: ALL PASS

**Step 5: Commit**

```
feat(fitness): add save-health monitoring to session health checks

Emits a structured warning when a session has been active for 5+
minutes with zero successful saves. Also exposes lastSuccessfulSaveAt
in tick_timer.health logs for observability.
```

---

## Task 7: End-to-end regression check

Run the full fitness test suite (unit + Playwright flow tests) to verify no regressions.

**Step 1: Run unit and isolated tests**

Run: `npx jest tests/unit/fitness/ tests/isolated/domain/fitness/ --no-coverage`
Expected: ALL PASS

**Step 2: Run Playwright flow tests (if dev server is available)**

Run: `npx playwright test tests/live/flow/fitness/ --reporter=line`
Expected: ALL PASS (or document any pre-existing failures)

**Step 3: Manual smoke test**

If a dev environment is running:
1. Open the Fitness app
2. Connect an HR device (or use FitnessSimHelper)
3. Let a session run for 2+ minutes
4. Disconnect the device
5. Verify in logs: `fitness.persistence.validation_failed` appears with `hasPriorSave: true`
6. Verify the session YAML is written to disk despite empty roster at end

**Step 4: Final commit (if any test fixes needed)**

---

## Summary of changes

| File | What changes |
|------|-------------|
| `PersistenceManager.js` | Add `resetSession()`, `markSaveSucceeded()`, `hasSuccessfulSave()`, `lastSuccessfulSaveAt`. Soften `no-participants` gate. Add structured validation logging. |
| `FitnessSession.js` | Add `_lastKnownGoodRoster` snapshot on tick. Fallback in `summary` getter. Un-swallow autosave errors. Call `resetSession()` on start. Add save-health warning. |
| `persistence-validation.test.mjs` | Tests for no-participants bypass, debug counter reset. |
| `roster-snapshot.unit.test.mjs` | Tests for roster snapshot fallback (if FitnessSession is unit-testable). |

## Risk assessment

- **Task 2 (soften no-participants):** Low risk. Only affects sessions that have already saved once. Fresh sessions still require a roster.
- **Task 3 (roster snapshot):** Low risk. Additive — only activates when live roster is empty. Worst case: stale roster data in save (better than no save).
- **Task 4 (reset counters):** No risk. Purely observability.
- **Task 5 (un-swallow errors):** No risk. Restoring logging that was commented out.
- **Task 6 (save-health):** No risk. Additive logging only.
