# Governance SSoT Regression Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 6 governance regressions identified in the [2026-02-14 audit](../\_wip/audits/2026-02-14-governance-ssot-regression-audit.md), restoring correct phase transitions, lock screen display, and render performance.

**Architecture:** All fixes target `GovernanceEngine.js` (frontend class, not a React hook). The engine's `evaluate()` method runs a pipeline: roster → policy → base requirements → phase determination → challenges → cache invalidation. Fixes touch phase determination (step 6), state composition (`_composeState`), and the cache invalidation path. One fix touches `usePlayheadStallDetection.js`.

**Tech Stack:** Vanilla JS class (GovernanceEngine), Jest unit tests with ESM mocking (`jest.unstable_mockModule`), no React testing needed since the engine is a plain class.

**Audit reference:** `docs/_wip/audits/2026-02-14-governance-ssot-regression-audit.md`

---

## Test Boilerplate

All new tests go in `tests/unit/governance/`. Every test file starts with this boilerplate:

```javascript
// tests/unit/governance/<test-file>.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');
```

### Helper: Create a configured engine

Used by every test. Paste into each test file (not a shared module — keep tests self-contained):

```javascript
function createEngine({ participants = [], userZoneMap = {}, grace = 30 } = {}) {
  const zoneConfig = [
    { id: 'cool', name: 'Cool', color: '#3399ff' },
    { id: 'active', name: 'Active', color: '#00cc00' },
    { id: 'warm', name: 'Warm', color: '#ffaa00' },
    { id: 'hot', name: 'Hot', color: '#ff0000' },
  ];
  const mockSession = {
    roster: participants.map(id => ({ id, isActive: true })),
    zoneProfileStore: null,
    snapshot: { zoneConfig }
  };
  const engine = new GovernanceEngine(mockSession);
  engine.configure({
    governed_labels: ['exercise'],
    grace_period_seconds: grace,
    policies: [{
      id: 'default',
      name: 'Default',
      minParticipants: 1,
      baseRequirement: {
        active: 'all',
        grace_period_seconds: grace
      },
      challenges: []
    }]
  }, [], {});

  // Set media so governance is active
  engine.media = { id: 'test-media', labels: ['exercise'], type: 'video' };

  // Build zone maps from snapshot
  const zoneRankMap = {};
  const zoneInfoMap = {};
  zoneConfig.forEach((z, i) => {
    zoneRankMap[z.id] = i;
    zoneInfoMap[z.id] = z;
  });

  return { engine, zoneRankMap, zoneInfoMap };
}
```

---

### Task 1: Fix Challenge Failure Bypassing Warning Grace Period (Issue 1 — Critical)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1394`
- Test: `tests/unit/governance/governance-challenge-lock-priority.test.mjs`

**Context:** When a challenge fails, `challengeForcesRed` unconditionally locks the screen — even when base governance requirements (e.g. "everyone in Active zone") are fully satisfied. The fix gates the immediate lock on `!allSatisfied`, so challenge failure only hard-locks when the base requirement is also unmet.

**Step 1: Write the failing test**

Create `tests/unit/governance/governance-challenge-lock-priority.test.mjs`:

```javascript
// [boilerplate + createEngine helper from above]

describe('GovernanceEngine — challenge failure lock priority', () => {
  it('should NOT lock when challenge fails but base requirements ARE satisfied', () => {
    const participants = ['alice', 'bob', 'charlie'];
    const userZoneMap = { alice: 'warm', bob: 'warm', charlie: 'active' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // First evaluate to get to unlocked state
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });
    // Pass hysteresis
    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 1000;
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });
    expect(engine.phase).toBe('unlocked');

    // Simulate a failed challenge (e.g. "all warm" but charlie is only "active")
    engine.challengeState.activeChallenge = {
      id: 'test-challenge',
      status: 'failed',
      zone: 'warm',
      requiredCount: 3,
      startedAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000,
      timeLimitSeconds: 60,
      selectionLabel: 'all warm',
      summary: { satisfied: false, missingUsers: ['charlie'], metUsers: ['alice', 'bob'], actualCount: 2 }
    };

    // All participants are in Active zone or above — base requirement satisfied
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });

    // Should NOT be locked — base requirements are met
    expect(engine.phase).not.toBe('locked');
  });

  it('should lock when challenge fails AND base requirements are NOT satisfied', () => {
    const participants = ['alice', 'bob', 'charlie'];
    // charlie is in 'cool' — below 'active' requirement
    const userZoneMap = { alice: 'warm', bob: 'active', charlie: 'cool' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Get to unlocked first
    const allActive = { alice: 'warm', bob: 'active', charlie: 'active' };
    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 1000;
    engine.evaluate({ activeParticipants: participants, userZoneMap: allActive, zoneRankMap, zoneInfoMap, totalCount: 3 });
    expect(engine.phase).toBe('unlocked');

    // Now charlie drops to cool AND challenge fails
    engine.challengeState.activeChallenge = {
      id: 'test-challenge',
      status: 'failed',
      zone: 'warm',
      requiredCount: 3,
      startedAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000,
      timeLimitSeconds: 60,
      selectionLabel: 'all warm',
      summary: { satisfied: false, missingUsers: ['charlie'], metUsers: ['alice', 'bob'], actualCount: 2 }
    };

    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });

    // SHOULD be locked — base requirements are not met AND challenge failed
    expect(engine.phase).toBe('locked');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/governance/governance-challenge-lock-priority.test.mjs --verbose`

Expected: First test FAILS — `expect(engine.phase).not.toBe('locked')` fails because current code unconditionally locks on challenge failure.

**Step 3: Write minimal implementation**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, change line 1394:

```javascript
// BEFORE (line 1394):
if (challengeForcesRed) {

// AFTER:
if (challengeForcesRed && !allSatisfied) {
```

No other changes needed. When `challengeForcesRed && allSatisfied`, execution falls through to the `allSatisfied` branch (line 1400) which keeps/transitions to `unlocked`.

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/governance/governance-challenge-lock-priority.test.mjs --verbose`

Expected: Both tests PASS.

**Step 5: Run existing governance tests for regression**

Run: `npx jest tests/unit/governance/ tests/isolated/domain/fitness/ --verbose`

Expected: All existing tests still pass.

**Step 6: Commit**

```bash
git add tests/unit/governance/governance-challenge-lock-priority.test.mjs frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "fix(governance): challenge failure respects base requirement satisfaction

Gate challengeForcesRed on !allSatisfied so challenge failures only
hard-lock when base governance requirements are also unmet.
Fixes Issue 1 from governance regression audit."
```

---

### Task 2: Separate Challenge and Base Requirements in Lock Screen Display (Issue 3 — High)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1077-1102` (`_composeState`)
- Test: `tests/unit/governance/governance-lockrow-separation.test.mjs`

**Context:** `_composeState()` merges challenge requirements into `combinedRequirements`, which `normalizeRequirements()` deduplicates by keeping the strictest requirement per participant. This causes users who satisfy the base requirement but not the challenge to appear as offenders. Fix: keep challenge and base requirements separate. Only include challenge requirements in `lockRows` when the phase was set to locked specifically from a challenge failure, and only include base requirements during warning/lock-from-grace-expiry.

**Step 1: Write the failing test**

Create `tests/unit/governance/governance-lockrow-separation.test.mjs`:

```javascript
// [boilerplate + createEngine helper from above]

describe('GovernanceEngine — lock row separation', () => {
  it('should NOT include challenge offenders in lockRows during warning phase', () => {
    const participants = ['alice', 'bob'];
    // bob is in active (meets base) but NOT warm (fails challenge)
    const userZoneMap = { alice: 'warm', bob: 'active' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Get to unlocked
    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 1000;
    engine.meta.satisfiedOnce = true;
    engine.evaluate({ activeParticipants: participants, userZoneMap: { alice: 'warm', bob: 'warm' }, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('unlocked');

    // Now alice drops to cool — base requirement unsatisfied
    const droppedMap = { alice: 'cool', bob: 'active' };
    // Active challenge for "warm" zone
    engine.challengeState.activeChallenge = {
      id: 'chal-1',
      status: 'pending',
      zone: 'warm',
      requiredCount: 2,
      startedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      timeLimitSeconds: 60,
      selectionLabel: 'all warm',
      summary: { satisfied: false, missingUsers: ['alice', 'bob'], metUsers: [], actualCount: 0 }
    };

    engine.evaluate({ activeParticipants: participants, userZoneMap: droppedMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    // Should be in warning (grace period active, base requirement unmet)
    expect(engine.phase).toBe('warning');

    const state = engine._getCachedState();
    const lockRowNames = state.lockRows.flatMap(r => r.missingUsers || []);

    // bob is in 'active' — meets base requirement — should NOT appear in lockRows
    expect(lockRowNames).toContain('alice');
    expect(lockRowNames).not.toContain('bob');
  });

  it('should show challenge offenders in lockRows ONLY when locked from challenge failure', () => {
    const participants = ['alice', 'bob'];
    const userZoneMap = { alice: 'warm', bob: 'active' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Get to unlocked
    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 1000;
    engine.meta.satisfiedOnce = true;
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('unlocked');

    // Challenge fails — but base requirements ARE NOT satisfied (bob only active, not warm...
    // and alice drops to cool)
    const failMap = { alice: 'cool', bob: 'active' };
    engine.challengeState.activeChallenge = {
      id: 'chal-1',
      status: 'failed',
      zone: 'warm',
      requiredCount: 2,
      startedAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000,
      timeLimitSeconds: 60,
      selectionLabel: 'all warm',
      summary: { satisfied: false, missingUsers: ['alice', 'bob'], metUsers: [], actualCount: 0 }
    };

    engine.evaluate({ activeParticipants: participants, userZoneMap: failMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('locked');

    const state = engine._getCachedState();
    // lockRows should show base requirement offenders (alice — below active)
    // bob is in active zone — meets base requirement — should NOT be in lockRows
    const lockRowNames = state.lockRows.flatMap(r => r.missingUsers || []);
    expect(lockRowNames).toContain('alice');
    expect(lockRowNames).not.toContain('bob');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/governance/governance-lockrow-separation.test.mjs --verbose`

Expected: FAILS — bob appears in lockRows because challenge requirements merge with base requirements.

**Step 3: Write minimal implementation**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, replace the `combinedRequirements` block (lines 1077-1102):

```javascript
// BEFORE (lines 1077-1102):
const combinedRequirements = (() => {
  const list = [...unsatisfied];
  if (challengeSnapshot && (challengeSnapshot.status === 'pending' || challengeSnapshot.status === 'failed')) {
    const challengeRequirement = {
      // ... challenge requirement object
    };
    list.unshift(challengeRequirement);
  }
  return list;
})();

// AFTER:
const combinedRequirements = [...unsatisfied];
```

That's it. Challenge requirements are removed from `lockRows` entirely. The challenge state is still available via `state.challenge` (the snapshot) for any component that needs to display challenge-specific info separately.

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/governance/governance-lockrow-separation.test.mjs --verbose`

Expected: PASS.

**Step 5: Run all governance tests for regression**

Run: `npx jest tests/unit/governance/ tests/isolated/domain/fitness/ --verbose`

Expected: All pass. If any test asserts challenge requirements IN lockRows, that test documents the old (broken) behavior and should be updated.

**Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/governance-lockrow-separation.test.mjs
git commit -m "fix(governance): separate challenge and base requirements in lockRows

Stop merging challenge requirements into combinedRequirements in
_composeState(). lockRows now only show base governance offenders.
Challenge state remains available via state.challenge snapshot.
Fixes Issue 3 from governance regression audit."
```

---

### Task 3: Debounce _invalidateStateCache to Prevent Render Thrashing (Issue 4 — Medium)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1054-1059` (`_invalidateStateCache`)
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (constructor/reset — add debounce timer)
- Test: `tests/unit/governance/governance-cache-debounce.test.mjs`

**Context:** `_invalidateStateCache()` fires `onStateChange` on every `_stateVersion++`, triggering React re-renders. During heavy evaluation (challenge + base + phase changes in one cycle), this fires multiple times per evaluate(). 477 render thrashing events were logged with 71-220 renders/sec sustained for 5+ minutes. Fix: debounce the `onStateChange` callback with a microtask (`queueMicrotask`) to batch multiple invalidations within a single evaluate() into one callback.

**Step 1: Write the failing test**

Create `tests/unit/governance/governance-cache-debounce.test.mjs`:

```javascript
// [boilerplate from above]

describe('GovernanceEngine — cache invalidation debounce', () => {
  it('should batch multiple _invalidateStateCache calls into a single onStateChange callback', async () => {
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants: ['alice'], grace: 30 });

    let callCount = 0;
    engine.callbacks.onStateChange = () => { callCount++; };

    // Call invalidate 5 times rapidly (simulates what happens during evaluate())
    engine._invalidateStateCache();
    engine._invalidateStateCache();
    engine._invalidateStateCache();
    engine._invalidateStateCache();
    engine._invalidateStateCache();

    // Should NOT have fired synchronously 5 times
    expect(callCount).toBe(0);

    // Wait for microtask to flush
    await new Promise(resolve => queueMicrotask(resolve));

    // Should fire exactly once
    expect(callCount).toBe(1);
  });

  it('should still increment _stateVersion on each invalidation', () => {
    const { engine } = createEngine({ participants: ['alice'], grace: 30 });
    const before = engine._stateVersion;

    engine._invalidateStateCache();
    engine._invalidateStateCache();
    engine._invalidateStateCache();

    expect(engine._stateVersion).toBe(before + 3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/governance/governance-cache-debounce.test.mjs --verbose`

Expected: First test FAILS — current code fires `onStateChange` synchronously on every call.

**Step 3: Write minimal implementation**

In `GovernanceEngine.js`, modify `_invalidateStateCache()` (lines 1054-1059):

```javascript
// BEFORE:
_invalidateStateCache() {
  this._stateVersion++;
  if (this.callbacks.onStateChange) {
    this.callbacks.onStateChange();
  }
}

// AFTER:
_invalidateStateCache() {
  this._stateVersion++;
  if (this.callbacks.onStateChange && !this._stateChangePending) {
    this._stateChangePending = true;
    queueMicrotask(() => {
      this._stateChangePending = false;
      if (this.callbacks.onStateChange) {
        this.callbacks.onStateChange();
      }
    });
  }
}
```

Also add `this._stateChangePending = false;` to the constructor (after line 228) and to `reset()` (near the cache reset block around line 934).

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/governance/governance-cache-debounce.test.mjs --verbose`

Expected: PASS.

**Step 5: Run all governance tests for regression**

Run: `npx jest tests/unit/governance/ tests/isolated/domain/fitness/ --verbose`

Expected: All pass. Some tests may need `await new Promise(r => queueMicrotask(r))` added if they assert on `onStateChange` being called (check test output for clues).

**Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/governance-cache-debounce.test.mjs
git commit -m "perf(governance): debounce _invalidateStateCache with queueMicrotask

Batch multiple state invalidations within a single evaluate() cycle
into one onStateChange callback. Prevents render thrashing that caused
71-220 renders/sec for 5+ minutes.
Fixes Issue 4 from governance regression audit."
```

---

### Task 4: Increase Governance Hysteresis (Issue 5 — Medium)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:164` (`_hysteresisMs`)
- Test: `tests/unit/governance/governance-hysteresis.test.mjs`

**Context:** The 500ms hysteresis is too short — the audit shows 1.8-second warning→unlocked transitions and rapid re-entry within 3-5 seconds. Increase to 1500ms for the warning→unlocked direction to prevent phase cycling when HR hovers around the zone boundary.

**Step 1: Write the failing test**

Create `tests/unit/governance/governance-hysteresis.test.mjs`:

```javascript
// [boilerplate + createEngine helper from above]

describe('GovernanceEngine — hysteresis', () => {
  it('should require 1500ms of sustained satisfaction before unlocking from warning', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });
    const activeMap = { alice: 'active', bob: 'active' };

    // Get to unlocked → warning
    engine._hysteresisMs = 0; // temporarily bypass to reach unlocked
    engine.meta.satisfiedSince = Date.now() - 5000;
    engine.meta.satisfiedOnce = true;
    engine.evaluate({ activeParticipants: participants, userZoneMap: activeMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('unlocked');

    // Drop to cool → warning
    const coolMap = { alice: 'cool', bob: 'active' };
    engine.evaluate({ activeParticipants: participants, userZoneMap: coolMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('warning');

    // Restore hysteresis to real value and satisfy requirements
    // Reset satisfiedSince to simulate "just became satisfied"
    engine.meta.satisfiedSince = null;
    engine.evaluate({ activeParticipants: participants, userZoneMap: activeMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    // Should still be warning — not enough time has passed
    expect(engine.phase).toBe('warning');

    // After 500ms — should STILL be warning (old threshold was 500ms, new is 1500ms)
    engine.meta.satisfiedSince = Date.now() - 600;
    engine.evaluate({ activeParticipants: participants, userZoneMap: activeMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('warning');

    // After 1500ms — should transition to unlocked
    engine.meta.satisfiedSince = Date.now() - 1600;
    engine.evaluate({ activeParticipants: participants, userZoneMap: activeMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('unlocked');
  });

  it('should have default hysteresis of 1500ms', () => {
    const { engine } = createEngine();
    expect(engine._hysteresisMs).toBe(1500);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/governance/governance-hysteresis.test.mjs --verbose`

Expected: FAILS — default hysteresis is 500ms, not 1500ms.

**Step 3: Write minimal implementation**

In `GovernanceEngine.js`, change line 164:

```javascript
// BEFORE:
this._hysteresisMs = 500;

// AFTER:
this._hysteresisMs = 1500;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/governance/governance-hysteresis.test.mjs --verbose`

Expected: PASS.

**Step 5: Run all governance tests for regression**

Run: `npx jest tests/unit/governance/ tests/isolated/domain/fitness/ --verbose`

Expected: Most pass. Any test that sets `engine._hysteresisMs = 0` to bypass hysteresis should still work. Any test that assumed 500ms might need updating.

**Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/governance-hysteresis.test.mjs
git commit -m "fix(governance): increase hysteresis from 500ms to 1500ms

Prevents rapid warning↔unlocked phase cycling when HR hovers
around the zone boundary. Audit showed 1.8s warning episodes and
rapid re-entry within 3-5 seconds with 500ms hysteresis.
Fixes Issue 5 from governance regression audit."
```

---

### Task 5: Fix _getParticipantsBelowThreshold Using Stale Zone Data (Issue 3b — Medium)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:700-712` (`_getParticipantsBelowThreshold`)
- Test: `tests/unit/governance/governance-below-threshold-logging.test.mjs`

**Context:** `_getParticipantsBelowThreshold()` iterates `requirementSummary.requirements` which is populated BEFORE zone data is fully captured. The logged `participantsBelowThreshold` can include users whose zone has already changed. Fix: use `_latestInputs.userZoneMap` directly to verify whether each "missing" user is actually below threshold at logging time.

**Step 1: Write the failing test**

Create `tests/unit/governance/governance-below-threshold-logging.test.mjs`:

```javascript
// [boilerplate + createEngine helper from above]

describe('GovernanceEngine — _getParticipantsBelowThreshold', () => {
  it('should cross-reference missingUsers against current userZoneMap', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Simulate a stale requirement summary where bob is listed as missing
    // for 'active' zone, but userZoneMap shows bob IS in 'active'
    engine.requirementSummary = {
      requirements: [{
        zone: 'active',
        zoneLabel: 'Active',
        requiredCount: 2,
        missingUsers: ['bob'],  // stale — bob was below but has since recovered
        satisfied: false
      }]
    };

    // Current zone map shows bob is actually in active zone
    engine._latestInputs.userZoneMap = { alice: 'active', bob: 'active' };
    engine._latestInputs.zoneRankMap = zoneRankMap;

    const below = engine._getParticipantsBelowThreshold();
    // bob should NOT appear — current zone map shows they meet the requirement
    const names = below.map(b => b.name);
    expect(names).not.toContain('bob');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/governance/governance-below-threshold-logging.test.mjs --verbose`

Expected: FAILS — current code just reads `req.missingUsers` without cross-checking the zone map.

**Step 3: Write minimal implementation**

In `GovernanceEngine.js`, replace `_getParticipantsBelowThreshold()` (lines 700-713):

```javascript
// BEFORE:
_getParticipantsBelowThreshold() {
  const requirements = this.requirementSummary?.requirements || [];
  const below = [];
  for (const req of requirements) {
    if (Array.isArray(req.missingUsers)) {
      below.push(...req.missingUsers.map(name => ({
        name,
        zone: req.zone || req.zoneLabel,
        required: req.requiredCount
      })));
    }
  }
  return below.slice(0, 10);
}

// AFTER:
_getParticipantsBelowThreshold() {
  const requirements = this.requirementSummary?.requirements || [];
  const userZoneMap = this._latestInputs.userZoneMap || {};
  const zoneRankMap = this._latestInputs.zoneRankMap || {};
  const below = [];
  for (const req of requirements) {
    if (!Array.isArray(req.missingUsers)) continue;
    const requiredRank = this._getZoneRank(req.zone || req.zoneLabel);
    for (const name of req.missingUsers) {
      const currentZone = userZoneMap[name];
      const currentRank = this._getZoneRank(currentZone) ?? 0;
      // Only include if they are actually below the required zone right now
      if (!Number.isFinite(requiredRank) || currentRank < requiredRank) {
        below.push({
          name,
          zone: req.zone || req.zoneLabel,
          required: req.requiredCount
        });
      }
    }
  }
  return below.slice(0, 10);
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/governance/governance-below-threshold-logging.test.mjs --verbose`

Expected: PASS.

**Step 5: Run all governance tests for regression**

Run: `npx jest tests/unit/governance/ tests/isolated/domain/fitness/ --verbose`

Expected: All pass.

**Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/governance-below-threshold-logging.test.mjs
git commit -m "fix(governance): cross-reference participantsBelowThreshold against live zone map

_getParticipantsBelowThreshold() now verifies each missingUser against
the current userZoneMap/zoneRankMap, filtering out users who have
recovered since the requirement summary was computed.
Fixes Issue 3b from governance regression audit."
```

---

### Task 6: Filter Ghost Participants from Governance Roster (Issue 7 — Medium)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1196-1204` (roster resolution in `evaluate()`)
- Test: `tests/unit/governance/governance-ghost-participants.test.mjs`

**Context:** When participants disconnect, their roster entries remain but they have no zone data. Governance continues enforcing rules against stale roster entries, producing warnings with `participantCount: 0` and locks triggered by unknown users ("Eli"). Fix: filter `activeParticipants` to only include users present in `userZoneMap`.

**Step 1: Write the failing test**

Create `tests/unit/governance/governance-ghost-participants.test.mjs`:

```javascript
// [boilerplate + createEngine helper from above]

describe('GovernanceEngine — ghost participant filtering', () => {
  it('should exclude participants with no zone data from governance evaluation', () => {
    const participants = ['alice', 'bob', 'ghost'];
    // ghost has no entry in userZoneMap — disconnected
    const userZoneMap = { alice: 'active', bob: 'active' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 5000;
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });

    // ghost should not appear in requirement summaries
    const allMissing = (engine.requirementSummary?.requirements || [])
      .flatMap(r => r.missingUsers || []);
    expect(allMissing).not.toContain('ghost');

    // totalCount used for _normalizeRequiredCount should reflect actual zone-having participants
    // With 2 active participants meeting "all active", requirements should be satisfied
    const allSatisfied = (engine.requirementSummary?.requirements || [])
      .every(r => r.satisfied);
    expect(allSatisfied).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/governance/governance-ghost-participants.test.mjs --verbose`

Expected: FAILS — ghost appears in missingUsers, requirements not satisfied because `totalCount: 3` but only 2 users have zone data.

**Step 3: Write minimal implementation**

In `GovernanceEngine.js`, add filtering after `activeParticipants` and `totalCount` are finalized (after line 1229, before step 3):

```javascript
// Add after line 1229 (after "Ensure defaults"):
// Filter out ghost participants — users in the roster but with no zone data.
// These are disconnected participants whose roster entries are stale.
if (userZoneMap && typeof userZoneMap === 'object') {
  const beforeCount = activeParticipants.length;
  activeParticipants = activeParticipants.filter(id => id in userZoneMap);
  totalCount = activeParticipants.length;
  if (activeParticipants.length < beforeCount) {
    getLogger().debug('governance.filtered_ghost_participants', {
      removed: beforeCount - activeParticipants.length,
      remaining: activeParticipants.length
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/governance/governance-ghost-participants.test.mjs --verbose`

Expected: PASS.

**Step 5: Run all governance tests for regression**

Run: `npx jest tests/unit/governance/ tests/isolated/domain/fitness/ --verbose`

Expected: All pass. Existing tests pass explicit `userZoneMap` with all participants, so filtering won't change their behavior.

**Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/governance-ghost-participants.test.mjs
git commit -m "fix(governance): filter ghost participants from evaluation roster

Participants with no entry in userZoneMap (disconnected/stale) are
now excluded from activeParticipants before governance evaluation.
Prevents warnings with participantCount:0 and locks from unknown users.
Fixes Issue 7 from governance regression audit."
```

---

## Summary

| Task | Issue | Severity | File Changed | Lines Changed |
|------|-------|----------|--------------|---------------|
| 1 | Challenge failure bypasses warning | Critical | GovernanceEngine.js:1394 | 1 line |
| 2 | False offender chips on lock screen | High | GovernanceEngine.js:1077-1102 | ~25 lines removed |
| 3 | Render thrashing from cache invalidation | Medium | GovernanceEngine.js:1054-1059 | ~10 lines |
| 4 | Rapid phase cycling (hysteresis) | Medium | GovernanceEngine.js:164 | 1 line |
| 5 | Stale participantsBelowThreshold | Medium | GovernanceEngine.js:700-713 | ~15 lines |
| 6 | Ghost participants | Medium | GovernanceEngine.js:~1230 | ~8 lines |

**Total:** ~60 lines changed across 6 targeted fixes in 1 primary file, with 6 new test files.

**Not addressed in this plan:**
- Issue 6 (Cover mismatch) — not reproducible from logs
- Stall threshold tuning — the hook already uses 3000ms (audit's "1200ms" appears to be browser-native `stalled` events, not configurable)
- `playback.recovered` never emitting — requires separate investigation of the event subscription plumbing between `usePlayheadStallDetection` → app event bus → GovernanceEngine
