# Governance Ghost Oscillation Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the ghost participant oscillation bug that causes 31 phase flips in 85 seconds, 7 video stutter-pauses, and 28,844 wasted profile rebuilds per minute during fitness governance sessions.

**Architecture:** The root cause is a data race in `GovernanceEngine.evaluate()`: two competing code paths (`_triggerPulse` and `updateSnapshot`) produce inconsistent `userZoneMap` data. The P0 fix (reorder ghost filter after ZoneProfileStore population) is already applied in the working tree. This plan adds P1 defense-in-depth (roster zone fallback), verifies all fixes via tests, and prepares for prod deployment verification.

**Tech Stack:** JavaScript (ES modules), Jest unit tests, React (frontend effects)

---

## Status of Fixes from Audit

| Fix | Status in Working Tree | This Plan |
|-----|----------------------|-----------|
| P0: Ghost filter reorder | Already applied (lines 1246-1276) | Verify via tests (Task 1) |
| P1: Unify evaluate paths | **NOT done** | Implement (Tasks 2-5) |
| P2: Remove _hysteresisMs | Already applied | Verify via tests (Task 1) |
| Section 7A: Transition tightness logging | Already applied | Verify present (Task 1) |
| Section 7B: playObject autoplay logging | Already applied | Verify present (Task 1) |

## Key Files

| File | Role |
|------|------|
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Core engine — evaluate(), ghost filter, phase logic |
| `frontend/src/hooks/fitness/FitnessSession.js` | Path B caller — updateSnapshot() at line 1571 |
| `tests/unit/governance/governance-ghost-oscillation-regression.test.mjs` | P0 regression tests |
| `tests/unit/governance/governance-phase-stability-e2e.test.mjs` | Phase stability e2e tests |
| `tests/unit/governance/governance-ghost-participants.test.mjs` | Ghost filtering behavior tests |

## The Bug (recap)

Two paths call `evaluate()`:

| Path | Trigger | Passes userZoneMap? |
|------|---------|---------------------|
| **A: `_triggerPulse()`** | Timer tick, pulse | No — starts with `{}` |
| **B: `updateSnapshot()`** | React re-render from FitnessSession | Yes — from `entry.zoneId` on roster |

**P0 fix (already applied):** Reordered ghost filter to run AFTER ZoneProfileStore population, so Path A can populate `userZoneMap` from ZoneProfileStore before filtering.

**P1 issue (remaining):** Path A still starts with `userZoneMap = {}` and relies entirely on ZoneProfileStore. Path B pre-populates from roster entries (`entry.zoneId || null`). If ZoneProfileStore is temporarily unavailable:
- **Path A:** All participants ghost-filtered → `no_participants` → `pending`
- **Path B:** Participants kept (key exists with null value) → requirement evaluation proceeds

This inconsistency means Path A is more fragile than Path B.

---

### Task 1: Run existing regression tests

**Files:**
- Test: `tests/unit/governance/governance-ghost-oscillation-regression.test.mjs`
- Test: `tests/unit/governance/governance-phase-stability-e2e.test.mjs`
- Test: `tests/unit/governance/governance-ghost-participants.test.mjs`

**Step 1: Run the three governance regression test files**

Run:
```bash
npx jest tests/unit/governance/governance-ghost-oscillation-regression.test.mjs tests/unit/governance/governance-phase-stability-e2e.test.mjs tests/unit/governance/governance-ghost-participants.test.mjs --verbose
```

Expected: All tests PASS. This confirms the P0 reorder fix and P2 hysteresis removal are working.

**Step 2: Verify diagnostic logging is present in source**

Confirm these patterns exist in the codebase:
- `governance.overlay.waiting_for_participants` in `GovernanceStateOverlay.jsx`
- `governance.phase_change` with `evaluatePath` field in `GovernanceEngine.js`
- `fitness.media_start.autoplay` in `FitnessPlayer.jsx`

Expected: All three patterns found.

---

### Task 2: Write failing test for P1 (roster zone fallback)

**Files:**
- Create: `tests/unit/governance/governance-path-unification.test.mjs`

**Step 1: Write the failing test**

This test creates an engine where ZoneProfileStore is null but roster entries carry `zoneId`. It verifies that Path A (no-args `evaluate()`) still finds participants via roster zone data.

```javascript
import { describe, it, expect, jest } from '@jest/globals';

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

function createEngine({ roster = [], grace = 30 } = {}) {
  const zoneConfig = [
    { id: 'cool', name: 'Cool', color: '#3399ff' },
    { id: 'active', name: 'Active', color: '#00cc00' },
    { id: 'warm', name: 'Warm', color: '#ffaa00' },
    { id: 'hot', name: 'Hot', color: '#ff0000' },
  ];
  const mockSession = {
    roster,
    zoneProfileStore: null, // Deliberately null — simulates ZoneProfileStore unavailable
    snapshot: { zoneConfig }
  };
  const engine = new GovernanceEngine(mockSession);
  engine.configure({
    governed_labels: ['exercise'],
    grace_period_seconds: grace,
  }, [{
    id: 'default',
    name: 'Default',
    minParticipants: 1,
    baseRequirement: { active: 'all', grace_period_seconds: grace },
    challenges: []
  }], {});
  engine.media = { id: 'test-media', labels: ['exercise'], type: 'video' };

  const zoneRankMap = {};
  const zoneInfoMap = {};
  zoneConfig.forEach((z, i) => {
    zoneRankMap[z.id] = i;
    zoneInfoMap[z.id] = z;
  });

  return { engine, zoneRankMap, zoneInfoMap };
}

describe('GovernanceEngine — evaluate path unification (P1)', () => {

  it('Path A should read zone data from roster entries when ZoneProfileStore is null', () => {
    const roster = [
      { id: 'alice', isActive: true, zoneId: 'active' },
      { id: 'bob', isActive: true, zoneId: 'active' },
    ];
    const { engine } = createEngine({ roster, grace: 30 });

    // Call evaluate with NO args — Path A (_triggerPulse path)
    // ZoneProfileStore is null, but roster entries have zoneId
    engine.evaluate();

    // Participants should NOT be ghost-filtered — roster entries have zone data
    const activeCount = engine.requirementSummary?.activeCount ?? 0;
    expect(activeCount).toBe(2);

    // Phase should be 'unlocked' — both are in 'active' zone
    expect(engine.phase).toBe('unlocked');
  });

  it('Path A and Path B should produce same phase for identical roster state', () => {
    const roster = [
      { id: 'alice', isActive: true, zoneId: 'active' },
      { id: 'bob', isActive: true, zoneId: 'warm' },
    ];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ roster, grace: 30 });

    // Path B: explicit evaluate (what updateSnapshot does)
    engine.evaluate({
      activeParticipants: ['alice', 'bob'],
      userZoneMap: { alice: 'active', bob: 'warm' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 2
    });
    const phasePathB = engine.phase;
    const activeCountPathB = engine.requirementSummary?.activeCount ?? 0;

    // Reset engine state to pending
    engine._setPhase('pending');
    engine.meta.satisfiedOnce = false;

    // Path A: no-args evaluate (what _triggerPulse does)
    engine.evaluate();
    const phasePathA = engine.phase;
    const activeCountPathA = engine.requirementSummary?.activeCount ?? 0;

    // Both paths should produce identical results
    expect(phasePathA).toBe(phasePathB);
    expect(activeCountPathA).toBe(activeCountPathB);
  });

  it('Path A should handle roster entries with null zoneId (no HR data yet)', () => {
    const roster = [
      { id: 'alice', isActive: true, zoneId: null },
      { id: 'bob', isActive: true, zoneId: 'active' },
    ];
    const { engine } = createEngine({ roster, grace: 30 });

    engine.evaluate();

    // Alice has null zone → should still be counted as a participant (not ghost-filtered)
    // but should fail the zone requirement (rank 0 < active rank)
    const activeCount = engine.requirementSummary?.activeCount ?? 0;
    expect(activeCount).toBe(2); // Both counted, even alice with null zone

    // Phase should be 'pending' — alice fails the 'all active' requirement
    expect(engine.phase).toBe('pending');
  });

  it('no oscillation when alternating between Path A and Path B (no ZoneProfileStore)', () => {
    const roster = [
      { id: 'alice', isActive: true, zoneId: 'active' },
    ];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ roster, grace: 30 });

    const phaseChanges = [];
    engine.setCallbacks({
      onPhaseChange: (phase) => phaseChanges.push(phase),
      onPulse: null,
      onStateChange: null
    });

    // Path B: explicit → unlocked
    engine.evaluate({
      activeParticipants: ['alice'],
      userZoneMap: { alice: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });
    expect(engine.phase).toBe('unlocked');

    // Path A: no-args → should stay unlocked
    engine.evaluate();
    expect(engine.phase).toBe('unlocked');

    // Path A again
    engine.evaluate();
    expect(engine.phase).toBe('unlocked');

    // Path B again
    engine.evaluate({
      activeParticipants: ['alice'],
      userZoneMap: { alice: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });
    expect(engine.phase).toBe('unlocked');

    // Should be exactly ONE phase change total: pending → unlocked
    expect(phaseChanges).toEqual(['unlocked']);
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npx jest tests/unit/governance/governance-path-unification.test.mjs --verbose
```

Expected: Tests 1, 2, 3, and 4 FAIL because Path A does not read `entry.zoneId` from roster entries. With `zoneProfileStore: null`, `userZoneMap` stays `{}`, ghost filter removes everyone, and phase stays `pending` instead of `unlocked`.

---

### Task 3: Implement P1 fix (roster zone fallback)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1196-1204`

**Step 1: Add roster zone pre-population to Path A**

In `evaluate()`, the block that reads from `session.roster` (around line 1196-1204), add zone data extraction from roster entries:

Change from:
```javascript
    if (!activeParticipants && this.session?.roster) {
      const roster = this.session.roster || [];
      activeParticipants = roster
        .filter((entry) => entry.isActive !== false && (entry.id || entry.profileId))
        .map((entry) => entry.id || entry.profileId);

      userZoneMap = {};
      totalCount = activeParticipants.length;
    }
```

Change to:
```javascript
    if (!activeParticipants && this.session?.roster) {
      const roster = this.session.roster || [];
      activeParticipants = roster
        .filter((entry) => entry.isActive !== false && (entry.id || entry.profileId))
        .map((entry) => entry.id || entry.profileId);

      // P1: Pre-populate userZoneMap from roster entries (matches updateSnapshot path).
      // ZoneProfileStore will supplement/override at lines below.
      userZoneMap = {};
      roster.forEach((entry) => {
        const userId = entry.id || entry.profileId;
        const zoneId = entry.zoneId || entry.currentZoneId;
        if (userId && zoneId) {
          userZoneMap[userId] = typeof zoneId === 'string' ? zoneId.toLowerCase() : String(zoneId).toLowerCase();
        }
      });
      totalCount = activeParticipants.length;
    }
```

**Why this works:**
- Roster entries carry `zoneId` set by `FitnessSession.updateSnapshot()` — the same data Path B passes explicitly
- ZoneProfileStore (lines 1248-1261) can still override with fresher data
- Ghost filter (lines 1266-1276) now finds participants in `userZoneMap` even without ZoneProfileStore
- If both `entry.zoneId` and ZoneProfileStore are null, participant is correctly ghost-filtered (no zone data = disconnected)

---

### Task 4: Run tests to verify P1 fix passes

**Step 1: Run the new P1 test**

Run:
```bash
npx jest tests/unit/governance/governance-path-unification.test.mjs --verbose
```

Expected: All 4 tests PASS.

**Step 2: Run all existing governance regression tests**

Run:
```bash
npx jest tests/unit/governance/ --verbose
```

Expected: All governance tests PASS. No regressions.

**Step 3: Commit**

```bash
git add tests/unit/governance/governance-path-unification.test.mjs frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "fix(governance): P1 — unify evaluate paths with roster zone fallback

Path A (_triggerPulse) now pre-populates userZoneMap from roster entries,
matching Path B (updateSnapshot) behavior. This provides defense-in-depth
when ZoneProfileStore is temporarily unavailable.

Addresses P1 from governance post-fix prod verification audit.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Run full governance test suite

**Step 1: Run ALL governance unit tests**

Run:
```bash
npx jest tests/unit/governance/ tests/unit/fitness/governance-batched-updates.test.mjs --verbose
```

Expected: All tests PASS.

**Step 2: Verify no test regressions in broader test suite**

Run:
```bash
npx jest tests/unit/ --verbose 2>&1 | tail -30
```

Expected: No new failures.

---

## Post-Deploy Verification Checklist

After deploying to prod, during the next fitness session, check these log patterns:

1. **Ghost oscillation eliminated:** `governance.phase_change` events should NOT show rapid unlocked↔pending cycling. Phase changes should be orderly: pending → unlocked (once HR meets threshold), with warning/locked only on genuine HR drops.

2. **evaluatePath field:** Every `governance.phase_change` event should include `evaluatePath: "pulse"` or `evaluatePath: "snapshot"`. If unlocked→pending transitions show `evaluatePath: "pulse"`, Path A is still the culprit (shouldn't happen after this fix).

3. **Transition tightness:** If `governance.overlay.waiting_for_participants` events appear, the "Waiting" flash is still happening. With P1 fix, this should be rare since roster entries carry zone labels.

4. **Render count:** Fitness-profile samples should show reasonable forceUpdateCount (< 100 over 30s, not 1,784).

5. **playObject autoplay SSoT:** `fitness.media_start.autoplay` events should show `autoplay === !videoLocked` consistently.

## Cross-References

| Document | Relationship |
|----------|-------------|
| `docs/_wip/audits/2026-02-17-governance-post-fix-prod-verification.md` | Source audit driving this plan |
| `docs/_wip/audits/2026-02-16-governance-ghost-participant-oscillation.md` | Root cause analysis |
