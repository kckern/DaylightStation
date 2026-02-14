# Governance SSoT: playObject Autoplay Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the last SSoT violation where `FitnessPlayer.playObject` locally re-derives "is media governed?" instead of reading from GovernanceEngine state.

**Architecture:** `GovernanceEngine._mediaIsGoverned()` is the sole authority for whether current media is governed. Its result is exposed via `governanceState.isGoverned` and `governanceState.videoLocked`. The `playObject` useMemo in FitnessPlayer.jsx currently duplicates this logic by locally matching labels/types against `governedLabelSet`/`governedTypeSet`. The fix replaces local derivation with a single read from `governanceState.videoLocked`. This also removes ~5 unused destructured variables and 2 useMemo blocks.

**Tech Stack:** React (useMemo, useCallback), GovernanceEngine (vanilla JS class)

**Context:** This is a follow-up to [docs/plans/2026-02-13-governance-ssot-fixes.md](../plans/2026-02-13-governance-ssot-fixes.md). Tasks 1-6 from that plan are complete. Task 3 (dual governance check) fixed `pauseDecision` but missed the `playObject` useMemo which has the same violation.

---

### Task 1: Add failing test for autoplay SSoT

**Why first:** Verify the SSoT violation exists before fixing it — the test should confirm autoplay is derived solely from `governanceState.videoLocked`, not from local label matching.

**Files:**
- Modify: `tests/unit/governance/GovernanceEngine.test.mjs`

**Step 1: Write test verifying GovernanceEngine.state.videoLocked is correct SSoT for autoplay decisions**

The autoplay decision in FitnessPlayer depends on `governanceState.videoLocked`. This test ensures GovernanceEngine's `_composeState()` returns the correct `videoLocked` value for all phase combinations — confirming it's safe to use as the sole autoplay authority.

Add at end of the `describe('GovernanceEngine', ...)` block:

```javascript
  describe('state.videoLocked as autoplay SSoT', () => {
    // These tests confirm videoLocked is the correct single source for autoplay decisions.
    // FitnessPlayer.playObject should use !governanceState.videoLocked for canAutoplay
    // instead of locally re-deriving mediaGoverned from labels/types.

    let engine;
    const mockSession = {
      roster: [{ id: 'user1', isActive: true, heartRate: 80 }],
      zoneProfileStore: {
        getProfile: () => ({ currentZoneId: 'cool' })
      },
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#00f' },
          { id: 'active', name: 'Active', color: '#f00' }
        ]
      }
    };

    beforeEach(() => {
      engine = new GovernanceEngine(mockSession);
      engine.configure({
        governed_labels: ['exercise'],
        governed_types: ['workout'],
        grace_period_seconds: 30,
        policies: {
          default: {
            min_participants: 1,
            base_requirement: [{ active: 'all' }],
            challenges: []
          }
        }
      }, [], {});
    });

    it('videoLocked=true when governed media in pending phase (no HR data)', () => {
      engine.setMedia({ id: 'test-1', labels: ['exercise'], type: 'video' });
      engine.evaluate({
        activeParticipants: ['user1'],
        userZoneMap: { user1: 'cool' },
        zoneRankMap: { cool: 0, active: 1 },
        zoneInfoMap: { cool: { id: 'cool', name: 'Cool' }, active: { id: 'active', name: 'Active' } },
        totalCount: 1
      });

      expect(engine.phase).toBe('pending');
      expect(engine.state.videoLocked).toBe(true);
    });

    it('videoLocked=false when governed media in unlocked phase', () => {
      engine.setMedia({ id: 'test-2', labels: ['exercise'], type: 'video' });
      // Satisfy requirements: user in 'active' zone meets 'active: all' requirement
      engine.evaluate({
        activeParticipants: ['user1'],
        userZoneMap: { user1: 'active' },
        zoneRankMap: { cool: 0, active: 1 },
        zoneInfoMap: { cool: { id: 'cool', name: 'Cool' }, active: { id: 'active', name: 'Active' } },
        totalCount: 1
      });
      // Satisfy hysteresis
      engine._hysteresisMs = 0;
      engine.evaluate({
        activeParticipants: ['user1'],
        userZoneMap: { user1: 'active' },
        zoneRankMap: { cool: 0, active: 1 },
        zoneInfoMap: { cool: { id: 'cool', name: 'Cool' }, active: { id: 'active', name: 'Active' } },
        totalCount: 1
      });

      expect(engine.phase).toBe('unlocked');
      expect(engine.state.videoLocked).toBe(false);
    });

    it('videoLocked=false when media is NOT governed', () => {
      engine.setMedia({ id: 'test-3', labels: ['comedy'], type: 'movie' });
      // Non-governed media should never lock
      const state = engine.state;
      expect(state.videoLocked).toBe(false);
      expect(state.isGoverned).toBe(false);
    });

    it('isGoverned reflects _mediaIsGoverned() for label match', () => {
      engine.setMedia({ id: 'test-4', labels: ['exercise'], type: 'video' });
      expect(engine.state.isGoverned).toBe(true);
    });

    it('isGoverned reflects _mediaIsGoverned() for type match', () => {
      engine.setMedia({ id: 'test-5', labels: [], type: 'workout' });
      expect(engine.state.isGoverned).toBe(true);
    });
  });
```

**Step 2: Run the test to verify it passes**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --verbose 2>&1 | tail -40`

Expected: All 5 new tests PASS. These confirm GovernanceEngine is the correct SSoT — they're not testing a bug, they're documenting the contract that `playObject` should rely on.

**Step 3: Commit**

```bash
git add tests/unit/governance/GovernanceEngine.test.mjs
git commit -m "test(governance): add SSoT contract tests for videoLocked/isGoverned"
```

---

### Task 2: Remove local governance derivation from playObject

**Why:** This is the actual SSoT fix. The `playObject` useMemo (lines 978-1024) locally computes `mediaGoverned` by matching labels/types — duplicating `GovernanceEngine._mediaIsGoverned()`. Replace with `governanceState.videoLocked`.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:978-1024`

**Step 1: Replace local governance logic in playObject with governanceState read**

In `FitnessPlayer.jsx`, the `playObject` useMemo starting at line 978 currently has (lines 982-996):

```javascript
    // Check if this media is governed
    const rawLabels = Array.isArray(currentItem?.labels) ? currentItem.labels : [];
    const normalizedLabels = rawLabels
      .map((label) => (typeof label === 'string' ? label.trim().toLowerCase() : ''))
      .filter(Boolean);
    const labelGoverned = governedLabelSet.size > 0 && normalizedLabels.some((label) => governedLabelSet.has(label));
    const normalizedType = typeof currentItem?.type === 'string'
      ? currentItem.type.trim().toLowerCase()
      : (typeof enhancedCurrentItem?.type === 'string' ? enhancedCurrentItem.type.trim().toLowerCase() : '');
    const typeGoverned = governedTypeSet.size > 0 && normalizedType ? governedTypeSet.has(normalizedType) : false;
    const mediaGoverned = labelGoverned || typeGoverned;

    // Only autoplay if:
    // 1. Media is not governed, OR
    // 2. Media is governed AND governance is unlocked or warning
    const canAutoplay = !mediaGoverned || (governance === 'unlocked' || governance === 'warning');
```

Replace the entire block (lines 982-996) with:

```javascript
    // SSoT: GovernanceEngine is sole authority for lock decisions.
    // videoLocked=true when media is governed AND phase is pending/locked.
    // Autoplay is allowed when video is not locked (ungoverned, unlocked, or warning phase).
    const canAutoplay = !governanceState?.videoLocked;
```

**Step 2: Update the useMemo dependency array**

The current dependency array (line 1024) is:

```javascript
  }, [enhancedCurrentItem, videoVolume.volume, videoVolume.volumeRef, currentItem?.playbackRate, currentItem?.labels, currentItem?.type, governedLabelSet, governedTypeSet, governance]);
```

Remove `currentItem?.labels`, `currentItem?.type`, `governedLabelSet`, `governedTypeSet`, `governance` and add `governanceState?.videoLocked`:

```javascript
  }, [enhancedCurrentItem, videoVolume.volume, videoVolume.volumeRef, currentItem?.playbackRate, governanceState?.videoLocked]);
```

**Step 3: Verify no other references to removed deps in playObject**

Run: `grep -n 'governedLabelSet\|governedTypeSet' frontend/src/modules/Fitness/FitnessPlayer.jsx`

Expected: Only the useMemo declarations at lines 279-297 (which will be removed in Task 3).

**Step 4: Run governance tests**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --verbose 2>&1 | tail -40`

Expected: All tests PASS (this change is in React component, not in GovernanceEngine).

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "fix(fitness): playObject reads autoplay from governanceState.videoLocked SSoT

Removed local label/type matching that duplicated GovernanceEngine._mediaIsGoverned().
The playObject useMemo now uses !governanceState.videoLocked for canAutoplay,
matching how pauseDecision already works."
```

---

### Task 3: Remove dead code — unused governance variables

**Why:** After Task 2, several variables destructured from `useFitness()` and two local useMemo blocks are no longer referenced anywhere in FitnessPlayer.jsx.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:154-181` (destructuring)
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:279-297` (useMemo blocks)

**Step 1: Verify variables are unused**

Run: `grep -n 'governedLabelSet\b' frontend/src/modules/Fitness/FitnessPlayer.jsx`

Expected: Only hits at the useMemo declaration (lines 279-287) and nowhere else.

Run: `grep -n 'governedTypeSet\b' frontend/src/modules/Fitness/FitnessPlayer.jsx`

Expected: Only hits at the useMemo declaration (lines 289-297) and nowhere else.

Run: `grep -n '\bgovernance\b' frontend/src/modules/Fitness/FitnessPlayer.jsx`

Expected: Only the destructuring at line 160. No other usage.

Run: `grep -n 'governedLabels\b' frontend/src/modules/Fitness/FitnessPlayer.jsx`

Expected: Only the destructuring at line 162. No other usage.

Run: `grep -n 'governedTypes\b' frontend/src/modules/Fitness/FitnessPlayer.jsx`

Expected: Only the destructuring at line 163. No other usage.

Run: `grep -n 'contextGovernedLabelSet\b' frontend/src/modules/Fitness/FitnessPlayer.jsx`

Expected: Only the destructuring at line 164 and the useMemo at line 280. No other usage.

Run: `grep -n 'contextGovernedTypeSet\b' frontend/src/modules/Fitness/FitnessPlayer.jsx`

Expected: Only the destructuring at line 165 and the useMemo at line 290. No other usage.

**Step 2: Remove unused useMemo blocks**

Remove the `governedLabelSet` useMemo (lines 279-287):

```javascript
  const governedLabelSet = useMemo(() => {
    if (contextGovernedLabelSet instanceof Set) return contextGovernedLabelSet;
    if (!Array.isArray(governedLabels) || !governedLabels.length) return new Set();
    return new Set(
      governedLabels
        .map((label) => (typeof label === 'string' ? label.trim().toLowerCase() : ''))
        .filter(Boolean)
    );
  }, [contextGovernedLabelSet, governedLabels]);
```

Remove the `governedTypeSet` useMemo (lines 289-297):

```javascript
  const governedTypeSet = useMemo(() => {
    if (contextGovernedTypeSet instanceof Set) return contextGovernedTypeSet;
    if (!Array.isArray(governedTypes) || !governedTypes.length) return new Set();
    return new Set(
      governedTypes
        .map((type) => (typeof type === 'string' ? type.trim().toLowerCase() : ''))
        .filter(Boolean)
    );
  }, [contextGovernedTypeSet, governedTypes]);
```

**Step 3: Remove unused destructured variables from useFitness()**

In the destructuring block (lines 154-181), remove these 5 lines:

```javascript
    governance,
    governedLabels,
    governedTypes,
    governedLabelSet: contextGovernedLabelSet,
    governedTypeSet: contextGovernedTypeSet,
```

**Step 4: Update the SSoT comment**

The comment at lines 329-330:

```javascript
  // Governance lock decision is now solely from GovernanceEngine.state.videoLocked (SSoT)
  // Removed: local label/type matching that duplicated GovernanceEngine._mediaIsGoverned()
```

Is now fully accurate (previously it was aspirational). No change needed.

**Step 5: Run governance tests**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --verbose 2>&1 | tail -40`

Expected: All tests PASS.

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "refactor(fitness): remove dead governance variables from FitnessPlayer

Removed governedLabelSet/governedTypeSet useMemos and 5 unused context
destructured vars (governance, governedLabels, governedTypes,
contextGovernedLabelSet, contextGovernedTypeSet) — all were only used
by the local governance check removed in the previous commit."
```

---

### Task 4: Update architecture documentation

**Why:** The docs currently claim violation #2 is fully resolved. Update to note the `playObject` fix as the completion of that work.

**Files:**
- Modify: `docs/reference/fitness/governance-system-architecture.md:460-477`

**Step 1: Update the Resolved SSoT Violations table**

In the table row for violation #2 (line 467), change:

```markdown
| 2 | FitnessPlayer dual governance check | Removed local label check; `governanceState.videoLocked` is sole lock authority |
```

To:

```markdown
| 2 | FitnessPlayer dual governance check | Removed local label check from `pauseDecision` and `playObject.autoplay`; `governanceState.videoLocked` is sole lock authority |
```

**Step 2: Commit**

```bash
git add docs/reference/fitness/governance-system-architecture.md
git commit -m "docs(fitness): update SSoT violation #2 resolution to include playObject fix"
```

---

## Execution Notes

- **Task order matters:** Task 1 (test) → Task 2 (fix) → Task 3 (cleanup) → Task 4 (docs). Each depends on the previous.
- **Risk assessment:** Low. The `playObject.autoplay` field only controls whether the `<Player>` auto-starts playback. Governance pause/lock is already handled correctly by `pauseDecision` (which already reads from `governanceState.videoLocked`). The `canAutoplay` local logic was a belt-and-suspenders duplicate.
- **Verification:** After all tasks, start the fitness player with governed content and verify: (1) video auto-pauses in pending phase, (2) video auto-plays when HR reaches unlocked phase, (3) non-governed content always auto-plays.
- **Rollback:** Each task commits independently.
