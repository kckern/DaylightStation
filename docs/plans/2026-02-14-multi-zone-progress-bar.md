# Multi-Zone Progress Bar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the governance lock screen progress bar represent progress toward the actual unlock target zone, not just the next zone, with intermediate zone markers and a multi-stop gradient.

**Architecture:** The existing `calculateZoneProgressTowardsTarget` function in `types.js` already computes multi-zone progress with `intermediateZones` but is dead code. We wire it into `resolveGovernanceDisplay` (where governance target + participant data meet) and update the renderer to build multi-stop gradients from intermediate zone data. Two production files change; one test file updated.

**Tech Stack:** React, Jest (isolated unit tests), existing fitness zone types

---

## Background

### Current behavior
- `deriveZoneProgressSnapshot` computes progress to the **next** zone only
- ZoneProfileStore stores that as `profile.progress`
- The lock screen shows this next-zone progress but labels the target as the governance zone (e.g., HOT)
- Result: user in COOL targeting HOT sees ~62% at HR 85 (progress toward ACTIVE), but the label says HOT

### Desired behavior
- Progress bar 0% → 100% represents the full journey from current zone to governance target
- COOL → HOT at HR 85: progress = 31% (of the 60–140 BPM span)
- Intermediate zone markers (ACTIVE at 50%, WARM at 75%) with zone colors
- Multi-stop gradient: blue → green → yellow → orange

### Data flow
```
deriveZoneProgressSnapshot (next-zone progress, stored in ZoneProfileStore)
                                          ↓
participantDisplayMap (passes through profile.progress + zoneSequence)
                                          ↓
resolveGovernanceDisplay ← NEW: calls calculateZoneProgressTowardsTarget
                          to OVERRIDE progress with target-aware progress
                          and ADD intermediateZones to each row
                                          ↓
GovernanceStateOverlay.renderProgressBlock ← NEW: builds multi-stop gradient
                                             from intermediateZones
```

### Key function: `calculateZoneProgressTowardsTarget` (types.js:368)
Already exists, already computes:
- `progress`: 0–1 across full zone span to target
- `intermediateZones`: `[{ id, name, threshold, position, color, index }]`
- `currentSegment`, `segmentsTotal`

It accepts a `snapshot` object with: `zoneSequence`, `currentZoneIndex`/`zoneIndex`, `heartRate`/`currentHR`. All available in the display map entries.

### Zone thresholds (DEFAULT_ZONE_CONFIG, types.js:182)
| Zone   | min (BPM) | Color   |
|--------|-----------|---------|
| cool   | 60        | blue    |
| active | 100       | green   |
| warm   | 120       | yellow  |
| hot    | 140       | orange  |
| fire   | 160       | red     |

---

## Task 1: Write failing tests for target-aware progress in resolveGovernanceDisplay

**Files:**
- Modify: `tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs`

**Step 1: Add test fixtures with realistic zone sequences**

The existing test fixtures use `zoneSequence: []`. We need fixtures with real zone data so `calculateZoneProgressTowardsTarget` can compute progress. Add this helper and zone sequence constant near the top of the file (after `makeDisplayMap`):

```javascript
// Realistic zone sequence matching DEFAULT_ZONE_CONFIG thresholds
const FULL_ZONE_SEQUENCE = [
  { id: 'cool', name: 'Cool', color: '#38bdf8', threshold: 60, index: 0 },
  { id: 'active', name: 'Active', color: '#22c55e', threshold: 100, index: 1 },
  { id: 'warm', name: 'Warm', color: '#eab308', threshold: 120, index: 2 },
  { id: 'hot', name: 'Hot', color: '#fb923c', threshold: 140, index: 3 },
  { id: 'fire', name: 'On Fire', color: '#ef4444', threshold: 160, index: 4 }
];
```

Also update ZONE_META to include hot and fire:

```javascript
const ZONE_META = {
  map: {
    cool: { id: 'cool', name: 'Cool', color: '#38bdf8', rank: 0, min: 0 },
    active: { id: 'active', name: 'Active', color: '#22c55e', rank: 1, min: 100 },
    warm: { id: 'warm', name: 'Warm', color: '#eab308', rank: 2, min: 130 },
    hot: { id: 'hot', name: 'Hot', color: '#fb923c', rank: 3, min: 140 },
    fire: { id: 'fire', name: 'On Fire', color: '#ef4444', rank: 4, min: 160 }
  }
};
```

**Step 2: Add test — COOL → HOT multi-zone progress**

```javascript
test('computes target-aware progress for COOL user targeting HOT', () => {
  const displayMap = makeDisplayMap([
    {
      id: 'user-1', displayName: 'Alice', avatarSrc: '/img/alice.jpg',
      heartRate: 85, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#38bdf8',
      progress: 0.625, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 100
    }
  ]);

  const result = resolveGovernanceDisplay(
    {
      isGoverned: true,
      status: 'pending',
      requirements: [
        { zone: 'hot', rule: 'all', missingUsers: ['user-1'], satisfied: false }
      ]
    },
    displayMap,
    ZONE_META
  );

  const row = result.rows[0];

  // Progress should be toward HOT (140), not just ACTIVE (100)
  // rangeMin = max(0, 100 - 40) = 60, rangeMax = 140, span = 80
  // progress = (85 - 60) / 80 = 0.3125
  expect(row.progress).toBeCloseTo(0.3125, 2);

  // Should have intermediate zones: ACTIVE and WARM
  expect(row.intermediateZones).toHaveLength(2);
  expect(row.intermediateZones[0].id).toBe('active');
  expect(row.intermediateZones[0].position).toBeCloseTo(0.5, 2);
  expect(row.intermediateZones[1].id).toBe('warm');
  expect(row.intermediateZones[1].position).toBeCloseTo(0.75, 2);
});
```

**Step 3: Add test — single-zone transition has no intermediate zones**

```javascript
test('single-zone transition has no intermediate zones', () => {
  const displayMap = makeDisplayMap([
    {
      id: 'user-1', displayName: 'Alice', avatarSrc: '/img/alice.jpg',
      heartRate: 110, zoneId: 'active', zoneName: 'Active', zoneColor: '#22c55e',
      progress: 0.5, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 120
    }
  ]);

  const result = resolveGovernanceDisplay(
    {
      isGoverned: true,
      status: 'pending',
      requirements: [
        { zone: 'warm', rule: 'all', missingUsers: ['user-1'], satisfied: false }
      ]
    },
    displayMap,
    ZONE_META
  );

  const row = result.rows[0];
  // ACTIVE (100) → WARM (120), HR 110: progress = (110-100)/(120-100) = 0.5
  expect(row.progress).toBeCloseTo(0.5, 2);
  expect(row.intermediateZones).toHaveLength(0);
});
```

**Step 4: Add test — already at or above target zone returns progress 1**

```javascript
test('user at or above target zone has progress 1', () => {
  const displayMap = makeDisplayMap([
    {
      id: 'user-1', displayName: 'Alice', avatarSrc: '/img/alice.jpg',
      heartRate: 145, zoneId: 'hot', zoneName: 'Hot', zoneColor: '#fb923c',
      progress: 0.25, zoneSequence: FULL_ZONE_SEQUENCE, targetHeartRate: 160
    }
  ]);

  const result = resolveGovernanceDisplay(
    {
      isGoverned: true,
      status: 'pending',
      requirements: [
        { zone: 'warm', rule: 'all', missingUsers: ['user-1'], satisfied: false }
      ]
    },
    displayMap,
    ZONE_META
  );

  const row = result.rows[0];
  // HOT (index 3) >= WARM (index 2), so progress = 1
  expect(row.progress).toBe(1);
  expect(row.intermediateZones).toHaveLength(0);
});
```

**Step 5: Add test — fallback when zoneSequence is empty**

```javascript
test('falls back to display map progress when zoneSequence is empty', () => {
  const displayMap = makeDisplayMap([
    {
      id: 'user-1', displayName: 'Alice', avatarSrc: '/img/alice.jpg',
      heartRate: 95, zoneId: 'cool', zoneName: 'Cool', zoneColor: '#38bdf8',
      progress: 0.3, zoneSequence: [], targetHeartRate: 100
    }
  ]);

  const result = resolveGovernanceDisplay(
    {
      isGoverned: true,
      status: 'pending',
      requirements: [
        { zone: 'warm', rule: 'all', missingUsers: ['user-1'], satisfied: false }
      ]
    },
    displayMap,
    ZONE_META
  );

  const row = result.rows[0];
  // Can't compute target-aware progress without zoneSequence, so fallback
  expect(row.progress).toBe(0.3);
  expect(row.intermediateZones).toHaveLength(0);
});
```

**Step 6: Run tests to verify they fail**

Run: `npx jest tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs --no-coverage`
Expected: New tests FAIL (rows don't have `intermediateZones`, progress is pass-through from display map)

**Step 7: Commit**

```bash
git add tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs
git commit -m "test(fitness): add failing tests for target-aware multi-zone progress"
```

---

## Task 2: Wire calculateZoneProgressTowardsTarget into resolveGovernanceDisplay

**Files:**
- Modify: `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js`

This is the join point where we know both the governance target zone AND the participant's zone data. We call `calculateZoneProgressTowardsTarget` here to override the single-step progress with target-aware progress.

**Step 1: Add import**

At the top of `useGovernanceDisplay.js`, add the import from types:

```javascript
import { calculateZoneProgressTowardsTarget } from '../../../hooks/fitness/types.js';
```

**Step 2: Add target-aware progress computation in the row-building loop**

In `resolveGovernanceDisplay`, inside the `for...of userTargets` loop (after line 57 where `currentZone` is resolved), add the target-aware progress computation. Replace the existing row push (lines 62–74) with:

```javascript
    // Compute target-aware progress (full span to governance target)
    const zoneSequence = display?.zoneSequence || [];
    const currentZoneIndex = zoneSequence.findIndex(z => z.id === currentZoneId);
    const targetResult = (zoneSequence.length > 0 && currentZoneIndex >= 0)
      ? calculateZoneProgressTowardsTarget({
          snapshot: {
            zoneSequence,
            currentZoneIndex,
            heartRate: display?.heartRate ?? 0
          },
          targetZoneId
        })
      : null;

    // Use target-aware progress if available, otherwise fall back to display map progress
    const resolvedProgress = (targetResult && targetResult.progress != null)
      ? targetResult.progress
      : (display?.progress ?? null);
    const intermediateZones = targetResult?.intermediateZones || [];

    const resolvedName = (preferGroupLabels && display?.groupLabel)
      ? display.groupLabel
      : (display?.displayName || userId);
    rows.push({
      key: key,
      userId,
      displayName: resolvedName,
      avatarSrc: display?.avatarSrc || FALLBACK_AVATAR,
      heartRate: display?.heartRate ?? null,
      currentZone,
      targetZone,
      zoneSequence,
      progress: resolvedProgress,
      intermediateZones,
      targetHeartRate: display?.targetHeartRate ?? null,
      groupLabel: display?.groupLabel || null
    });
```

Key points:
- Derives `currentZoneIndex` from `zoneSequence.findIndex()` — no changes needed to ZoneProfileStore or participantDisplayMap
- Falls back to `display.progress` if zoneSequence is empty or calculateZoneProgressTowardsTarget returns null
- Adds `intermediateZones` array to each row (empty array if not available)

**Step 3: Run tests**

Run: `npx jest tests/isolated/domain/fitness/legacy/governance-display-hook.unit.test.mjs --no-coverage`
Expected: All tests PASS including the new multi-zone progress tests

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js
git commit -m "feat(fitness): wire target-aware progress into governance display rows"
```

---

## Task 3: Build multi-stop gradient from intermediateZones in renderer

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx`

The renderer already reads `row.intermediateZones` and renders zone markers. We just need to update the gradient computation to use intermediate zone colors.

**Step 1: Update fillBackground in renderProgressBlock**

In `GovernancePanelOverlay`, inside `renderProgressBlock` (around line 125), replace the `fillBackground` line:

```javascript
// OLD:
const fillBackground = row.progressGradient || `linear-gradient(90deg, ${currentColor}, ${targetColor})`;

// NEW:
let fillBackground;
if (intermediateZones.length > 0) {
  const stops = [`${currentColor} 0%`];
  intermediateZones.forEach((zone) => {
    stops.push(`${zone.color || currentColor} ${Math.round((zone.position || 0) * 100)}%`);
  });
  stops.push(`${targetColor} 100%`);
  fillBackground = `linear-gradient(90deg, ${stops.join(', ')})`;
} else {
  fillBackground = row.progressGradient || `linear-gradient(90deg, ${currentColor}, ${targetColor})`;
}
```

This means for COOL → HOT:
```
linear-gradient(90deg,
  #38bdf8 0%,      /* COOL blue */
  #22c55e 50%,     /* ACTIVE green at 50% */
  #eab308 75%,     /* WARM yellow at 75% */
  #fb923c 100%     /* HOT orange */
)
```

**Step 2: Verify zone markers already work**

The existing code at lines 136–150 already renders `governance-lock__zone-marker` divs for each `intermediateZone` with `isPassed` styling. No changes needed — this code was already written anticipating this data. Verify it reads from the same `intermediateZones` variable (line 122):

```javascript
const intermediateZones = Array.isArray(row.intermediateZones) ? row.intermediateZones : [];
```

This is correct — it reads `row.intermediateZones` which we now populate in Task 2.

**Step 3: Manual visual check**

Start the dev server (if not running) and trigger a governance lock scenario:
1. Confirm the progress bar shows a multi-color gradient when spanning multiple zones
2. Confirm vertical zone markers appear at intermediate zone boundaries
3. Confirm the percentage indicator reflects progress toward the governance target (not just next zone)

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx
git commit -m "feat(fitness): multi-stop gradient for multi-zone progress bar"
```

---

## Task 4: Clean up dead code reference

**Files:**
- Move to archive: `frontend/src/hooks/fitness/MultiZoneProgress.ProblemStatement.md`

**Step 1: Remove the problem statement**

The problem statement describes this exact feature. Now that it's implemented, remove it:

```bash
git rm frontend/src/hooks/fitness/MultiZoneProgress.ProblemStatement.md
```

**Step 2: Commit**

```bash
git add -A
git commit -m "chore(fitness): remove multi-zone progress problem statement (implemented)"
```

---

## Summary of changes

| File | Change | Lines |
|------|--------|-------|
| `useGovernanceDisplay.js` | Import `calculateZoneProgressTowardsTarget`, compute target-aware progress + intermediateZones per row | ~20 lines added |
| `GovernanceStateOverlay.jsx` | Build multi-stop gradient from intermediateZones | ~8 lines changed |
| `governance-display-hook.unit.test.mjs` | Add zone fixtures, 4 new tests | ~90 lines added |
| `MultiZoneProgress.ProblemStatement.md` | Deleted (problem solved) | removed |

No changes to: ZoneProfileStore, participantDisplayMap, GovernanceEngine, types.js. The existing `calculateZoneProgressTowardsTarget` function is used as-is.
