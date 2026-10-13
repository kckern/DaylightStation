# Governance Warning: Challenge Offenders Bleed-Through Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent paused challenge `missingUsers` from appearing in the governance warning overlay — only base requirement offenders should be shown during warning phase.

**Architecture:** The fix is a one-line guard in `resolveGovernanceDisplay()` that skips merging challenge `missingUsers` when the challenge is paused. The GovernanceEngine already correctly marks challenges as `paused: true` during warning phase (via `challengeSnapshot.paused`), and the display layer already receives this field — it just doesn't use it to filter rows.

**Tech Stack:** JavaScript (ES modules), Jest unit tests

---

## Bug Summary

When the governance engine enters **warning** phase (e.g., Dad drops to "cool" zone, failing the base requirement), any active challenge is **paused**. However, `resolveGovernanceDisplay()` in `useGovernanceDisplay.js` unconditionally merges the paused challenge's `missingUsers` into the warning overlay rows. This causes all participants who haven't met the *challenge* target (e.g., kids still in "active" working toward "warm") to appear as offenders alongside the actual base-requirement offender (Dad).

**Root cause:** `useGovernanceDisplay.js:41` — no guard on `challenge.paused` before merging challenge `missingUsers`.

**Affected file:** `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js:40-50`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js` | Modify (lines 40-50) | Add `!govState.challengePaused` guard |
| `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs` | Modify (add test) | Verify paused challenges don't bleed into warning rows |

---

### Task 1: Add failing test for paused-challenge bleed-through

**Files:**
- Modify: `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs`

- [ ] **Step 1: Write the failing test**

Add this test to the existing `describe('resolveGovernanceDisplay')` block in `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs`:

```javascript
test('warning phase does NOT include paused challenge missingUsers', () => {
  // Scenario: Dad is in 'cool' (failing base requirement for 'active'),
  // kids are in 'active' (fine for base req, but missing for challenge target 'warm').
  // Challenge is paused because governance is in warning phase.
  const displayMap = makeDisplayMap([
    {
      id: 'dad', displayName: 'Dad', avatarSrc: '/img/dad.jpg',
      heartRate: 85, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#94a3b8',
      progress: 0.3, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 100
    },
    {
      id: 'kid1', displayName: 'Kid1', avatarSrc: '/img/kid1.jpg',
      heartRate: 115, zoneId: 'active', zoneName: 'Active', zoneColor: '#22c55e',
      progress: 0.6, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 130
    },
    {
      id: 'kid2', displayName: 'Kid2', avatarSrc: '/img/kid2.jpg',
      heartRate: 118, zoneId: 'active', zoneName: 'Active', zoneColor: '#22c55e',
      progress: 0.65, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 130
    }
  ]);

  const result = resolveGovernanceDisplay(
    {
      isGoverned: true,
      status: 'warning',
      challengePaused: true,
      deadline: Date.now() + 20000,
      gracePeriodTotal: 30,
      requirements: [
        { zone: 'active', rule: 'all', missingUsers: ['dad'], satisfied: false }
      ],
      challenge: {
        status: 'pending',
        zone: 'warm',
        missingUsers: ['kid1', 'kid2'],
        paused: true
      }
    },
    displayMap,
    ZONE_META
  );

  expect(result.show).toBe(true);
  expect(result.status).toBe('warning');
  // Only Dad should appear — he's failing the base requirement.
  // Kids should NOT appear — they're only missing from the paused challenge.
  const rowUserIds = result.rows.map(r => r.userId);
  expect(rowUserIds).toEqual(['dad']);
  expect(rowUserIds).not.toContain('kid1');
  expect(rowUserIds).not.toContain('kid2');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs --testNamePattern="paused challenge" -v`

Expected: FAIL — `kid1` and `kid2` appear in `rowUserIds` because the paused challenge's `missingUsers` are merged.

---

### Task 2: Fix the bleed-through in resolveGovernanceDisplay

**Files:**
- Modify: `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js:40-50`

- [ ] **Step 3: Add the guard**

In `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js`, change lines 40-50 from:

```javascript
  // Challenge requirements (if active and has missing users)
  if (challenge && (challenge.status === 'pending' || challenge.status === 'failed') && Array.isArray(challenge.missingUsers)) {
```

to:

```javascript
  // Challenge requirements (if active, NOT paused, and has missing users)
  if (challenge && !challenge.paused && (challenge.status === 'pending' || challenge.status === 'failed') && Array.isArray(challenge.missingUsers)) {
```

This single guard prevents paused challenge offenders from bleeding into the warning overlay. When the challenge resumes (governance returns to unlocked), `paused` becomes `false` and challenge offenders will appear again in the locked/pending overlay as expected.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs -v`

Expected: ALL PASS — including the new "paused challenge" test. The existing tests should also pass because they don't involve paused challenges.

---

### Task 3: Add edge-case test — unpaused challenge still merges correctly

**Files:**
- Modify: `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs`

- [ ] **Step 5: Write the complementary test**

This ensures we didn't break the case where a challenge is active (not paused) and its `missingUsers` SHOULD appear (e.g., during `locked` or `pending` phase):

```javascript
test('locked phase DOES include active (non-paused) challenge missingUsers', () => {
  const displayMap = makeDisplayMap([
    {
      id: 'dad', displayName: 'Dad', avatarSrc: '/img/dad.jpg',
      heartRate: 85, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#94a3b8',
      progress: 0.3, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 100
    },
    {
      id: 'kid1', displayName: 'Kid1', avatarSrc: '/img/kid1.jpg',
      heartRate: 115, zoneId: 'active', zoneName: 'Active', zoneColor: '#22c55e',
      progress: 0.6, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 130
    }
  ]);

  const result = resolveGovernanceDisplay(
    {
      isGoverned: true,
      status: 'locked',
      challengePaused: false,
      requirements: [
        { zone: 'active', rule: 'all', missingUsers: ['dad'], satisfied: false }
      ],
      challenge: {
        status: 'failed',
        zone: 'warm',
        missingUsers: ['kid1'],
        paused: false
      }
    },
    displayMap,
    ZONE_META
  );

  expect(result.show).toBe(true);
  // Both should appear: Dad from base req, Kid1 from failed challenge
  const rowUserIds = result.rows.map(r => r.userId);
  expect(rowUserIds).toContain('dad');
  expect(rowUserIds).toContain('kid1');
});
```

- [ ] **Step 6: Run all governance display tests**

Run: `npx jest tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs -v`

Expected: ALL PASS

- [ ] **Step 7: Run broader governance test suite to check for regressions**

Run: `npx jest tests/unit/governance/ tests/isolated/domain/fitness/ -v`

Expected: ALL PASS — no regressions in other governance tests.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs
git commit -m "fix(governance): exclude paused challenge offenders from warning overlay

When governance enters warning phase, active challenges are correctly
paused but their missingUsers were still merged into the warning overlay
rows. This caused non-offending participants (e.g., kids in 'active'
zone working toward a 'warm' challenge) to appear alongside the actual
base-requirement offender.

Add challenge.paused guard in resolveGovernanceDisplay to skip merging
challenge missingUsers when the challenge is suspended."
```
