# Governance Video Lock for Pending/Locked Phases — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Lock video playback when governed media is playing and governance phase is `pending` or `locked` (not just during failed challenges).

**Architecture:** Single-line fix in `GovernanceEngine._composeState()` to derive `videoLocked` from both challenge state AND base phase+governance. The `pauseArbiter` and `FitnessPlayer` already respond correctly to `videoLocked`; only the source of truth needs fixing.

**Tech Stack:** React (frontend), Jest (unit tests), Vitest (isolated tests)

**Bug doc:** `docs/_wip/bugs/2026-02-13-governed-content-plays-without-hr-users.md`

---

### Task 1: Write Failing Tests — videoLocked in pending/locked phases

**Files:**
- Modify: `tests/unit/governance/GovernanceEngine.test.mjs`

**Step 1: Write the failing tests**

Add a new `describe` block at the end of the existing `GovernanceEngine` describe:

```javascript
describe('videoLocked in _composeState()', () => {
  let engine;

  beforeEach(() => {
    const mockSession = {
      roster: ['alice'],
      zoneProfileStore: null,
      snapshot: {
        zoneConfig: [
          { id: 'active', name: 'Active', color: '#ff0000' },
        ]
      }
    };
    engine = new GovernanceEngine(mockSession);
    engine.configure({
      governed_labels: ['kidsfun'],
      grace_period_seconds: 30
    }, [], {});
  });

  it('should set videoLocked=true when media is governed and phase is pending', () => {
    engine.setMedia({ id: 'plex:603409', labels: ['kidsfun'], type: 'episode' });
    engine.phase = 'pending';

    const state = engine._composeState();
    expect(state.videoLocked).toBe(true);
  });

  it('should set videoLocked=true when media is governed and phase is locked', () => {
    engine.setMedia({ id: 'plex:603409', labels: ['kidsfun'], type: 'episode' });
    engine.phase = 'locked';

    const state = engine._composeState();
    expect(state.videoLocked).toBe(true);
  });

  it('should NOT set videoLocked when media is governed and phase is unlocked', () => {
    engine.setMedia({ id: 'plex:603409', labels: ['kidsfun'], type: 'episode' });
    engine.phase = 'unlocked';

    const state = engine._composeState();
    expect(state.videoLocked).toBe(false);
  });

  it('should NOT set videoLocked when media is NOT governed and phase is pending', () => {
    engine.setMedia({ id: 'plex:999', labels: ['documentary'], type: 'movie' });
    engine.phase = 'pending';

    const state = engine._composeState();
    expect(state.videoLocked).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --verbose 2>&1 | tail -30`
Expected: The `videoLocked=true` tests FAIL (pending and locked phases return `false`). The `unlocked` and `NOT governed` tests pass.

**Step 3: Commit failing tests**

```bash
git add tests/unit/governance/GovernanceEngine.test.mjs
git commit -m "test: add failing tests for videoLocked in pending/locked governance phases"
```

---

### Task 2: Fix _composeState() — derive videoLocked from phase + governance

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1148`

**Step 1: Apply the fix**

In `_composeState()`, change line 1148 from:

```javascript
videoLocked: !!(this.challengeState && this.challengeState.videoLocked),
```

to:

```javascript
videoLocked: !!(this.challengeState && this.challengeState.videoLocked)
  || (this._mediaIsGoverned() && (this.phase === 'pending' || this.phase === 'locked')),
```

This ensures `videoLocked` is `true` when:
- A challenge has failed (existing behavior), OR
- Media is governed AND phase is `pending` (no HR users) or `locked` (requirements not met)

**Step 2: Run the tests to verify they pass**

Run: `npx jest tests/unit/governance/GovernanceEngine.test.mjs --verbose 2>&1 | tail -30`
Expected: All 4 new `videoLocked` tests PASS. All existing tests still pass.

**Step 3: Run the existing governance pause tests too**

Run: `npx vitest run tests/isolated/domain/fitness/legacy/governance-video-pause.unit.test.mjs 2>&1 | tail -20`
Expected: All pauseArbiter contract tests still PASS (no changes to that layer).

**Step 4: Commit the fix**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "fix(governance): lock video during pending/locked phases for governed media

videoLocked was only true during failed challenges. Governed content
(KidsFun label) played freely when no HR users were checked in because
the pending phase never set videoLocked=true.

Derives videoLocked from phase+governance in _composeState(), not just
challengeState."
```

---

### Task 3: Update bug doc status

**Files:**
- Modify: `docs/_wip/bugs/2026-02-13-governed-content-plays-without-hr-users.md`

**Step 1: Update the status**

Change line 6 from:
```
**Status:** Open
```
to:
```
**Status:** Fixed
```

**Step 2: Commit**

```bash
git add docs/_wip/bugs/2026-02-13-governed-content-plays-without-hr-users.md
git commit -m "docs: mark governed-content-plays-without-hr-users bug as fixed"
```
