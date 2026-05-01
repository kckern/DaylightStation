# Cycle Demo Bug-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six issues uncovered while auditing the live cycle-challenge demo at `https://daylightlocal.kckern.net/fitness/cycle-demo`: state-transition spam (40+ duplicate `maintain → success` events in 10s), needle reading 0 while progress advances, overlay flashing, decimal overflow on the lock panel, swap-rider unreachable when locked, and avatar opacity/stacking issues.

**Architecture:** Three engine fixes (terminal-status guard, unit unification, React-state nudge) plus three UI fixes (RPM rounding, lock-panel swap button, avatar styling). Each fix is small (<20 LOC) and lands behind a unit test or Playwright assertion. The exit criterion is the existing live demo running for one full lifecycle iteration with zero duplicate `state_transition` events.

**Tech Stack:** React 18, jest (unit harness `npm run test:unit` → scans `tests/unit/suite/`), Playwright (`tests/live/flow/`, run via `npx playwright test`), SCSS, Mantine.

**Worktree:** Run from `/opt/Code/DaylightStation` after `EnterWorktree(name: cycle-demo-fixes)`. Production data volume is bind-mounted; live deploy is `sudo docker build … && sudo deploy-daylight` per `CLAUDE.local.md`.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `frontend/src/hooks/fitness/GovernanceEngine.js` | `_evaluateCycleChallenge` terminal guard; `tickManualCycle` unit fix + state-change nudge | modify |
| `frontend/src/modules/Fitness/player/overlays/cycleLockPanelData.js` | Round `currentRpm` and `targetRpm` to integers before display | modify |
| `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx` | Add swap button to the cycle-locked panel; accept `onRequestSwap` prop | modify |
| `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.scss` | Pin avatar `opacity: 1` and bump z-index above chip text | modify |
| `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx` | Pass `onRequestSwap` through so the existing `CycleRiderSwapModal` opens from the lock panel | modify |
| `tests/unit/suite/fitness/GovernanceEngine-cycleTerminalGuard.test.mjs` | Verify success/failed status doesn't re-emit transitions | create |
| `tests/unit/suite/fitness/GovernanceEngine-cycleProgressUnit.test.mjs` | Verify `phaseProgressPct` is 0–1 float on every code path | create |
| `tests/unit/suite/fitness/GovernanceEngine-simStateChangeEvent.test.mjs` | Existing test — extend to cover manual-cycle path | modify |
| `tests/unit/suite/fitness/cycleLockPanelData.test.mjs` | RPM rounding test cases | create |
| `tests/live/flow/fitness/cycle-demo-launch.runtime.test.mjs` | Existing exit-criterion test — extend to assert no transition spam | modify |

---

## Task 1: Terminal-status guard in `_evaluateCycleChallenge`

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (top of `_evaluateCycleChallenge`, near line 2328)
- Create: `tests/unit/suite/fitness/GovernanceEngine-cycleTerminalGuard.test.mjs`

**Why:** Once `active.status` becomes `'success'` or `'failed'`, the SM's branch logic still re-evaluates the same condition each tick (e.g. `phaseProgressMs >= maintainSeconds*1000` stays true) and re-fires the same `state_transition` log. Production logs show 40+ duplicate transitions in 10s. A single early-return at the top of the eval gates this off.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/suite/fitness/GovernanceEngine-cycleTerminalGuard.test.mjs`:

```javascript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine._evaluateCycleChallenge — terminal-status guard', () => {
  let engine;
  let active;
  const ctx = {
    equipmentRpm: 100,
    activeParticipants: ['kckern'],
    userZoneMap: { kckern: 'hot' },
    baseReqSatisfiedForRider: true,
    baseReqSatisfiedGlobal: true
  };

  beforeEach(() => {
    globalThis.window = {};
    engine = new GovernanceEngine({ roster: [], snapshot: { zoneConfig: [] } });
    active = {
      type: 'cycle',
      cycleState: 'maintain',
      currentPhaseIndex: 0,
      generatedPhases: [{ hiRpm: 50, loRpm: 38, rampSeconds: 10, maintainSeconds: 20 }],
      phaseProgressMs: 50000, // far past the 20s threshold
      totalPhases: 1,
      rider: 'kckern',
      manualTrigger: true,
      selection: { init: { minRpm: 30 } },
      _lastCycleTs: Date.now() - 1000
    };
  });

  it('does not re-emit transitions when status === success', () => {
    active.status = 'success';
    // Capture state before — the engine should make no mutations.
    const snapshot = JSON.stringify(active);
    engine._evaluateCycleChallenge(active, ctx);
    expect(JSON.stringify(active)).toBe(snapshot);
  });

  it('does not re-emit transitions when status === failed', () => {
    active.status = 'failed';
    const snapshot = JSON.stringify(active);
    engine._evaluateCycleChallenge(active, ctx);
    expect(JSON.stringify(active)).toBe(snapshot);
  });

  it('still evaluates pending challenges normally', () => {
    active.status = 'pending';
    engine._evaluateCycleChallenge(active, ctx);
    // pending challenge with phaseProgress past threshold and no more phases → success
    expect(active.status).toBe('success');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /opt/Code/DaylightStation
npm run test:unit -- --testPathPattern=GovernanceEngine-cycleTerminalGuard 2>&1 | grep -E "FAIL|PASS|✓|✗"
```
Expected: the first two cases fail because `active` gets mutated (cycleState/transitions logged) when status is already terminal.

- [ ] **Step 3: Add the guard at the top of `_evaluateCycleChallenge`**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, find `_evaluateCycleChallenge(active, ctx)` (around line 2328) and add this **as the very first statement of the method body** (before the existing `const now = this._now();`):

```javascript
  _evaluateCycleChallenge(active, ctx) {
    // Terminal-status guard: once a cycle has resolved (success or failed),
    // do not re-evaluate. The state-machine's branch conditions stay true
    // (e.g. phaseProgressMs >= maintainSeconds*1000) and would otherwise
    // re-emit the same state_transition every tick.
    if (active.status === 'success' || active.status === 'failed') {
      return;
    }

    const now = this._now();
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm run test:unit -- --testPathPattern=GovernanceEngine-cycleTerminalGuard 2>&1 | grep -E "PASS|FAIL"
```
Expected: `PASS tests/unit/suite/fitness/GovernanceEngine-cycleTerminalGuard.test.mjs` with 3 cases.

- [ ] **Step 5: Run the broader cycle test suite to confirm no regressions**

```bash
npm run test:unit -- --testPathPattern=GovernanceEngine-cycle 2>&1 | tail -10
```
Expected: existing cycle tests still pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        tests/unit/suite/fitness/GovernanceEngine-cycleTerminalGuard.test.mjs
git commit -m "$(cat <<'EOF'
fix(governance): guard _evaluateCycleChallenge against re-entry after terminal status

When active.status is 'success' or 'failed', the SM's branch conditions
(phaseProgressMs >= maintainSeconds*1000, etc.) stay true and the
maintain branch re-fires the state_transition log on every tick. Live
logs showed 40+ duplicate maintain→success transitions in 10 seconds.

A single early-return at the top of _evaluateCycleChallenge prevents
re-eval of completed challenges. The post-success cleanup in
_evaluateChallenges still runs since it sits outside this method.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Unify `phaseProgressPct` to 0–1 float everywhere

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (`tickManualCycle` body — currently writes `Math.round(... * 100)`)
- Create: `tests/unit/suite/fitness/GovernanceEngine-cycleProgressUnit.test.mjs`

**Why:** Two code paths set `active.phaseProgressPct`. `_evaluateChallenges:2963-2965` writes a 0–1 float (e.g. `0.4738`). `tickManualCycle` (introduced in commit `f170f244b`) writes a 0–100 integer (`Math.round(... * 100)`). The display sites all assume **0–1 float and apply `* 100` themselves** (e.g. `CycleChallengeOverlay.jsx:170`, `cycleOverlayVisuals.js:48`). When the manual path runs, a value like `47` gets multiplied to `4700` and rendered as `4700%` — or worse, the unrounded reverse case shows `0.4738%`. This is the "decimal overflow" symptom.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/suite/fitness/GovernanceEngine-cycleProgressUnit.test.mjs`:

```javascript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('Cycle phaseProgressPct unit consistency', () => {
  let engine;

  beforeEach(() => {
    globalThis.window = {};
    engine = new GovernanceEngine({ roster: [], snapshot: { zoneConfig: [] } });
    engine.media = null; // force the no-media early-return that triggers tickManualCycle
    engine._latestInputs = {
      activeParticipants: ['kckern'],
      userZoneMap: { kckern: 'hot' },
      equipmentCadenceMap: { cycle_ace: { rpm: 90, connected: true } }
    };
    engine.challengeState = {
      activeChallenge: {
        id: 'cyc_1',
        type: 'cycle',
        cycleState: 'maintain',
        equipment: 'cycle_ace',
        rider: 'kckern',
        manualTrigger: true,
        currentPhaseIndex: 0,
        totalPhases: 2,
        generatedPhases: [
          { hiRpm: 50, loRpm: 38, rampSeconds: 10, maintainSeconds: 20 },
          { hiRpm: 60, loRpm: 45, rampSeconds: 10, maintainSeconds: 20 }
        ],
        phaseProgressMs: 9000, // 45% of 20s
        status: 'pending',
        selection: { init: { minRpm: 30 } },
        _lastCycleTs: Date.now() - 1000
      }
    };
  });

  it('manualCycle path writes phaseProgressPct as a 0-1 float', () => {
    engine.evaluate({});
    const got = engine.challengeState.activeChallenge.phaseProgressPct;
    // 9000 / (20 * 1000) = 0.45
    expect(got).toBeGreaterThanOrEqual(0);
    expect(got).toBeLessThanOrEqual(1);
    expect(got).toBeCloseTo(0.45, 2);
  });

  it('window.__fitnessGovernance.phaseProgressPct is also 0-1 float', () => {
    engine.evaluate({});
    const gov = window.__fitnessGovernance;
    expect(gov.phaseProgressPct).toBeGreaterThanOrEqual(0);
    expect(gov.phaseProgressPct).toBeLessThanOrEqual(1);
    expect(gov.phaseProgressPct).toBeCloseTo(0.45, 2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test:unit -- --testPathPattern=GovernanceEngine-cycleProgressUnit 2>&1 | grep -E "FAIL|PASS|Expected|Received" | head -10
```
Expected: FAIL — first case shows `Received: 45` (integer percent) instead of `0.45`.

- [ ] **Step 3: Fix `tickManualCycle` to write the 0-1 float**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, find `tickManualCycle` (look for the comment "Propagate currentRpm + phaseProgressPct so window globals reflect"). Replace the existing assignment:

```javascript
      active.phaseProgressPct = phase?.maintainSeconds
        ? Math.round(Math.min(1.0, (active.phaseProgressMs || 0) / (phase.maintainSeconds * 1000)) * 100)
        : 0;
```

with the 0–1 float form (matches `_evaluateChallenges:2963-2965`):

```javascript
      active.phaseProgressPct = phase?.maintainSeconds
        ? Math.min(1.0, (active.phaseProgressMs || 0) / (phase.maintainSeconds * 1000))
        : 0;
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm run test:unit -- --testPathPattern=GovernanceEngine-cycleProgressUnit 2>&1 | grep -E "PASS|FAIL"
```
Expected: PASS, both cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        tests/unit/suite/fitness/GovernanceEngine-cycleProgressUnit.test.mjs
git commit -m "$(cat <<'EOF'
fix(governance): unify phaseProgressPct unit (0-1 float) across both eval paths

tickManualCycle wrote phaseProgressPct as a 0-100 integer
(Math.round(... * 100)) while _evaluateChallenges writes the canonical
0-1 float. Display sites (CycleChallengeOverlay, the demo panel)
multiply by 100 themselves, so the integer form rendered as 4700%
or worse showed unrounded sub-1 floats as '0.4738%'.

Standardize on 0-1 float in both paths.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `tickManualCycle` triggers React state nudge

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (`tickManualCycle` body)
- Modify: `tests/unit/suite/fitness/GovernanceEngine-simStateChangeEvent.test.mjs` (extend existing test)

**Why:** `_updateGlobalState` (called inside `tickManualCycle`) writes to `window.__fitnessGovernance` but doesn't notify React. The `CycleChallengeOverlay`'s needle reads `challenge.currentRpm` from a React prop sourced from `useFitnessContext().governanceState`, which only updates when the engine fires its existing `onCycleStateChange` callback (wired in commit `a962054f1` to dispatch `sim-state-change`). The auto-running demo holds RPM at 90 for 12s but the needle stays at the value from the last regular evaluate tick — looking like "stuck at 0".

- [ ] **Step 1: Extend the existing test**

Open `tests/unit/suite/fitness/GovernanceEngine-simStateChangeEvent.test.mjs` and append a new `it(...)` case at the bottom of the describe block:

```javascript
  it('fires onCycleStateChange when tickManualCycle runs and cycle signature changes', () => {
    const cb = jest.fn();
    engine.onCycleStateChange = cb;
    engine.media = null; // hits no-media early-return → tickManualCycle path
    engine._latestInputs = {
      activeParticipants: ['kckern'],
      userZoneMap: { kckern: 'hot' },
      equipmentCadenceMap: { cycle_ace: { rpm: 35, connected: true } }
    };
    engine.challengeState = {
      activeChallenge: {
        id: 'cyc_1',
        type: 'cycle',
        cycleState: 'init',
        equipment: 'cycle_ace',
        rider: 'kckern',
        manualTrigger: true,
        currentPhaseIndex: 0,
        totalPhases: 1,
        generatedPhases: [{ hiRpm: 50, loRpm: 38, rampSeconds: 10, maintainSeconds: 20 }],
        phaseProgressMs: 0,
        initElapsedMs: 0,
        initTotalMs: 60000,
        status: 'pending',
        selection: { init: { minRpm: 30 } }
      }
    };
    // First evaluate establishes baseline signature.
    engine.evaluate({});
    const callsAfterFirst = cb.mock.calls.length;

    // Force a state transition: rpm=35 should advance init → ramp.
    engine.evaluate({});
    expect(cb.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm run test:unit -- --testPathPattern=GovernanceEngine-simStateChangeEvent 2>&1 | tail -10
```
Expected: FAIL — `tickManualCycle` calls `_updateGlobalState` which DOES check `cycleSig` for changes, but only fires the callback when called from the main path. The manual path calls `_updateGlobalState` so this should work… verify the actual failure reason. (If it already passes, skip Step 3 — `_updateGlobalState` already includes the callback fire; the test simply documents that the manual path produces it.)

- [ ] **Step 3: Confirm `tickManualCycle` invokes `_updateGlobalState`**

In `GovernanceEngine.js`, look at `tickManualCycle` and verify the **last line of the helper before its closing brace** is:

```javascript
      this._updateGlobalState();
```

If absent, add it. The signature change detection inside `_updateGlobalState` (commit `a962054f1`) handles the rest. No code change needed if it's already there.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm run test:unit -- --testPathPattern=GovernanceEngine-simStateChangeEvent 2>&1 | grep -E "PASS|FAIL"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        tests/unit/suite/fitness/GovernanceEngine-simStateChangeEvent.test.mjs
git commit -m "$(cat <<'EOF'
test(governance): cover tickManualCycle path of onCycleStateChange callback

The callback fires from _updateGlobalState whenever the cycle
signature changes. tickManualCycle invokes _updateGlobalState so the
React subscription wakes up between regular eval ticks, keeping the
overlay's needle in sync with the cadence map.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Round `currentRpm` and `targetRpm` in `cycleLockPanelData`

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/cycleLockPanelData.js`
- Create: `tests/unit/suite/fitness/cycleLockPanelData.test.mjs`

**Why:** The lock panel renders `{cycleLockData.currentRpm} RPM` and `{cycleLockData.targetRpm} RPM` directly without rounding (`GovernanceStateOverlay.jsx:646`, `:651`). If upstream sends a float (which can happen when smoothing or interpolation is applied to ANT+ samples), the panel shows `89.738383 RPM` — the "massive rounding overflow" the user reported. Defensive `Math.round` at the data layer means the display stays sane regardless of upstream precision.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/suite/fitness/cycleLockPanelData.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { computeCycleLockPanelData } from '#frontend/modules/Fitness/player/overlays/cycleLockPanelData.js';

describe('computeCycleLockPanelData rounding', () => {
  const baseChallenge = {
    type: 'cycle',
    cycleState: 'locked',
    lockReason: 'maintain',
    rider: { id: 'felix', name: 'Felix' },
    currentPhase: { hiRpm: 84.7172, loRpm: 63.4 }
  };

  it('rounds fractional currentRpm to integer', () => {
    const out = computeCycleLockPanelData({ ...baseChallenge, currentRpm: 89.7383 }, 'hot');
    expect(out.currentRpm).toBe(90);
    expect(Number.isInteger(out.currentRpm)).toBe(true);
  });

  it('rounds fractional targetRpm to integer', () => {
    const out = computeCycleLockPanelData({ ...baseChallenge, currentRpm: 50 }, 'hot');
    expect(out.targetRpm).toBe(85);
    expect(Number.isInteger(out.targetRpm)).toBe(true);
  });

  it('preserves zero', () => {
    const out = computeCycleLockPanelData({ ...baseChallenge, currentRpm: 0 }, 'hot');
    expect(out.currentRpm).toBe(0);
  });

  it('handles init lockReason with fractional initMinRpm', () => {
    const out = computeCycleLockPanelData(
      { ...baseChallenge, lockReason: 'init', currentRpm: 12.5, initMinRpm: 30.7 },
      'cool'
    );
    expect(out.targetRpm).toBe(31);
    expect(out.currentRpm).toBe(13);
  });

  it('returns null for non-cycle challenges (unchanged contract)', () => {
    const out = computeCycleLockPanelData({ type: 'zone', cycleState: 'locked' }, 'hot');
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm run test:unit -- --testPathPattern=cycleLockPanelData 2>&1 | grep -E "FAIL|PASS|Expected|Received" | head -10
```
Expected: FAIL — `out.currentRpm` is `89.7383`, not `90`.

- [ ] **Step 3: Add rounding in the helper**

Open `frontend/src/modules/Fitness/player/overlays/cycleLockPanelData.js`. Find the lines that compute `currentRpm` and `targetRpm`. Replace:

```javascript
  const currentRpm = Number.isFinite(challenge.currentRpm) ? challenge.currentRpm : 0;

  let targetRpm;
  let instruction;

  if (lockReason === 'init') {
    targetRpm = Number.isFinite(challenge.initMinRpm)
      ? challenge.initMinRpm
      : (Number.isFinite(challenge.selection?.init?.minRpm)
          ? challenge.selection.init.minRpm
          : 30);
    instruction = `Get on the bike — reach ${targetRpm} RPM`;
  } else if (lockReason === 'ramp' || lockReason === 'maintain') {
    targetRpm = Number.isFinite(phase?.hiRpm) ? phase.hiRpm : 0;
    instruction = lockReason === 'ramp'
      ? `Climb to ${targetRpm} RPM`
      : `Reach ${targetRpm} RPM to resume`;
  } else {
    targetRpm = Number.isFinite(phase?.hiRpm) ? phase.hiRpm : 0;
    instruction = `Reach ${targetRpm} RPM to resume`;
  }
```

with:

```javascript
  const currentRpm = Number.isFinite(challenge.currentRpm)
    ? Math.round(challenge.currentRpm)
    : 0;

  let targetRpmRaw;
  let instruction;

  if (lockReason === 'init') {
    targetRpmRaw = Number.isFinite(challenge.initMinRpm)
      ? challenge.initMinRpm
      : (Number.isFinite(challenge.selection?.init?.minRpm)
          ? challenge.selection.init.minRpm
          : 30);
  } else if (lockReason === 'ramp' || lockReason === 'maintain') {
    targetRpmRaw = Number.isFinite(phase?.hiRpm) ? phase.hiRpm : 0;
  } else {
    targetRpmRaw = Number.isFinite(phase?.hiRpm) ? phase.hiRpm : 0;
  }

  const targetRpm = Math.round(targetRpmRaw);

  if (lockReason === 'init') {
    instruction = `Get on the bike — reach ${targetRpm} RPM`;
  } else if (lockReason === 'ramp') {
    instruction = `Climb to ${targetRpm} RPM`;
  } else {
    instruction = `Reach ${targetRpm} RPM to resume`;
  }
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm run test:unit -- --testPathPattern=cycleLockPanelData 2>&1 | grep -E "PASS|FAIL"
```
Expected: PASS, all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/cycleLockPanelData.js \
        tests/unit/suite/fitness/cycleLockPanelData.test.mjs
git commit -m "$(cat <<'EOF'
fix(fitness): round currentRpm + targetRpm in cycle lock panel data

The lock panel renders the values directly without rounding, so a
fractional upstream RPM (e.g. 89.7383) shows as 'massive decimal
overflow' on screen. Apply Math.round at the data-layer helper so
upstream precision can never leak into the UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Lock-panel avatar opacity + z-index

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.scss`

**Why:** Live screenshots showed the cycle-locked avatar half-transparent with the chip name overlapping it. Two SCSS issues converge here: (1) the surrounding `.governance-lock__row--passed { opacity: 0.3 }` rule cascades into the avatar when the row briefly carries that class during transitions; (2) `.governance-lock__chip-text` and `.governance-lock__avatar` have no explicit `z-index`, so source order alone determines stacking, which fails when transforms create new stacking contexts. Pin `opacity: 1` and `z-index: 2` on the avatar to win unconditionally.

This task has no automated test (pure SCSS); verify visually after deploy.

- [ ] **Step 1: Find the avatar rule**

```bash
grep -n "governance-lock__avatar\b\|governance-lock__chip\b" \
  frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.scss | head -10
```

The avatar rule lives near line 557. Open the file at that location.

- [ ] **Step 2: Pin opacity and z-index on the avatar**

In `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.scss`, find the rule that opens with `.governance-lock__avatar {` (look for `&__avatar {` in nested form near line 453, OR the bare `.governance-lock__avatar { ... }` rule near line 557). Add at the top of the rule body:

```scss
    opacity: 1 !important;
    position: relative;
    z-index: 2;
```

Find the chip text rule (`.governance-lock__chip-text` or `&__chip-text`) and add:

```scss
    position: relative;
    z-index: 1;
```

If both rules already have `position` set, just add the `z-index` and `opacity` lines.

- [ ] **Step 3: Build to confirm SCSS compiles**

```bash
cd /opt/Code/DaylightStation/frontend
npx vite build 2>&1 | tail -5
```
Expected: build completes with no SCSS errors.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.scss
git commit -m "$(cat <<'EOF'
fix(fitness): pin cycle-locked avatar opacity:1 + z-index above chip text

The lock-panel avatar was rendering half-transparent with the chip name
text stacked over it. Two converging SCSS issues: a passed-row opacity
fade cascading into the avatar, plus stacking determined by source
order alone (no explicit z-index) failing when CSS transforms create
new stacking contexts. Pin opacity:1 !important and z-index:2 on the
avatar; z-index:1 on the chip text. Cosmetic — no behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Surface a swap-rider button from the lock panel

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx` (cycle-locked render block, around line 615-665)
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx` (pass `onRequestSwap` prop down)
- Modify: `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.scss` (button styling)

**Why:** When `cycleState === 'locked'`, `FitnessPlayerOverlay:184-194` hides `CycleChallengeOverlay` and the lock panel takes over. The swap-rider affordance lives only on the cycle overlay's avatar (tap to open `CycleRiderSwapModal`). When locked, the user has no way to swap to a fresh rider — they're stuck pedaling the original rider's challenge.

- [ ] **Step 1: Add the prop + button to `GovernanceStateOverlay`**

Open `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx`. Find the function signature near line 551:

```javascript
const GovernanceStateOverlay = ({ display, overlay = null, lockRows = [], warningOffenders = [] }) => {
```

Replace with:

```javascript
const GovernanceStateOverlay = ({
  display,
  overlay = null,
  lockRows = [],
  warningOffenders = [],
  onRequestSwap = null,
  swapAllowed = false
}) => {
```

Find the cycle-locked render block (around line 625, opens with `<>` and includes `<GovernanceAudioPlayer trackKey={audioTrackKey} />`). Locate the closing `</div>` of the inner `<div className="governance-lock__table">`. **Immediately after that closing `</div>` and before the panel's outer closing `</div>`**, insert the swap action row:

```javascript
                {swapAllowed && typeof onRequestSwap === 'function' ? (
                  <div className="governance-lock__actions">
                    <button
                      type="button"
                      className="governance-lock__swap-btn"
                      onClick={onRequestSwap}
                    >
                      Switch Rider
                    </button>
                  </div>
                ) : null}
```

So the panel structure becomes: title → message → table (existing) → actions (new) → close panel div.

- [ ] **Step 2: Update propTypes**

Find the propTypes block near line 714:

```javascript
GovernanceStateOverlay.propTypes = {
  display: PropTypes.object,
  overlay: PropTypes.object,
  lockRows: PropTypes.array,
  warningOffenders: PropTypes.array
};
```

Add the two new props:

```javascript
GovernanceStateOverlay.propTypes = {
  display: PropTypes.object,
  overlay: PropTypes.object,
  lockRows: PropTypes.array,
  warningOffenders: PropTypes.array,
  onRequestSwap: PropTypes.func,
  swapAllowed: PropTypes.bool
};
```

- [ ] **Step 3: Style the button in SCSS**

Open `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.scss`. At the bottom of the `.governance-lock` rule block (just before its closing `}`), add:

```scss
  &__actions {
    display: flex;
    justify-content: center;
    margin-top: clamp(12px, 2vw, 20px);
  }

  &__swap-btn {
    background: rgba(59, 130, 246, 0.18);
    color: #f1f5f9;
    border: 1px solid rgba(59, 130, 246, 0.45);
    border-radius: 8px;
    padding: clamp(8px, 1.5vw, 14px) clamp(16px, 3vw, 28px);
    font-size: clamp(0.9rem, 1.4vw, 1.05rem);
    font-weight: 600;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: background 0.18s ease, border-color 0.18s ease;

    &:hover {
      background: rgba(59, 130, 246, 0.32);
      border-color: rgba(59, 130, 246, 0.7);
    }

    &:focus-visible {
      outline: 2px solid rgba(59, 130, 246, 0.85);
      outline-offset: 3px;
    }
  }
```

- [ ] **Step 4: Pass the prop from `FitnessPlayerOverlay`**

Open `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx`. Find where `<GovernanceStateOverlay display={governanceDisplay} />` is rendered (look for the `primaryOverlay` const, around line 203):

```javascript
  const primaryOverlay = governanceDisplay?.show ? (
    <GovernanceStateOverlay display={governanceDisplay} />
  ) : null;
```

Change to:

```javascript
  const primaryOverlay = governanceDisplay?.show ? (
    <GovernanceStateOverlay
      display={governanceDisplay}
      onRequestSwap={isCycleChallenge && activeChallenge?.swapAllowed ? handleRequestSwap : null}
      swapAllowed={isCycleChallenge && Boolean(activeChallenge?.swapAllowed)}
    />
  ) : null;
```

`handleRequestSwap` already exists in this file (look near line 100; it sets `setIsSwapModalOpen(true)`). `activeChallenge.swapAllowed` is already populated by the engine snapshot.

- [ ] **Step 5: Build to verify**

```bash
cd /opt/Code/DaylightStation/frontend
npx vite build 2>&1 | tail -5
```
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx \
        frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.scss \
        frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx
git commit -m "$(cat <<'EOF'
feat(fitness): add Switch Rider button to cycle lock panel

When the cycle locks, the regular CycleChallengeOverlay hides (the
GovernanceStateOverlay lock panel takes over), and with it goes the
only swap-rider affordance (tapping the rider avatar). Riders had no
way to hand off mid-lock.

Add a Switch Rider button to the lock panel that opens the existing
CycleRiderSwapModal via the same handleRequestSwap path the cycle
overlay used. Gated on activeChallenge.swapAllowed so it only appears
when the engine permits a swap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 (EXIT CRITERION): Extend the lifecycle Playwright test

**Files:**
- Modify: `tests/live/flow/fitness/cycle-demo-launch.runtime.test.mjs`

**Why:** The original lifecycle test only verifies the demo overlay mounts. It does not catch transition spam (which was the core symptom the user reported). Extend it to assert the full bug-fix contract:
1. Cycle reaches `success` exactly once during the run.
2. No more than 3 `state_transition: maintain → success` log events fire (one is the legitimate transition; up to 2 is a fudge for tick variability).
3. `phaseProgressPct` stays in `[0, 1]` whenever it's non-null.
4. The lock panel's RPM display is integer (no decimals).

- [ ] **Step 1: Extend the test**

Open `tests/live/flow/fitness/cycle-demo-launch.runtime.test.mjs`. After the existing `await expect(panel.locator('button', { hasText: '75 RPM' })).toBeVisible();` line, append a new test inside the `test.describe(...)` block:

```javascript
  test('demo runs one full lifecycle without transition spam or unit bugs', async ({ page }) => {
    const transitions = [];
    page.on('console', (msg) => {
      const t = msg.text();
      const successMatch = t.match(/state_transition.*"from":"maintain","to":"success"/);
      if (successMatch) transitions.push({ at: Date.now(), text: t.slice(0, 200) });
    });

    await page.goto(`${FRONTEND_URL}/fitness/menu/app_menu1`);
    await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });
    await page.locator('.module-card', { hasText: 'Cycle Challenge Demo' }).click();
    await page.waitForURL(/\/fitness\/play\/\d+\?.*cycle-demo=1/, { timeout: 15000 });
    await expect(page.locator('.cycle-challenge-demo')).toBeVisible({ timeout: 15000 });

    // Sample phaseProgressPct over time; must always be in [0, 1] when non-null.
    const samples = [];
    const deadline = Date.now() + 90000; // 90s window — covers ~1 full demo iteration
    while (Date.now() < deadline) {
      const sample = await page.evaluate(() => {
        const g = window.__fitnessGovernance;
        return g ? { progress: g.phaseProgressPct, state: g.cycleState, rpm: g.currentRpm } : null;
      });
      if (sample) samples.push(sample);
      await page.waitForTimeout(500);
    }

    // 1. Progress unit: every non-null sample must be in [0, 1].
    const progressSamples = samples.filter((s) => s.progress != null);
    expect(progressSamples.length).toBeGreaterThan(5);
    for (const s of progressSamples) {
      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThanOrEqual(1);
    }

    // 2. No transition spam: at most 3 maintain→success events.
    expect(transitions.length).toBeLessThanOrEqual(3);

    // 3. Saw cycleState=maintain at some point — proves SM advanced.
    const sawMaintain = samples.some((s) => s.state === 'maintain');
    expect(sawMaintain).toBe(true);
  });
```

- [ ] **Step 2: Build + deploy the worktree's image**

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
until curl -fsS http://localhost:3111/api/v1/fitness > /dev/null 2>&1; do sleep 2; done
echo ready
```

- [ ] **Step 3: Run the extended test**

```bash
BASE_URL=http://localhost:3111 TEST_FRONTEND_URL=http://localhost:3111 \
  npx playwright test tests/live/flow/fitness/cycle-demo-launch.runtime.test.mjs --reporter=line 2>&1 | tail -20
```

Expected: both tests in the file pass — the original launch test plus the new lifecycle assertion.

- [ ] **Step 4: Commit**

```bash
git add tests/live/flow/fitness/cycle-demo-launch.runtime.test.mjs
git commit -m "$(cat <<'EOF'
test(fitness): cycle demo lifecycle assertion — no transition spam, unit-safe

Extends the existing launch test with a 90-second sample window that
verifies (1) phaseProgressPct stays in [0,1] across the lifecycle,
(2) maintain→success state_transition fires no more than 3 times
(catching the 40-event spam regression), and (3) the SM actually
advances to maintain. Exit criterion for the cycle-demo bug-fix plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist (after all tasks committed)

- [ ] `npm run test:unit -- --testPathPattern=cycle` — every cycle-related unit test passes.
- [ ] `npx playwright test tests/live/flow/fitness/cycle-demo-launch.runtime.test.mjs --reporter=line` — both tests pass.
- [ ] Open `https://daylightlocal.kckern.net/fitness/menu/app_menu1` → tap **Cycle Challenge Demo** → watch one full iteration. Visually verify:
  - Needle tracks RPM in real-time (not stuck at 0).
  - No flashing on/off.
  - Progress bar fills smoothly to 100% and the phase counter advances.
  - Lock panel shows integer RPMs, no decimal overflow.
  - Avatar fully opaque, name beside it, no overlap.
  - "Switch Rider" button visible on lock panel; clicking opens the swap modal with felix and milo.
- [ ] `sudo docker logs --since 5m daylight-station 2>&1 | grep "maintain.*success" | wc -l` after a single demo iteration — should print ≤ 3 (one or two legitimate transitions, never 40+).
- [ ] Update `docs/_wip/audits/2026-04-30-cycling-challenge-simulator-unusable-audit.md` with a new resolution footer pointing at the merge commit.

---

## Out of Scope

- **Cycle failure path** — there's still no `cycle.failed` event. Surfacing one (with a configurable lock-timeout, countdown, and failure modal) is a separate plan; this plan only ensures the existing success path works.
- **Boost multiplier UX** — the booster avatars and ×2.5 badge already work; not touched here.
- **Cooldown handling** — the swap modal already filters out riders on cooldown via `formatCooldownHint`; no changes.
