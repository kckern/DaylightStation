# Governance Challenge minParticipants Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two related bugs: (1) `_evaluateChallenges()` ignores `minParticipants` guard, allowing challenges to start with too few participants; (2) lock screen shows 0 user rows after a challenge failure because `_composeState()` and `useGovernanceDisplay` filter out failed-challenge requirements.

**Architecture:** Three surgical edits — a guard clause in `_evaluateChallenges()`, a status-condition expansion in `_composeState()`, and a status fix in `resolveGovernanceDisplay()`. Each bug gets its own failing test first.

**Tech Stack:** Jest (with `jest.useFakeTimers`), GovernanceEngine.js (frontend), useGovernanceDisplay.js (frontend)

---

### Task 1: Write failing test for minParticipants guard

**Files:**
- Modify: `tests/unit/governance/GovernanceEngine.test.mjs`

**Step 1: Write the failing test**

Add a new `describe` block at the end of the existing test file:

```javascript
describe('_evaluateChallenges() minParticipants guard', () => {
  let engine;

  beforeEach(() => {
    jest.useFakeTimers();
    engine = new GovernanceEngine({
      roster: [],
      zoneProfileStore: null,
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#94a3b8' },
          { id: 'active', name: 'Active', color: '#22c55e' },
          { id: 'warm', name: 'Warm Up', color: '#eab308' },
        ]
      }
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should NOT start a challenge when totalCount < minParticipants', () => {
    // Configure with minParticipants: 2
    engine.configure({
      governed_labels: ['exercise'],
      grace_period_seconds: 30,
      policies: {
        fitness: {
          zones: ['active'],
          rule: 'all_above',
          challenges: [{
            interval_range: [30, 60],
            minParticipants: 2,
            selections: [
              { zone: 'warm', min_participants: 'some', time_allowed: 5, label: 'some warm' }
            ]
          }]
        }
      }
    });

    // Simulate 1 active participant (below minParticipants: 2)
    const activeParticipants = ['alan'];
    const userZoneMap = { alan: 'active' };
    const zoneRankMap = { cool: 0, active: 1, warm: 2 };
    const zoneInfoMap = { cool: { name: 'Cool' }, active: { name: 'Active' }, warm: { name: 'Warm Up' } };
    const totalCount = 1;

    const activePolicy = engine._normalizedPolicies?.[0] || engine.normalizedPolicies?.[0];

    // Force a challenge to be "ready to start" by setting nextChallengeAt in the past
    engine.challengeState.nextChallengeAt = Date.now() - 1000;
    engine.challengeState.nextChallenge = { selectionLabel: 'some warm', zone: 'warm' };

    engine._evaluateChallenges(activePolicy, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount);

    // Challenge should NOT have started
    expect(engine.challengeState.activeChallenge).toBeNull();
    // Next challenge scheduling should be cleared
    expect(engine.challengeState.nextChallengeAt).toBeNull();
  });

  it('should allow challenge when totalCount >= minParticipants', () => {
    engine.configure({
      governed_labels: ['exercise'],
      grace_period_seconds: 30,
      policies: {
        fitness: {
          zones: ['active'],
          rule: 'all_above',
          challenges: [{
            interval_range: [30, 60],
            minParticipants: 2,
            selections: [
              { zone: 'warm', min_participants: 'some', time_allowed: 5, label: 'some warm' }
            ]
          }]
        }
      }
    });

    const activePolicy = engine._normalizedPolicies?.[0] || engine.normalizedPolicies?.[0];

    // 2 participants meets minParticipants: 2
    const activeParticipants = ['alan', 'bob'];
    const userZoneMap = { alan: 'active', bob: 'active' };
    const zoneRankMap = { cool: 0, active: 1, warm: 2 };
    const zoneInfoMap = { cool: { name: 'Cool' }, active: { name: 'Active' }, warm: { name: 'Warm Up' } };
    const totalCount = 2;

    engine._evaluateChallenges(activePolicy, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount);

    // Should NOT have cleared challenge state — challenge evaluation proceeds
    // (It may or may not schedule depending on internal timing, but it should NOT early-return)
    // The key assertion: it did not clear and return due to minParticipants guard
    // We verify by checking that the method progressed past the guard
    // If nextChallengeAt was null before, it should be set (scheduling happened)
    const scheduled = engine.challengeState.nextChallengeAt != null
      || engine.challengeState.activeChallenge != null;
    expect(scheduled).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --testPathPattern 'GovernanceEngine' --verbose 2>&1 | tail -30`
Expected: FAIL — the first test fails because `_evaluateChallenges` doesn't check `minParticipants`

**Step 3: Commit**

```bash
git add tests/unit/governance/GovernanceEngine.test.mjs
git commit -m "test: add failing tests for challenge minParticipants guard"
```

---

### Task 2: Implement minParticipants guard in `_evaluateChallenges()`

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1692-1693`

**Step 1: Add the guard**

After line 1692 (after the `if (!challengeConfig) { ... return; }` block), insert:

```javascript
    // Guard: don't run challenges if below minimum participant count
    if (
      Number.isFinite(challengeConfig.minParticipants) &&
      challengeConfig.minParticipants > 0 &&
      totalCount < challengeConfig.minParticipants
    ) {
      this.challengeState.activeChallenge = null;
      this.challengeState.nextChallenge = null;
      this.challengeState.nextChallengeAt = null;
      this.challengeState.nextChallengeRemainingMs = null;
      return;
    }
```

**Step 2: Run tests to verify they pass**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --testPathPattern 'GovernanceEngine' --verbose 2>&1 | tail -30`
Expected: PASS — both minParticipants tests pass

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "fix: add minParticipants guard to _evaluateChallenges()"
```

---

### Task 3: Write failing test for lock screen showing failed-challenge users

**Files:**
- Modify: `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs`

**Step 1: Write the failing test**

Add a new test to the existing `describe('resolveGovernanceDisplay', ...)` block:

```javascript
  test('includes failed challenge missingUsers in lock screen rows', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'alan', displayName: 'Alan', avatarSrc: '/img/alan.jpg',
        heartRate: 134, zoneId: 'active', zoneName: 'Active', zoneColor: '#22c55e',
        progress: 0.5, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 130
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'locked',
        videoLocked: true,
        requirements: [
          // Base requirement IS satisfied (alan is in active zone)
          { zone: 'active', rule: 'all_above', missingUsers: [], satisfied: true }
        ],
        challenge: {
          status: 'failed',
          zone: 'warm',
          missingUsers: ['alan'],
          metUsers: [],
          requiredCount: 1,
          actualCount: 0,
          selectionLabel: 'some warm'
        }
      },
      displayMap,
      ZONE_META
    );

    // Lock screen should show alan as needing to reach warm zone
    expect(result.show).toBe(true);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].userId).toBe('alan');
    expect(result.rows[0].targetZone.id).toBe('warm');
  });

  test('includes pending challenge missingUsers (existing behavior preserved)', () => {
    const displayMap = makeDisplayMap([
      {
        id: 'alan', displayName: 'Alan', avatarSrc: '/img/alan.jpg',
        heartRate: 134, zoneId: 'active', zoneName: 'Active', zoneColor: '#22c55e',
        progress: 0.5, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 130
      }
    ]);

    const result = resolveGovernanceDisplay(
      {
        isGoverned: true,
        status: 'pending',
        requirements: [],
        challenge: {
          status: 'pending',
          zone: 'warm',
          missingUsers: ['alan'],
          metUsers: [],
          requiredCount: 1,
          actualCount: 0,
          selectionLabel: 'some warm'
        }
      },
      displayMap,
      ZONE_META
    );

    expect(result.show).toBe(true);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].userId).toBe('alan');
  });
```

**Step 2: Run test to verify the first one fails**

Run: `npx jest tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs --verbose 2>&1 | tail -30`
Expected: FAIL — "includes failed challenge missingUsers" fails because `challenge.status === 'active'` never matches `'failed'` or `'pending'`

**Step 3: Commit**

```bash
git add tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs
git commit -m "test: add failing tests for failed-challenge lock screen display"
```

---

### Task 4: Fix `resolveGovernanceDisplay()` status check

**Files:**
- Modify: `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js:41`

**Step 1: Fix the status condition**

Change line 41 from:

```javascript
  if (challenge && challenge.status === 'active' && Array.isArray(challenge.missingUsers)) {
```

to:

```javascript
  if (challenge && (challenge.status === 'pending' || challenge.status === 'failed') && Array.isArray(challenge.missingUsers)) {
```

**Step 2: Run tests to verify they pass**

Run: `npx jest tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs --verbose 2>&1 | tail -30`
Expected: PASS — both new tests pass, existing tests still pass

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js
git commit -m "fix: include pending and failed challenges in lock screen display"
```

---

### Task 5: Fix `_composeState()` to include failed challenge in combinedRequirements

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1079`

**Step 1: Expand the status condition**

Change line 1079 from:

```javascript
      if (challengeSnapshot && challengeSnapshot.status === 'pending') {
```

to:

```javascript
      if (challengeSnapshot && (challengeSnapshot.status === 'pending' || challengeSnapshot.status === 'failed')) {
```

**Step 2: Run all governance tests to verify nothing breaks**

Run: `npx jest tests/unit/governance/ tests/isolated/domain/fitness/ --verbose 2>&1 | tail -40`
Expected: PASS — all tests pass

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "fix: include failed challenge requirements in lock screen combinedRequirements"
```

---

### Task 6: Run full governance test suite and verify

**Step 1: Run all governance-related tests**

Run: `npx jest tests/unit/governance/ tests/isolated/domain/fitness/ --verbose 2>&1`
Expected: All tests PASS

**Step 2: Verify no regressions in reactive tests**

Run: `npx jest tests/isolated/domain/fitness/governance-reactive.unit.test.mjs --verbose 2>&1 | tail -20`
Expected: PASS

**Step 3: Final commit (if any adjustments needed)**

If all tests pass with no adjustments, no additional commit needed.

---

## Summary of Changes

| File | Change | Bug |
|------|--------|-----|
| `GovernanceEngine.js:~1693` | Add `minParticipants` guard in `_evaluateChallenges()` | Bug 1 |
| `GovernanceEngine.js:1079` | Expand `'pending'` to `'pending' \|\| 'failed'` in `_composeState()` | Bug 2 |
| `useGovernanceDisplay.js:41` | Change `'active'` to `'pending' \|\| 'failed'` in `resolveGovernanceDisplay()` | Bug 2 |
| `GovernanceEngine.test.mjs` | Add 2 tests for minParticipants guard | Bug 1 |
| `governance-display-hook.unit.test.mjs` | Add 2 tests for failed-challenge lock screen | Bug 2 |

**Total: 3 production code changes, 4 new tests, 5 commits.**
