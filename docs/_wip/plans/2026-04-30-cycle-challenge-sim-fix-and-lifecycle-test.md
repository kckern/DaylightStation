# Cycle Challenge Simulator — Fix & Lifecycle Test Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cycling-challenge simulator popout end-to-end usable, then prove it with a Playwright lifecycle test that opens a cycling video, simulates HR users, triggers a cycle challenge, and walks the full state machine through to success.

**Architecture:** Wire the four broken integration points identified in `docs/_wip/audits/2026-04-30-cycling-challenge-simulator-unusable-audit.md`: (1) populate the equipment catalog from config, (2) expose a public getter on the device router, (3) bridge cycle-challenge state from `GovernanceEngine` to `window.__fitnessGovernance`, (4) fire `sim-state-change` on engine ticks. Each fix is small and additive. The Playwright test is the exit criterion — it must pass without any other test failing.

**Tech Stack:** React + jest (unit, `tests/unit/`, `@jest/globals`, harness `npm run test:unit`); Playwright runtime tests (`tests/live/flow/`, harness `npm run test:live:flow`). Existing helpers: `tests/_lib/FitnessSimHelper.mjs`, `tests/_fixtures/runtime/urls.mjs`.

---

## Pre-flight

- [ ] Read `docs/_wip/audits/2026-04-30-cycling-challenge-simulator-unusable-audit.md` end-to-end. Every reference below cites that document.
- [ ] Confirm dev server: `lsof -i :3112` (kckern-server). If not running: `node backend/index.js` (per `CLAUDE.md`'s runbook).
- [ ] Confirm prod fixture data exists: `sudo docker exec daylight-station sh -c 'grep -A2 "id: cycle_ace" data/household/config/fitness.yml'` should print equipment with `cadence: 49904` and `eligible_users: [kckern, felix, milo]`.

---

## Task 1: Add `getEquipmentCatalog()` to DeviceEventRouter and FitnessSession (P0-2)

**Files:**
- Modify: `frontend/src/hooks/fitness/DeviceEventRouter.js:73` (after `setEquipmentCatalog`)
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1005-1010` (after `setEquipmentCatalog`)
- Test: `tests/unit/suite/fitness/DeviceEventRouter-equipmentCatalog.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/suite/fitness/DeviceEventRouter-equipmentCatalog.test.mjs
import { describe, it, expect, beforeEach } from '@jest/globals';

const { DeviceEventRouter } = await import('#frontend/hooks/fitness/DeviceEventRouter.js');

describe('DeviceEventRouter equipment catalog', () => {
  let router;

  beforeEach(() => {
    router = new DeviceEventRouter({});
  });

  it('returns [] before any catalog is set', () => {
    expect(router.getEquipmentCatalog()).toEqual([]);
  });

  it('returns the entries previously set via setEquipmentCatalog', () => {
    const entries = [
      { id: 'cycle_ace', cadence: 49904, eligible_users: ['felix'] },
      { id: 'tricycle', cadence: 7153, eligible_users: ['niels'] }
    ];
    router.setEquipmentCatalog(entries);
    expect(router.getEquipmentCatalog()).toEqual(entries);
  });

  it('returns a defensive copy so callers cannot mutate the internal list', () => {
    const entries = [{ id: 'x', cadence: 1 }];
    router.setEquipmentCatalog(entries);
    const result = router.getEquipmentCatalog();
    result.push({ id: 'mutation' });
    expect(router.getEquipmentCatalog()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:unit -- --testPathPattern=DeviceEventRouter-equipmentCatalog
```
Expected: FAIL — `router.getEquipmentCatalog is not a function`.

- [ ] **Step 3: Add the getter to `DeviceEventRouter`**

In `frontend/src/hooks/fitness/DeviceEventRouter.js`, immediately after the `setEquipmentCatalog` method (around line 79), insert:

```javascript
  /**
   * Get the current equipment catalog (defensive copy).
   * @returns {Array} Equipment list previously set via setEquipmentCatalog
   */
  getEquipmentCatalog() {
    const list = this._context.equipmentCatalog;
    return Array.isArray(list) ? list.slice() : [];
  }
```

- [ ] **Step 4: Add the forwarding getter to `FitnessSession`**

In `frontend/src/hooks/fitness/FitnessSession.js`, immediately after `setEquipmentCatalog` (around line 1008), insert:

```javascript
  /**
   * Get equipment catalog via the device router.
   * @returns {Array} Equipment entries with id, cadence, eligible_users, etc.
   */
  getEquipmentCatalog() {
    return this._deviceRouter?.getEquipmentCatalog?.() || [];
  }
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run test:unit -- --testPathPattern=DeviceEventRouter-equipmentCatalog
```
Expected: PASS — all three test cases.

- [ ] **Step 6: Run cycle controller tests to confirm no regression**

```bash
npm run test:unit -- --testPathPattern=FitnessSimulationController-cycling
```
Expected: PASS (these tests already stub `getEquipmentCatalog`, so they should still work).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/DeviceEventRouter.js \
        frontend/src/hooks/fitness/FitnessSession.js \
        tests/unit/suite/fitness/DeviceEventRouter-equipmentCatalog.test.mjs
git commit -m "feat(fitness): add getEquipmentCatalog() to DeviceEventRouter and FitnessSession

Closes P0-2 from cycling-challenge simulator audit. The simulation
controller and GovernanceEngine both call this method via optional
chaining; without it they silently get [] and the cycle feature is
inert."
```

---

## Task 2: Populate equipment catalog from fitness config (P0-1)

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx` (find where `fitnessSessionRef.current` is created/updated and the config arrives)
- Test: `tests/unit/suite/fitness/FitnessContext-equipmentCatalog.test.mjs` (new)

- [ ] **Step 1: Find the config-load wiring site**

Run:
```bash
grep -n "setEquipmentCatalog\|fitnessConfiguration\|fitness.equipment\|new FitnessSession\|fitnessSessionRef" frontend/src/context/FitnessContext.jsx | head -30
```

Identify the effect (or function) that runs when `fitnessConfiguration.fitness.equipment` becomes available. The catalog must be set on `fitnessSessionRef.current` whenever `equipment` changes, and re-applied if the session is recreated.

- [ ] **Step 2: Write the failing integration test**

```javascript
// tests/unit/suite/fitness/FitnessContext-equipmentCatalog.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { FitnessSession } = await import('#frontend/hooks/fitness/FitnessSession.js');
const { applyEquipmentCatalogFromConfig } = await import('#frontend/context/fitnessConfigBridge.js');

describe('fitnessConfigBridge.applyEquipmentCatalogFromConfig', () => {
  let session;

  beforeEach(() => {
    session = new FitnessSession({});
  });

  it('passes equipment from config.fitness.equipment to the session', () => {
    const cfg = {
      fitness: {
        equipment: [
          { id: 'cycle_ace', cadence: 49904, eligible_users: ['felix'] }
        ]
      }
    };
    applyEquipmentCatalogFromConfig(session, cfg);
    expect(session.getEquipmentCatalog()).toEqual(cfg.fitness.equipment);
  });

  it('passes equipment from top-level config.equipment as fallback', () => {
    const cfg = { equipment: [{ id: 'tricycle', cadence: 7153 }] };
    applyEquipmentCatalogFromConfig(session, cfg);
    expect(session.getEquipmentCatalog()).toEqual(cfg.equipment);
  });

  it('clears the catalog when config has no equipment', () => {
    session.setEquipmentCatalog([{ id: 'old' }]);
    applyEquipmentCatalogFromConfig(session, { fitness: {} });
    expect(session.getEquipmentCatalog()).toEqual([]);
  });

  it('is a no-op when session is null', () => {
    expect(() => applyEquipmentCatalogFromConfig(null, {})).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm run test:unit -- --testPathPattern=FitnessContext-equipmentCatalog
```
Expected: FAIL — module `fitnessConfigBridge.js` not found.

- [ ] **Step 4: Create the bridge helper**

Create `frontend/src/context/fitnessConfigBridge.js`:

```javascript
/**
 * Bridge fitness configuration values into a FitnessSession instance.
 * Centralizes the wiring so it is unit-testable and reusable across
 * config-reload paths.
 */

/**
 * Apply equipment catalog from a fitness config object onto a session.
 * Reads `config.fitness.equipment` first, falls back to `config.equipment`.
 * Empty/missing values clear the catalog rather than leaving stale data.
 */
export function applyEquipmentCatalogFromConfig(session, config) {
  if (!session?.setEquipmentCatalog) return;
  const root = config?.fitness || config || {};
  const list = Array.isArray(root.equipment) ? root.equipment : [];
  session.setEquipmentCatalog(list);
}
```

- [ ] **Step 5: Wire it into FitnessContext**

In `frontend/src/context/FitnessContext.jsx`, find the `useEffect` that responds to `fitnessConfiguration` changes (or the effect that creates `fitnessSessionRef.current`). Import the bridge at the top:

```javascript
import { applyEquipmentCatalogFromConfig } from './fitnessConfigBridge.js';
```

Inside the effect that has `fitnessConfiguration` in its dep list, after the session is initialized/updated, add:

```javascript
applyEquipmentCatalogFromConfig(fitnessSessionRef.current, fitnessConfiguration);
```

If no such effect exists, add a new one:

```javascript
useEffect(() => {
  applyEquipmentCatalogFromConfig(fitnessSessionRef.current, fitnessConfiguration);
}, [fitnessConfiguration]);
```

- [ ] **Step 6: Run the unit test to verify it passes**

```bash
npm run test:unit -- --testPathPattern=FitnessContext-equipmentCatalog
```
Expected: PASS — all four cases.

- [ ] **Step 7: Smoke-check in dev**

Start dev server if not running, then in browser console at `/fitness`:
```javascript
window.__fitnessSimController.getEquipment()
```
Expected: an array including `{ equipmentId: 'cycle_ace', name: 'CycleAce', cadenceDeviceId: '49904', eligibleUsers: ['kckern','felix','milo'], ... }` (per the prod YAML).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/context/fitnessConfigBridge.js \
        frontend/src/context/FitnessContext.jsx \
        tests/unit/suite/fitness/FitnessContext-equipmentCatalog.test.mjs
git commit -m "feat(fitness): apply equipment catalog from config to session

Closes P0-1 from cycling-challenge simulator audit. The catalog setter
existed but had no caller; the simulator and GovernanceEngine both
relied on it being populated."
```

---

## Task 3: Expose cycle fields on `window.__fitnessGovernance` (P0-3)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:385-409` (`_updateGlobalState`)
- Test: `tests/unit/suite/fitness/GovernanceEngine-cycleWindowState.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/suite/fitness/GovernanceEngine-cycleWindowState.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine._updateGlobalState — cycle fields', () => {
  let engine;

  beforeEach(() => {
    delete window.__fitnessGovernance;
    engine = new GovernanceEngine({ session: null });
  });

  it('exposes null cycle fields when no challenge is active', () => {
    engine._updateGlobalState();
    const gov = window.__fitnessGovernance;
    expect(gov.activeChallengeType).toBeNull();
    expect(gov.cycleState).toBeNull();
    expect(gov.currentRpm).toBeNull();
    expect(gov.riderId).toBeNull();
    expect(gov.currentPhaseIndex).toBeNull();
    expect(gov.totalPhases).toBeNull();
    expect(gov.phaseProgressPct).toBeNull();
    expect(gov.activeChallengeEquipment).toBeNull();
  });

  it('exposes cycle-challenge state when one is active', () => {
    engine.challengeState = {
      activeChallenge: {
        id: 'cyc_1',
        type: 'cycle',
        cycleState: 'ramp',
        equipment: 'cycle_ace',
        rider: { id: 'felix', name: 'Felix' },
        currentPhaseIndex: 1,
        totalPhases: 4,
        phaseProgressPct: 42,
        currentRpm: 67
      }
    };
    engine._updateGlobalState();
    const gov = window.__fitnessGovernance;
    expect(gov.activeChallengeType).toBe('cycle');
    expect(gov.cycleState).toBe('ramp');
    expect(gov.currentRpm).toBe(67);
    expect(gov.riderId).toBe('felix');
    expect(gov.currentPhaseIndex).toBe(1);
    expect(gov.totalPhases).toBe(4);
    expect(gov.phaseProgressPct).toBe(42);
    expect(gov.activeChallengeEquipment).toBe('cycle_ace');
  });

  it('returns null for missing rider object (e.g. mid-swap)', () => {
    engine.challengeState = {
      activeChallenge: { type: 'cycle', cycleState: 'init', equipment: 'cycle_ace', rider: null }
    };
    engine._updateGlobalState();
    expect(window.__fitnessGovernance.riderId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:unit -- --testPathPattern=GovernanceEngine-cycleWindowState
```
Expected: FAIL — `gov.activeChallengeType` is `undefined`, not `null`.

- [ ] **Step 3: Extend `_updateGlobalState`**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, modify the object literal at lines 388-407 by adding the cycle fields. The full updated method body:

```javascript
  _updateGlobalState() {
    if (typeof window !== 'undefined') {
      const self = this;
      const active = this.challengeState?.activeChallenge || null;
      const isCycle = active?.type === 'cycle';
      window.__fitnessGovernance = {
        phase: this.phase,
        get warningDuration() {
          return self._warningStartTime ? self._now() - self._warningStartTime : 0;
        },
        get lockDuration() {
          return self._lockStartTime ? self._now() - self._lockStartTime : 0;
        },
        activeChallenge: active?.id || null,
        activeChallengeZone: active?.zone || null,
        videoLocked: (this.challengeState?.videoLocked || this._mediaIsGoverned())
          && this.phase !== 'unlocked' && this.phase !== 'warning',
        contentId: this.media?.id || null,
        satisfiedOnce: this.meta?.satisfiedOnce || false,
        userZoneMap: { ...(this._latestInputs?.userZoneMap || {}) },
        activeParticipants: [...(this._latestInputs?.activeParticipants || [])],
        zoneRankMap: { ...(this._latestInputs?.zoneRankMap || {}) },
        // Cycle-challenge state — null when no cycle challenge is active.
        // Consumers: sim-panel.html readCycleChallengeInfo(), CycleChallengeOverlay diagnostics.
        activeChallengeType: active?.type || null,
        activeChallengeEquipment: isCycle ? (active.equipment || null) : null,
        cycleState: isCycle ? (active.cycleState || null) : null,
        currentRpm: isCycle ? (active.currentRpm ?? null) : null,
        riderId: isCycle ? (active.rider?.id || null) : null,
        currentPhaseIndex: isCycle ? (active.currentPhaseIndex ?? null) : null,
        totalPhases: isCycle ? (active.totalPhases ?? null) : null,
        phaseProgressPct: isCycle ? (active.phaseProgressPct ?? null) : null
      };
    }
  }
```

- [ ] **Step 4: Verify `_evaluateCycleChallenge` writes `currentRpm` onto the active challenge**

Open `frontend/src/hooks/fitness/GovernanceEngine.js` and search for `_evaluateCycleChallenge`. The state machine reads RPM from `ctx.equipmentRpm` (or similar). Confirm that on each tick, `active.currentRpm` and `active.phaseProgressPct` are updated on the challenge object before `_updateGlobalState` is called. If they are stored elsewhere (e.g. in a separate snapshot variable), assign them to the `active` object in the same tick:

```javascript
// Inside _evaluateCycleChallenge, after computing rpm and progress:
active.currentRpm = rpm;
active.phaseProgressPct = phaseProgressPct;
```

(This may already exist — verify before adding.)

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm run test:unit -- --testPathPattern=GovernanceEngine-cycleWindowState
```
Expected: PASS — all three cases.

- [ ] **Step 6: Run the broader engine test suite**

```bash
npm run test:unit -- --testPathPattern=GovernanceEngine
```
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        tests/unit/suite/fitness/GovernanceEngine-cycleWindowState.test.mjs
git commit -m "feat(governance): expose cycle-challenge state on window globals

Closes P0-3 from cycling-challenge simulator audit. The sim-panel popout
and overlay diagnostics read cycleState, currentRpm, riderId, etc. from
window.__fitnessGovernance; previously these fields were never set."
```

---

## Task 4: Bridge engine ticks to `sim-state-change` events (P0-4)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (in the tick path that calls `_updateGlobalState`)
- Modify: `frontend/src/context/FitnessContext.jsx:1311-1314` (subscribe controller to engine ticks)
- Test: `tests/unit/suite/fitness/GovernanceEngine-simStateChangeEvent.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/suite/fitness/GovernanceEngine-simStateChangeEvent.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine.onCycleStateChange callback', () => {
  let engine;

  beforeEach(() => {
    engine = new GovernanceEngine({ session: null });
  });

  it('calls onCycleStateChange when cycleState mutates between calls to _updateGlobalState', () => {
    const cb = jest.fn();
    engine.onCycleStateChange = cb;
    engine.challengeState = {
      activeChallenge: { type: 'cycle', cycleState: 'init', equipment: 'cycle_ace', rider: { id: 'felix' } }
    };
    engine._updateGlobalState();
    expect(cb).toHaveBeenCalledTimes(1);

    // Same state — no second callback
    engine._updateGlobalState();
    expect(cb).toHaveBeenCalledTimes(1);

    // State changes — callback fires
    engine.challengeState.activeChallenge.cycleState = 'ramp';
    engine._updateGlobalState();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no callback is registered', () => {
    engine.challengeState = {
      activeChallenge: { type: 'cycle', cycleState: 'init', equipment: 'x', rider: { id: 'a' } }
    };
    expect(() => engine._updateGlobalState()).not.toThrow();
  });

  it('fires when challenge transitions from active to null (clear)', () => {
    const cb = jest.fn();
    engine.onCycleStateChange = cb;
    engine.challengeState = {
      activeChallenge: { type: 'cycle', cycleState: 'maintain', equipment: 'x', rider: { id: 'a' } }
    };
    engine._updateGlobalState();
    expect(cb).toHaveBeenCalledTimes(1);

    engine.challengeState = null;
    engine._updateGlobalState();
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:unit -- --testPathPattern=GovernanceEngine-simStateChangeEvent
```
Expected: FAIL — `cb` was never called.

- [ ] **Step 3: Add change detection to `_updateGlobalState`**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, at the **bottom** of `_updateGlobalState` (after the assignment to `window.__fitnessGovernance`), add:

```javascript
      // Fire change callback if any cycle field changed since last tick
      const cycleSig = [
        active?.type === 'cycle' ? 'cycle' : 'none',
        active?.cycleState || null,
        active?.currentPhaseIndex ?? null,
        active?.rider?.id || null
      ].join('|');
      if (cycleSig !== this._lastCycleSig) {
        this._lastCycleSig = cycleSig;
        if (typeof this.onCycleStateChange === 'function') {
          try { this.onCycleStateChange(); } catch (_) {}
        }
      }
```

Initialize `this._lastCycleSig = null` in the engine constructor (look for the existing constructor's field initializers).

- [ ] **Step 4: Run the unit test to verify it passes**

```bash
npm run test:unit -- --testPathPattern=GovernanceEngine-simStateChangeEvent
```
Expected: PASS — all three cases.

- [ ] **Step 5: Wire FitnessContext to forward the callback to the popout**

In `frontend/src/context/FitnessContext.jsx`, find the effect that creates the `FitnessSession` (or where `fitnessSessionRef.current.governanceEngine` is reachable). After the session is created and the engine is available, add:

```javascript
const engine = fitnessSessionRef.current?.governanceEngine;
if (engine) {
  engine.onCycleStateChange = () => {
    window.dispatchEvent(new CustomEvent('sim-state-change', {
      detail: { source: 'governance.cycle' }
    }));
  };
}
```

If the engine is created lazily and the wiring point is unclear, add a tiny method on `FitnessSession` for clarity:

```javascript
// frontend/src/hooks/fitness/FitnessSession.js — add near other engine accessors
setCycleStateChangeListener(cb) {
  if (this.governanceEngine) {
    this.governanceEngine.onCycleStateChange = cb;
  }
}
```

Then in FitnessContext:

```javascript
fitnessSessionRef.current?.setCycleStateChangeListener?.(() => {
  window.dispatchEvent(new CustomEvent('sim-state-change', {
    detail: { source: 'governance.cycle' }
  }));
});
```

- [ ] **Step 6: Smoke-test in dev**

Start `/fitness`, open the sim popup, then in the popup's console:

```javascript
let count = 0;
window.opener.addEventListener('sim-state-change', () => count++);
// then in the main window:
window.opener.__fitnessSimController.triggerCycleChallenge({ selectionId: 'cycle_sprint' });
```

After triggering, `count` should grow over time as the engine ticks. Without the bridge, it would stay 0 (or only increment on user input).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        frontend/src/hooks/fitness/FitnessSession.js \
        frontend/src/context/FitnessContext.jsx \
        tests/unit/suite/fitness/GovernanceEngine-simStateChangeEvent.test.mjs
git commit -m "feat(governance): notify sim popout on cycle state transitions

Closes P0-4 from cycling-challenge simulator audit. The popout listens
on sim-state-change but it was only fired on user-initiated controller
mutations. Now engine ticks that change cycleState, phase index, or
rider also dispatch the event."
```

---

## Task 5: Surface real failure reason in `triggerCycleChallenge` (P1-2)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (around `_startCycleChallenge` returning null)
- Modify: `frontend/src/modules/Fitness/nav/FitnessSimulationController.js:268-278` (forward the reason verbatim)
- Test: extend `tests/unit/suite/fitness/FitnessSimulationController-cycling.test.mjs` with one new case

- [ ] **Step 1: Inspect `_startCycleChallenge`**

```bash
grep -n "_startCycleChallenge\|failed_to_start" frontend/src/hooks/fitness/GovernanceEngine.js
```
Identify the rejection reasons it can return (e.g. `no_eligible_riders`, `equipment_not_found`, `invalid_phases`).

- [ ] **Step 2: Make `_startCycleChallenge` return `{ ok: false, reason }` instead of `null`**

Locate the failure paths in `_startCycleChallenge` and replace `return null` with `return { ok: false, reason: '<specific>' }`. In `triggerChallenge` (around line 3244), instead of mapping a falsy return to `failed_to_start`, forward the reason:

```javascript
const startResult = this._startCycleChallenge(selection, { forceRiderId: riderId, ... });
if (!startResult || startResult.ok === false) {
  return { success: false, reason: startResult?.reason || 'failed_to_start' };
}
```

- [ ] **Step 3: Add a test case**

In `tests/unit/suite/fitness/GovernanceEngine-cycleTrigger.test.mjs` (or the equivalent file — find with `grep -rln "triggerChallenge.*cycle"`), add:

```javascript
it('returns reason: no_eligible_riders when equipment has no eligible_users', () => {
  // Equipment exists but no users qualify (or roster empty)
  const result = engine.triggerChallenge({ type: 'cycle', selectionId: 'cycle_sprint' });
  expect(result.success).toBe(false);
  expect(result.reason).toBe('no_eligible_riders');
});
```

- [ ] **Step 4: Run tests**

```bash
npm run test:unit -- --testPathPattern=GovernanceEngine-cycleTrigger
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js \
        tests/unit/suite/fitness/GovernanceEngine-cycleTrigger.test.mjs
git commit -m "feat(governance): surface specific rejection reasons from cycle trigger

Replaces the catch-all 'failed_to_start' with concrete reasons
(no_eligible_riders, equipment_not_found, invalid_phases). The sim
popout's alert messaging is now actionable."
```

---

## Task 6: Add cycle helpers to `FitnessSimHelper`

**Files:**
- Modify: `tests/_lib/FitnessSimHelper.mjs` (add cycle methods)

- [ ] **Step 1: Add helper methods**

Append to `tests/_lib/FitnessSimHelper.mjs`:

```javascript
/**
 * Drive an equipment cadence (RPM) via the controller in the page.
 * Equivalent to moving the popup's RPM slider, but scriptable from Playwright.
 */
export async function setRpm(page, equipmentId, rpm) {
  return page.evaluate(({ id, rpm }) => {
    const ctl = window.__fitnessSimController;
    if (!ctl) return { ok: false, error: 'controller_unavailable' };
    return ctl.setRpm(id, rpm);
  }, { id: equipmentId, rpm });
}

/**
 * Trigger a cycle challenge by selection id.
 * Returns { success, reason?, challengeId? }.
 */
export async function triggerCycleChallenge(page, { selectionId, riderId } = {}) {
  return page.evaluate(({ selectionId, riderId }) => {
    const ctl = window.__fitnessSimController;
    if (!ctl) return { success: false, reason: 'controller_unavailable' };
    return ctl.triggerCycleChallenge({ selectionId, riderId });
  }, { selectionId, riderId });
}

/**
 * Read live cycle-challenge state from window.__fitnessGovernance.
 * Returns null if no cycle challenge is active.
 */
export async function readCycleState(page) {
  return page.evaluate(() => {
    const gov = window.__fitnessGovernance;
    if (!gov || gov.activeChallengeType !== 'cycle') return null;
    return {
      cycleState: gov.cycleState,
      currentRpm: gov.currentRpm,
      riderId: gov.riderId,
      currentPhaseIndex: gov.currentPhaseIndex,
      totalPhases: gov.totalPhases,
      phaseProgressPct: gov.phaseProgressPct,
      equipment: gov.activeChallengeEquipment
    };
  });
}

/**
 * Wait until cycleState transitions to one of `targets`, or timeout.
 */
export async function waitForCycleState(page, targets, { timeoutMs = 30000, pollMs = 250 } = {}) {
  const wanted = Array.isArray(targets) ? targets : [targets];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readCycleState(page);
    if (state && wanted.includes(state.cycleState)) return state;
    await page.waitForTimeout(pollMs);
  }
  const finalState = await readCycleState(page);
  throw new Error(`Timed out waiting for cycleState in ${wanted.join(',')}; last seen: ${JSON.stringify(finalState)}`);
}

/**
 * List equipment as the simulator sees it.
 */
export async function getEquipment(page) {
  return page.evaluate(() => {
    const ctl = window.__fitnessSimController;
    return ctl ? ctl.getEquipment() : [];
  });
}

/**
 * List cycle selections from the active policy set.
 */
export async function listCycleSelections(page) {
  return page.evaluate(() => {
    const ctl = window.__fitnessSimController;
    return ctl ? (ctl.listCycleSelections?.() || []) : [];
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/_lib/FitnessSimHelper.mjs
git commit -m "test(fitness): add cycle-challenge helpers to FitnessSimHelper"
```

---

## Task 7 (EXIT CRITERION): Playwright cycle-challenge lifecycle test

**Files:**
- Create: `tests/live/flow/fitness/cycle-challenge-lifecycle.runtime.test.mjs`

This test is the contract. When it passes against a live dev server, the cycle simulator is provably usable end-to-end and the bug is closed.

- [ ] **Step 1: Write the test**

Create `tests/live/flow/fitness/cycle-challenge-lifecycle.runtime.test.mjs`:

```javascript
/**
 * Cycle Challenge Lifecycle — Runtime Test
 *
 * Exit criterion for cycling-challenge simulator audit
 * (docs/_wip/audits/2026-04-30-cycling-challenge-simulator-unusable-audit.md).
 *
 * Walks the full lifecycle:
 *   1. App boots, fitness config loads, equipment catalog includes cycle_ace.
 *   2. Sim controller exposes cycle_ace with eligible riders.
 *   3. HR sliders activate two participants in the active zone.
 *   4. Trigger cycle challenge -> success.
 *   5. Drive RPM through init -> ramp -> maintain.
 *   6. Drop RPM below loRpm -> locked.
 *   7. Recover -> unlock back to maintain.
 *   8. Walk all phases through to status: success.
 *   9. window.__fitnessGovernance is clean afterwards.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import {
  setRpm,
  triggerCycleChallenge,
  readCycleState,
  waitForCycleState,
  getEquipment,
  listCycleSelections
} from '#testlib/FitnessSimHelper.mjs';

const CYCLE_EQUIPMENT_ID = 'cycle_ace';
// Selection id is generated from policy structure — discovered at runtime.

test.describe('Cycle challenge full lifecycle', () => {
  test.setTimeout(120000); // 2 minutes; the lifecycle takes time

  test('boots, opens cycling video, triggers, walks state machine, completes successfully', async ({ page }) => {
    // ---- 1. Boot the fitness app ----
    await page.goto(`${FRONTEND_URL}/fitness?nogovern=0`);
    await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });

    // ---- 2. Catalog populated, cycle_ace present ----
    const equipment = await getEquipment(page);
    const cycleAce = equipment.find(e => e.equipmentId === CYCLE_EQUIPMENT_ID);
    expect(cycleAce, 'cycle_ace should appear in simulator equipment list').toBeTruthy();
    expect(cycleAce.cadenceDeviceId).toBe('49904');
    expect(cycleAce.eligibleUsers.length).toBeGreaterThan(0);

    // ---- 3. Cycle selection visible in policy set ----
    const selections = await listCycleSelections(page);
    const cycleSel = selections.find(s => s.equipment === CYCLE_EQUIPMENT_ID);
    expect(cycleSel, 'at least one cycle selection should target cycle_ace').toBeTruthy();
    const selectionId = cycleSel.id;
    const riderId = cycleAce.eligibleUsers[0];

    // ---- 4. Open a cycling video so governance is engaged ----
    // The cycle state machine ticks while a session is active. Navigate to a
    // cycling-tagged Plex episode via direct-play URL. Discovery: the
    // production fitness.yml has a Plex collection group with `icon: cycle`
    // (data/household/config/fitness.yml around line 204) — the test fixture
    // helper exposes one of its episodes.
    const cyclingEpisodeId = await page.evaluate(async () => {
      const cfg = await fetch('/api/v1/fitness').then(r => r.json());
      const root = cfg?.fitness || cfg || {};
      const navItems = root?.content?.nav_items || root?.plex?.nav_items || [];
      const cycleNav = navItems.find(n =>
        n?.icon === 'cycle' || /cycl/i.test(n?.name || '')
      );
      const collectionId = cycleNav?.target?.collection_id
        || cycleNav?.target?.collection_ids?.[0];
      if (!collectionId) return null;
      const items = await fetch(`/api/v1/content/collection/${collectionId}`)
        .then(r => r.json()).catch(() => null);
      const episode = (items?.items || items?.episodes || items || [])
        .find(e => e?.id || e?.contentId);
      return episode ? String(episode.id || episode.contentId).replace(/^[a-z]+:/i, '') : null;
    });
    expect(cyclingEpisodeId, 'must find at least one cycling episode in config').toBeTruthy();

    await page.goto(`${FRONTEND_URL}/fitness/play/${cyclingEpisodeId}?nogovern=0`);
    await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });
    // Wait for the FitnessPlayer to mount and the video element to attach.
    await page.waitForFunction(
      () => !!document.querySelector('video, dash-video') || !!window.__fitnessVideoElement,
      null,
      { timeout: 30000 }
    );

    // ---- 5. Activate two participants via HR (simulate active users) ----
    await page.evaluate(() => {
      const ctl = window.__fitnessSimController;
      const devices = ctl.getDevices();
      // Set first two devices to active zone HR (130 bpm)
      devices.slice(0, 2).forEach(d => ctl.setHR(d.deviceId, 130));
    });
    // Give the engine a tick to register active participants.
    await page.waitForTimeout(2000);

    // ---- 6. Trigger cycle challenge ----
    const trigger = await triggerCycleChallenge(page, { selectionId, riderId });
    expect(trigger.success, `trigger should succeed; reason=${trigger.reason}`).toBe(true);

    // ---- 7. Verify init state on window globals ----
    let state = await readCycleState(page);
    expect(state, 'window.__fitnessGovernance should expose cycle state').toBeTruthy();
    expect(state.equipment).toBe(CYCLE_EQUIPMENT_ID);
    expect(state.riderId).toBe(riderId);
    expect(['init', 'ramp']).toContain(state.cycleState);

    // ---- 8. Drive RPM into ramp, then maintain ----
    // init -> reach min_rpm (30) to leave init
    await setRpm(page, CYCLE_EQUIPMENT_ID, 35);
    state = await waitForCycleState(page, ['ramp', 'maintain'], { timeoutMs: 15000 });
    expect(state.cycleState).toMatch(/ramp|maintain/);

    // ramp -> hit hi_rpm to enter maintain (hi_rpm_range: [50, 85])
    await setRpm(page, CYCLE_EQUIPMENT_ID, 90);
    state = await waitForCycleState(page, 'maintain', { timeoutMs: 15000 });
    expect(state.cycleState).toBe('maintain');
    expect(state.currentRpm).toBeGreaterThanOrEqual(85);

    // ---- 9. Drop RPM below loRpm -> locked ----
    await setRpm(page, CYCLE_EQUIPMENT_ID, 10); // well below loRpm
    state = await waitForCycleState(page, 'locked', { timeoutMs: 15000 });
    expect(state.cycleState).toBe('locked');

    // ---- 10. Recover -> unlock back to maintain ----
    await setRpm(page, CYCLE_EQUIPMENT_ID, 90);
    state = await waitForCycleState(page, ['ramp', 'maintain'], { timeoutMs: 15000 });
    expect(['ramp', 'maintain']).toContain(state.cycleState);

    // ---- 11. Walk phases through to success ----
    // Hold a high RPM and let phases tick. segment_count is [3,4],
    // segment_duration is [20,40] -- so worst case ~160s; we cap test at 90s here.
    const phaseDeadline = Date.now() + 90000;
    let lastIndex = -1;
    while (Date.now() < phaseDeadline) {
      await setRpm(page, CYCLE_EQUIPMENT_ID, 90);
      state = await readCycleState(page);
      if (!state) break; // challenge cleared (success or failure)
      if (state.currentPhaseIndex !== lastIndex) {
        lastIndex = state.currentPhaseIndex;
        // eslint-disable-next-line no-console
        console.log(`[lifecycle] phase ${lastIndex + 1}/${state.totalPhases} state=${state.cycleState} rpm=${state.currentRpm}`);
      }
      await page.waitForTimeout(1000);
    }

    // ---- 12. Assert final cleanup: cycle state cleared from globals ----
    const finalGov = await page.evaluate(() => ({
      activeChallengeType: window.__fitnessGovernance?.activeChallengeType,
      cycleState: window.__fitnessGovernance?.cycleState,
      currentRpm: window.__fitnessGovernance?.currentRpm
    }));
    expect(finalGov.activeChallengeType, 'cycle challenge should be cleared after lifecycle').toBeNull();
    expect(finalGov.cycleState).toBeNull();
  });

  test('trigger fails with informative reason when no riders are eligible', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness?nogovern=0`);
    await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });

    // Force a non-existent rider so the engine rejects.
    const result = await triggerCycleChallenge(page, {
      selectionId: 'cycle_sprint',
      riderId: '__nonexistent__'
    });
    expect(result.success).toBe(false);
    expect(result.reason).not.toBe('failed_to_start');
    expect(['rider_not_eligible', 'no_eligible_riders', 'selection_not_found']).toContain(result.reason);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npx playwright test tests/live/flow/fitness/cycle-challenge-lifecycle.runtime.test.mjs --reporter=line
```

Expected: **PASS** for both test cases. If they fail, the audit's P0s are not all closed — return to whichever task addresses the failing layer.

- [ ] **Step 3: Commit**

```bash
git add tests/live/flow/fitness/cycle-challenge-lifecycle.runtime.test.mjs
git commit -m "test(fitness): cycle-challenge lifecycle Playwright runtime test

Exit criterion for cycling-challenge simulator audit. Drives the full
init -> ramp -> maintain -> locked -> recover -> success cycle from a
real browser via the simulator popout primitives."
```

---

## Self-Review Checklist (after all tasks committed)

- [ ] Run the full unit suite: `npm run test:unit` — no new failures.
- [ ] Run the lifecycle test: `npx playwright test tests/live/flow/fitness/cycle-challenge-lifecycle.runtime.test.mjs` — PASS.
- [ ] Re-run existing fitness Playwright tests: `npm run test:live:flow -- --grep fitness` — no regressions.
- [ ] Open the sim popup manually in a Chrome browser at `/fitness`, verify:
  - Equipment section shows `CycleAce (cycle_ace / cad:49904)` with eligible riders listed.
  - Cycle Challenge picker shows the `Cycle sprint` selection.
  - Trigger fires; the cycle info detail box renders with rider, state, phase, RPM.
  - RPM slider advances `cycleState` and the on-screen overlay updates in real time.
- [ ] Update `docs/_wip/audits/2026-04-30-cycling-challenge-simulator-unusable-audit.md` with a closing footer:
  ```markdown
  ## Resolution (YYYY-MM-DD)
  Closed by `<commit-hash>` and Playwright test
  `tests/live/flow/fitness/cycle-challenge-lifecycle.runtime.test.mjs`.
  ```

---

## Out of Scope (intentionally deferred)

- Popout layout responsiveness (P1-4) — cosmetic; defer until users complain about the actual UX, not the broken-ness.
- `policies` race window (P2-1) — the manual fix is "click anywhere to re-render," and the lifecycle test covers the warm path.
- Backend cycle governance — there is no backend GovernanceEngine; if/when one is added, that's a separate plan.
