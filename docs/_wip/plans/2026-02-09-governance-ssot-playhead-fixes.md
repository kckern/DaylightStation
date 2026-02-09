# Governance SSOT & Playhead Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three production bugs: (A) challenge `requiredCount` ignores exemptions, (B) `buildChallengeSummary` lacks exemption filtering (SSOT violation vs `_evaluateZoneRequirement`), (C) stale playhead on re-entry.

**Architecture:** Bugs A & B are both symptoms of a single root cause — two independent code paths evaluating zone requirements with different exemption logic. The fix extracts a shared `_buildZoneSummary` method that both `_evaluateZoneRequirement` and `buildChallengeSummary` call. Bug C is a separate frontend data-flow issue where the play queue caches stale `watchSeconds` from the initial API call instead of fetching fresh data on re-entry.

**Tech Stack:** JavaScript (frontend), Jest unit tests, Express/Node.js (backend API)

---

## Bug Inventory

| Bug | Symptom | Root Cause | File |
|-----|---------|------------|------|
| A | Challenge `requiredCount` = 5 even with exempt user | `assignNextChallengePreview` (line 1694) calls `_normalizeRequiredCount(rule, totalCount)` **without** `activeParticipants`, so exemption branch is dead code | `GovernanceEngine.js:1694` |
| B | Lock screen shows 0 offending users but stays locked | `buildChallengeSummary` (lines 1841-1871) has no exemption filtering; uses frozen `challenge.requiredCount` instead of recomputing | `GovernanceEngine.js:1841-1871` |
| C | Re-entering fitness session resumes at stale position | `fitnessPlayQueue` caches `watchSeconds` from initial API response; re-entry rebuilds queue item from cached data, not from a fresh backend fetch | `FitnessShow.jsx:571-572`, `FitnessPlayer.jsx:452-535` |

---

## Task 1: Add Failing Tests for Bug A (Challenge RequiredCount Ignores Exemptions)

**Files:**
- Modify: `tests/unit/governance/GovernanceEngine.test.mjs`

**Step 1: Write the failing test**

Add a new `describe` block after the existing `configure()` tests:

```javascript
describe('_normalizeRequiredCount() with exemptions', () => {
  let engine;

  beforeEach(() => {
    const mockSession = {
      roster: ['alice', 'bob', 'charlie', 'soren'],
      zoneProfileStore: null,
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#0000ff' },
          { id: 'active', name: 'Active', color: '#00ff00' },
          { id: 'warm', name: 'Warm', color: '#ffaa00' },
          { id: 'hot', name: 'Hot', color: '#ff0000' },
          { id: 'fire', name: 'Fire', color: '#ff00ff' },
        ]
      }
    };
    engine = new GovernanceEngine(mockSession);
    engine.configure({
      governed_labels: ['exercise'],
      grace_period_seconds: 30,
      exemptions: ['soren']
    }, [], {});
  });

  it('should reduce requiredCount when exempt users are in activeParticipants', () => {
    const result = engine._normalizeRequiredCount(
      'all',
      4,
      ['alice', 'bob', 'charlie', 'soren']
    );
    // 'all' of non-exempt participants = 3 (alice, bob, charlie)
    expect(result).toBe(3);
  });

  it('should NOT reduce requiredCount when activeParticipants is empty (Bug A)', () => {
    // This is the broken call path: no activeParticipants passed
    const result = engine._normalizeRequiredCount('all', 4);
    // Without activeParticipants, falls back to totalCount
    expect(result).toBe(4);
  });
});
```

**Step 2: Run test to verify it passes (baseline)**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --verbose 2>&1 | tail -20`
Expected: Both tests PASS (they test the existing `_normalizeRequiredCount` method directly — the bug is in the *callers*, not the method itself).

**Step 3: Write the test that exposes the caller bug**

Add to the same file, a new describe block:

```javascript
describe('challenge creation respects exemptions', () => {
  let engine;

  beforeEach(() => {
    const mockSession = {
      roster: ['alice', 'bob', 'charlie', 'soren'],
      zoneProfileStore: null,
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#0000ff' },
          { id: 'active', name: 'Active', color: '#00ff00' },
          { id: 'warm', name: 'Warm', color: '#ffaa00' },
          { id: 'hot', name: 'Hot', color: '#ff0000' },
          { id: 'fire', name: 'Fire', color: '#ff00ff' },
        ]
      }
    };
    engine = new GovernanceEngine(mockSession);
    engine.configure({
      governed_labels: ['exercise'],
      grace_period_seconds: 30,
      exemptions: ['soren'],
      challenges: [{
        id: 'test-challenge',
        selections: [{ id: 's1', zone: 'hot', rule: 'all', timeAllowedSeconds: 90 }],
        intervalRangeSeconds: [60, 120]
      }]
    }, [], {});
  });

  it('should compute requiredCount excluding exempt users when creating challenge preview', () => {
    // Simulate the evaluate path that creates a challenge preview
    // The engine needs active participants and zone data
    engine._latestInputs = {
      ...engine._latestInputs,
      activeParticipants: ['alice', 'bob', 'charlie', 'soren'],
      userZoneMap: { alice: 'warm', bob: 'warm', charlie: 'warm', soren: 'cool' },
      totalCount: 4
    };

    // Force evaluation to trigger challenge scheduling
    engine.phase = 'unlocked';
    engine.challengeState.activePolicyName = 'test-challenge';
    engine.challengeState.nextChallenge = null;
    engine.challengeState.activeChallenge = null;
    engine.challengeState.nextChallengeAt = Date.now() - 1000; // overdue

    engine.evaluate();

    // The preview should have requiredCount = 3 (excluding soren)
    const preview = engine.challengeState.nextChallenge;
    expect(preview).not.toBeNull();
    expect(preview.requiredCount).toBe(3); // NOT 4
  });
});
```

**Step 4: Run test to verify it fails**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --verbose --testNamePattern="challenge creation" 2>&1 | tail -20`
Expected: FAIL — `expected 3, received 4` because line 1694 omits `activeParticipants`.

**Step 5: Commit**

```bash
git add tests/unit/governance/GovernanceEngine.test.mjs
git commit -m "test: add failing tests for challenge requiredCount exemption bug"
```

---

## Task 2: Fix Bug A — Pass `activeParticipants` to `_normalizeRequiredCount` at Challenge Creation

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1694`

**Step 1: Fix the `assignNextChallengePreview` call**

At line 1694, change:
```javascript
const requiredCount = this._normalizeRequiredCount(payload.selection.rule, totalCount);
```
to:
```javascript
const requiredCount = this._normalizeRequiredCount(payload.selection.rule, totalCount, activeParticipants);
```

This is a one-line fix. The `activeParticipants` variable is already in scope (it's a parameter of the outer `_evaluateChallenges` method, captured in the closure).

**Step 2: Run test to verify it passes**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --verbose --testNamePattern="challenge creation" 2>&1 | tail -20`
Expected: PASS — `requiredCount` is now 3.

**Step 3: Run full test suite to check for regressions**

Run: `npx jest tests/unit/governance/ --verbose 2>&1 | tail -30`
Expected: All PASS.

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "fix: pass activeParticipants to _normalizeRequiredCount in challenge preview"
```

---

## Task 3: Add Failing Tests for Bug B (buildChallengeSummary SSOT Violation)

**Files:**
- Modify: `tests/unit/governance/GovernanceEngine.test.mjs`

**Step 1: Write the failing test**

Add a new describe block:

```javascript
describe('buildChallengeSummary exemption filtering (Bug B)', () => {
  let engine;

  beforeEach(() => {
    const mockSession = {
      roster: ['alice', 'bob', 'charlie', 'soren'],
      zoneProfileStore: null,
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#0000ff' },
          { id: 'active', name: 'Active', color: '#00ff00' },
          { id: 'warm', name: 'Warm', color: '#ffaa00' },
          { id: 'hot', name: 'Hot', color: '#ff0000' },
          { id: 'fire', name: 'Fire', color: '#ff00ff' },
        ]
      }
    };
    engine = new GovernanceEngine(mockSession);
    engine.configure({
      governed_labels: ['exercise'],
      grace_period_seconds: 30,
      exemptions: ['soren'],
      challenges: [{
        id: 'test-challenge',
        selections: [{ id: 's1', zone: 'hot', rule: 'all', timeAllowedSeconds: 90 }],
        intervalRangeSeconds: [60, 120]
      }]
    }, [], {});
  });

  it('should mark challenge as satisfied when all non-exempt users meet the zone', () => {
    // alice, bob, charlie are hot; soren is cool (but exempt)
    engine._latestInputs = {
      ...engine._latestInputs,
      activeParticipants: ['alice', 'bob', 'charlie', 'soren'],
      userZoneMap: { alice: 'hot', bob: 'hot', charlie: 'hot', soren: 'cool' },
      totalCount: 4
    };

    // Create an active challenge with correct requiredCount (3, from Bug A fix)
    engine.phase = 'unlocked';
    engine.challengeState.activePolicyName = 'test-challenge';
    engine.challengeState.activeChallenge = {
      id: 'test_123',
      policyId: 'test-challenge',
      policyName: 'test-challenge',
      configId: 'test-challenge',
      selectionId: 's1',
      zone: 'hot',
      rule: 'all',
      requiredCount: 3, // Correctly computed (Bug A fixed)
      timeLimitSeconds: 90,
      startedAt: Date.now() - 10000,
      expiresAt: Date.now() + 80000,
      status: 'pending',
      historyRecorded: false,
      summary: null,
      pausedAt: null,
      pausedRemainingMs: null
    };

    engine.evaluate();

    const challenge = engine.challengeState.activeChallenge;
    expect(challenge.summary).not.toBeNull();
    expect(challenge.summary.satisfied).toBe(true);
    // soren should NOT appear in missingUsers
    expect(challenge.summary.missingUsers).not.toContain('soren');
    expect(challenge.summary.metUsers).toEqual(expect.arrayContaining(['alice', 'bob', 'charlie']));
  });

  it('should not count exempt user as missing when they fail to meet zone', () => {
    // alice and bob are hot, charlie is warm, soren is cool (exempt)
    engine._latestInputs = {
      ...engine._latestInputs,
      activeParticipants: ['alice', 'bob', 'charlie', 'soren'],
      userZoneMap: { alice: 'hot', bob: 'hot', charlie: 'warm', soren: 'cool' },
      totalCount: 4
    };

    engine.phase = 'unlocked';
    engine.challengeState.activePolicyName = 'test-challenge';
    engine.challengeState.activeChallenge = {
      id: 'test_123',
      policyId: 'test-challenge',
      policyName: 'test-challenge',
      configId: 'test-challenge',
      selectionId: 's1',
      zone: 'hot',
      rule: 'all',
      requiredCount: 3,
      timeLimitSeconds: 90,
      startedAt: Date.now() - 10000,
      expiresAt: Date.now() + 80000,
      status: 'pending',
      historyRecorded: false,
      summary: null,
      pausedAt: null,
      pausedRemainingMs: null
    };

    engine.evaluate();

    const challenge = engine.challengeState.activeChallenge;
    expect(challenge.summary).not.toBeNull();
    expect(challenge.summary.satisfied).toBe(false);
    // charlie is the only non-exempt missing user
    expect(challenge.summary.missingUsers).toEqual(['charlie']);
    // soren should NOT be in missingUsers even though soren is in cool
    expect(challenge.summary.missingUsers).not.toContain('soren');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --verbose --testNamePattern="buildChallengeSummary" 2>&1 | tail -30`
Expected: FAIL — `missingUsers` contains `'soren'` (no exemption filtering in `buildChallengeSummary`), and `satisfied` is `false` even when all non-exempt users are hot (because `requiredCount` on the challenge object is stale).

**Step 3: Commit**

```bash
git add tests/unit/governance/GovernanceEngine.test.mjs
git commit -m "test: add failing tests for buildChallengeSummary exemption SSOT violation"
```

---

## Task 4: Fix Bug B — Unify `buildChallengeSummary` with Exemption Logic

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1841-1871`

**Step 1: Refactor `buildChallengeSummary` to use exemptions**

Replace lines 1841-1871:

```javascript
    const buildChallengeSummary = (challenge) => {
        if (!challenge) return null;
        const zoneId = challenge.zone;
        const zoneInfo = this._getZoneInfo(zoneId);
        const requiredRank = this._getZoneRank(zoneId) ?? 0;

        const metUsers = [];
      activeParticipants.forEach((participantId) => {
        const pZone = userZoneMap[participantId];
        if (!pZone) {
          getLogger().warn('participant.zone.lookup_failed', {
          key: participantId,
          availableKeys: Object.keys(userZoneMap),
          caller: 'GovernanceEngine.buildChallengeSummary'
          });
        }
            const pRank = this._getZoneRank(pZone) ?? 0;
        if (pRank >= requiredRank) metUsers.push(participantId);
        });

        const satisfied = metUsers.length >= challenge.requiredCount;
      const missingUsers = activeParticipants.filter((participantId) => !metUsers.includes(participantId));

        return {
            satisfied,
            metUsers,
            missingUsers,
            actualCount: metUsers.length,
            zoneLabel: zoneInfo?.name || zoneId
        };
    };
```

With this version that recomputes `requiredCount` live and filters exempt users from `missingUsers`:

```javascript
    const buildChallengeSummary = (challenge) => {
        if (!challenge) return null;
        const zoneId = challenge.zone;
        const zoneInfo = this._getZoneInfo(zoneId);
        const requiredRank = this._getZoneRank(zoneId) ?? 0;

        const metUsers = [];
        activeParticipants.forEach((participantId) => {
          const pZone = userZoneMap[participantId];
          if (!pZone) {
            getLogger().warn('participant.zone.lookup_failed', {
              key: participantId,
              availableKeys: Object.keys(userZoneMap),
              caller: 'GovernanceEngine.buildChallengeSummary'
            });
          }
          const pRank = this._getZoneRank(pZone) ?? 0;
          if (pRank >= requiredRank) metUsers.push(participantId);
        });

        // Recompute requiredCount from current roster (not frozen value)
        const liveRequiredCount = this._normalizeRequiredCount(challenge.rule, totalCount, activeParticipants);
        const satisfied = metUsers.length >= liveRequiredCount;

        // Filter exempt users from missingUsers (same logic as _evaluateZoneRequirement)
        const exemptUsers = (this.config.exemptions || []).map(u => normalizeName(u));
        const missingUsers = activeParticipants.filter((participantId) =>
          !metUsers.includes(participantId) && !exemptUsers.includes(normalizeName(participantId))
        );

        return {
            satisfied,
            metUsers,
            missingUsers,
            actualCount: metUsers.length,
            requiredCount: liveRequiredCount,
            zoneLabel: zoneInfo?.name || zoneId
        };
    };
```

Key changes:
1. **`liveRequiredCount`** — calls `_normalizeRequiredCount(challenge.rule, totalCount, activeParticipants)` instead of reading frozen `challenge.requiredCount`. This means if roster changes mid-challenge (user removed), the count adjusts immediately.
2. **`exemptUsers` filter** — mirrors the identical logic from `_evaluateZoneRequirement` (lines 1563-1566). Exempt users won't appear in `missingUsers`.
3. **Returns `requiredCount`** — so consumers can see the live value.

**Step 2: Run test to verify it passes**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --verbose --testNamePattern="buildChallengeSummary" 2>&1 | tail -30`
Expected: PASS.

**Step 3: Run full governance tests**

Run: `npx jest tests/unit/governance/ --verbose 2>&1 | tail -30`
Expected: All PASS.

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "fix: unify buildChallengeSummary with exemption logic from _evaluateZoneRequirement"
```

---

## Task 5: Add Failing Test for Recovery Path (Stale `requiredCount` Blocks Recovery)

**Files:**
- Modify: `tests/unit/governance/GovernanceEngine.test.mjs`

**Step 1: Write the failing test**

```javascript
describe('challenge recovery after roster change', () => {
  let engine;

  beforeEach(() => {
    const mockSession = {
      roster: ['alice', 'bob', 'charlie', 'soren'],
      zoneProfileStore: null,
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#0000ff' },
          { id: 'active', name: 'Active', color: '#00ff00' },
          { id: 'warm', name: 'Warm', color: '#ffaa00' },
          { id: 'hot', name: 'Hot', color: '#ff0000' },
          { id: 'fire', name: 'Fire', color: '#ff00ff' },
        ]
      }
    };
    engine = new GovernanceEngine(mockSession);
    engine.configure({
      governed_labels: ['exercise'],
      grace_period_seconds: 30,
      exemptions: ['soren'],
      challenges: [{
        id: 'test-challenge',
        selections: [{ id: 's1', zone: 'hot', rule: 'all', timeAllowedSeconds: 90 }],
        intervalRangeSeconds: [60, 120]
      }]
    }, [], {});
  });

  it('should recover from failed challenge when roster shrinks and remaining users meet zone', () => {
    // Scenario: challenge was created with requiredCount=5 (bug), then expired as failed.
    // User removes soren from roster. Now 3 non-exempt users all at hot.
    // The challenge should recover (satisfied=true).
    engine._latestInputs = {
      ...engine._latestInputs,
      activeParticipants: ['alice', 'bob', 'charlie'], // soren removed
      userZoneMap: { alice: 'hot', bob: 'hot', charlie: 'hot' },
      totalCount: 3
    };

    engine.phase = 'unlocked';
    engine.challengeState.activePolicyName = 'test-challenge';
    engine.challengeState.videoLocked = true;
    engine.challengeState.activeChallenge = {
      id: 'test_123',
      policyId: 'test-challenge',
      policyName: 'test-challenge',
      configId: 'test-challenge',
      selectionId: 's1',
      zone: 'hot',
      rule: 'all',
      requiredCount: 5, // Stale value from before exemption fix
      timeLimitSeconds: 90,
      startedAt: Date.now() - 100000,
      expiresAt: Date.now() - 10000, // expired
      status: 'failed',
      historyRecorded: false,
      summary: { satisfied: false, metUsers: ['alice', 'bob', 'charlie'], missingUsers: ['soren'], actualCount: 3, zoneLabel: 'Hot' },
      pausedAt: null,
      pausedRemainingMs: null
    };

    engine.evaluate();

    const challenge = engine.challengeState.activeChallenge;
    // With live recomputation, requiredCount should be 3 (all non-exempt in roster)
    // 3 met >= 3 required → satisfied → recovery
    expect(challenge.status).toBe('success');
    expect(engine.challengeState.videoLocked).toBe(false);
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --verbose --testNamePattern="challenge recovery" 2>&1 | tail -20`
Expected: PASS — because the Task 4 fix already makes `buildChallengeSummary` recompute `requiredCount` live. The recovery path at line 1992 checks `challenge.summary?.satisfied`, and the refreshed summary now returns `satisfied: true`.

If this test fails, it means there's an additional issue in the recovery path (lines 1991-2028) that also reads `challenge.requiredCount` directly — investigate and fix.

**Step 3: Commit**

```bash
git add tests/unit/governance/GovernanceEngine.test.mjs
git commit -m "test: add recovery test for challenge with stale requiredCount after roster change"
```

---

## Task 6: Add Failing Test for Bug C (Stale Playhead on Re-Entry)

**Files:**
- Modify: `tests/unit/governance/GovernanceEngine.test.mjs` (or a new test file if more appropriate)
- Create: `tests/unit/fitness/FitnessPlayQueue.test.mjs` (if needed — this is a frontend component test)

**Context:** Bug C is a frontend data-flow issue, not a GovernanceEngine bug. The stale playhead happens because:

1. User enters FitnessShow → API returns `watchSeconds: 3256` → queue item created with `watchSeconds: 3256`
2. During playback, `play.log` POST updates the backend to `watchSeconds: 3647`
3. User exits (lock screen / back button)
4. User re-enters FitnessShow → the episode data still has the old `watchSeconds: 3256` from the cached API response
5. A new queue item is created with `watchSeconds: 3256` → player seeks to 3256 instead of 3647

**Step 1: Identify the fix location**

The fix needs to happen in `FitnessShow.jsx` at the point where a queue item is created (around line 560-588). Before building the queue item, the component should fetch the latest playhead from the backend for the specific episode being played.

However, since `FitnessShow.jsx` already has the episode data from a `useEffect` that fetches `/api/fitness/show/:id/playable`, the real fix is to **re-fetch the playable data when the component mounts** rather than relying on a cached response.

**Step 2: Investigate the fetch pattern**

Look at how the show data is fetched in FitnessShow. The fix should ensure the fetch happens on every mount (re-entry), not just the first mount.

**Step 3: This is a UX/data-flow fix, not a unit-testable function**

Bug C is best verified with a manual test or a Playwright test. The fix itself is small: ensure `FitnessShow`'s data fetch is triggered on mount/re-entry and the episode list is refreshed with current `watchSeconds` from the backend.

**Step 4: Commit (placeholder — actual implementation in Task 7)**

---

## Task 7: Fix Bug C — Refresh Playhead Data on Re-Entry

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessShow.jsx`

**Step 1: Find the data fetch hook**

Look for the `useEffect` or data-fetching hook in `FitnessShow` that loads episode data from `/api/fitness/show/:id/playable`. This fetch populates the episode list including `watchSeconds`.

**Step 2: Ensure the fetch runs on every mount**

The issue is that if the component is unmounted and remounted (user exits and re-enters), the fetch should re-run. React `useEffect` with `[showId]` as dependency will re-run on mount. However, if the component is kept mounted (e.g., via route caching or React key reuse), the stale data persists.

**Fix approach:** Add a `remountKey` or version counter that increments each time the user enters the fitness player, forcing a fresh fetch. Alternatively, if the show component is re-mounted each time, the existing `useEffect` should already re-fetch — investigate whether there's caching (e.g., `useSWR` or a React Query cache) that prevents a fresh fetch.

**Step 3: If the issue is at queue-item creation time**

An alternative fix: when creating the queue item in `handleEpisodeClick` (line 560-588), fetch the latest playhead for that specific episode from the backend before setting `watchSeconds`. This is a targeted fix:

```javascript
// Before creating queueItem, fetch latest playhead
const freshPlayhead = await fetch(`/api/v1/play/progress?contentId=plex:${episode.id}`);
const progressData = await freshPlayhead.json();
const latestSeconds = progressData?.playhead ?? resolvedSeconds;
```

Then use `latestSeconds` instead of `resolvedSeconds` in the queue item.

**Note:** The exact fix depends on which data-fetching pattern FitnessShow uses. The implementer should:
1. Read the full FitnessShow component to find the episode data fetch
2. Determine whether the data is cached or re-fetched on mount
3. Choose the simplest fix: either force re-fetch or fetch latest playhead at play time

**Step 4: Verify manually**

1. Start a fitness session, play a video for 60+ seconds
2. Exit (back button or lock screen)
3. Re-enter the same show
4. Click the same episode — verify it resumes from the last position, not the original

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessShow.jsx
git commit -m "fix: refresh playhead data on fitness re-entry to prevent stale resume position"
```

---

## Task 8: Run Full Test Suite and Verify

**Files:**
- None (verification only)

**Step 1: Run all governance unit tests**

Run: `npx jest tests/unit/governance/ --verbose 2>&1 | tail -30`
Expected: All PASS.

**Step 2: Run broader test suite for regressions**

Run: `npx jest tests/unit/ --verbose 2>&1 | tail -30`
Expected: All PASS.

**Step 3: If integrated tests exist, run them**

Run: `npx jest tests/integrated/ --verbose 2>&1 | tail -30`
Expected: All PASS (or known-failing tests only).

**Step 4: Manual smoke test**

If a dev server is available:
1. Start a fitness session with multiple users
2. Configure one user as exempt
3. Verify warnings don't trigger for exempt user
4. Verify challenges don't count exempt user in `requiredCount`
5. Verify lock screen shows only non-exempt missing users
6. Remove a user mid-session → verify challenge adjusts
7. Exit and re-enter → verify playhead resumes correctly

**Step 5: Commit (if any test fixes needed)**

---

## Summary of Changes

| Task | Type | Description |
|------|------|-------------|
| 1 | Test | Failing tests for Bug A (requiredCount ignores exemptions) |
| 2 | Fix | One-line fix: pass `activeParticipants` to `_normalizeRequiredCount` at line 1694 |
| 3 | Test | Failing tests for Bug B (buildChallengeSummary lacks exemption filtering) |
| 4 | Fix | Refactor `buildChallengeSummary` to recompute `requiredCount` live and filter exempt users |
| 5 | Test | Recovery test (stale requiredCount blocks recovery after roster change) |
| 6 | Research | Identify Bug C fix location (stale playhead) |
| 7 | Fix | Refresh playhead data on fitness re-entry |
| 8 | Verify | Full test suite and manual smoke test |
