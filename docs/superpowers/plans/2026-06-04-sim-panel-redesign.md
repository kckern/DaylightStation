# Sim Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Fitness Simulation popup (`frontend/public/sim-panel.html`) into a focused tabbed panel with 1-click "Quick Sims", backed by testable scenario logic in `FitnessSimulationController` and a small sim→cycle-game start bridge.

**Architecture:** Push all scenario logic (RPM arcs, auto-assign, ambient workout, stop-all) into `FitnessSimulationController` (a plain JS class → unit-testable). The static panel stays a thin view that calls those methods on `window.opener.__fitnessSimController`. The "Cycle Game Race" preset adds two seams on the opener: a no-reload module launcher (`window.__fitnessLaunchModule`) on `FitnessApp`, and a `window.__cycleGameControl.startRace()` hook on `CycleGameContainer` (built on a pure `buildAutoStartCourse` resolver).

**Tech Stack:** Vanilla JS (static panel), React (FitnessApp / CycleGameContainer), vitest + @testing-library (jsdom). Run one test file: `./node_modules/.bin/vitest run <path>` from `/opt/Code/DaylightStation`.

**Spec:** `docs/superpowers/specs/2026-06-04-sim-panel-redesign-design.md`.
**Branch:** confirm with the user whether to work on `main` (session default) or a feature branch before Task 1.

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `frontend/src/modules/Fitness/lib/cycleGame/autoStartCourse.js` | Pure: map `{winCondition,value}` → a race `course` object | T1 |
| `frontend/src/modules/Fitness/lib/cycleGame/autoStartCourse.test.js` | Tests for the resolver | T1 |
| `frontend/src/modules/Fitness/nav/rpmArc.js` | Pure: `rpmArcValue(tick, opts)` wandering-RPM value | T2 |
| `frontend/src/modules/Fitness/nav/rpmArc.test.js` | Tests for the pure arc value | T2 |
| `frontend/src/modules/Fitness/nav/FitnessSimulationController.js` | Add `driveRpmArc`/`stopRpmArc`/`stopAllRpmArcs`, `autoAssignRiders`, `startAmbientWorkout`, `stopEverything`; cleanup in `destroy()` | T2,T3,T4 |
| `frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js` | Tests for the new controller methods | T2,T3,T4 |
| `frontend/src/Apps/FitnessApp.jsx` | Expose `window.__fitnessLaunchModule` (no-reload module launch) | T5 |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` | `startRace` accepts an override course; register `window.__cycleGameControl` | T6 |
| `frontend/public/sim-panel.html` | Full rewrite — tabbed panel, Quick Sims, lean rows, Advanced tab | T7 |

---

## Task 1: Pure race-course resolver

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/autoStartCourse.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/autoStartCourse.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { buildAutoStartCourse } from './autoStartCourse.js';

describe('buildAutoStartCourse', () => {
  it('builds a time-race course (Flash)', () => {
    expect(buildAutoStartCourse({ winCondition: 'time', value: 60 }))
      .toEqual({ win_condition: 'time', goal_m: null, time_cap_s: 60 });
  });

  it('builds a distance-race course (100 m)', () => {
    expect(buildAutoStartCourse({ winCondition: 'distance', value: 100 }))
      .toEqual({ win_condition: 'distance', goal_m: 100, time_cap_s: null });
  });

  it('defaults to distance when winCondition is unknown', () => {
    expect(buildAutoStartCourse({ winCondition: 'wat', value: 250 }))
      .toEqual({ win_condition: 'distance', goal_m: 250, time_cap_s: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/lib/cycleGame/autoStartCourse.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// frontend/src/modules/Fitness/lib/cycleGame/autoStartCourse.js
/**
 * Map a sim "1-click race" choice to the course shape CycleGameContainer.startRace
 * consumes. `value` is seconds for a time race, metres for a distance race.
 */
export function buildAutoStartCourse({ winCondition, value } = {}) {
  if (winCondition === 'time') {
    return { win_condition: 'time', goal_m: null, time_cap_s: value };
  }
  return { win_condition: 'distance', goal_m: value, time_cap_s: null };
}

export default buildAutoStartCourse;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/lib/cycleGame/autoStartCourse.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/autoStartCourse.js \
        frontend/src/modules/Fitness/lib/cycleGame/autoStartCourse.test.js
git commit -m "feat(sim): pure resolver mapping a 1-click race choice to a course

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: RPM-arc driver (pure value + controller intervals)

**Files:**
- Create: `frontend/src/modules/Fitness/nav/rpmArc.js`
- Test: `frontend/src/modules/Fitness/nav/rpmArc.test.js`
- Modify: `frontend/src/modules/Fitness/nav/FitnessSimulationController.js`
- Test: `frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js`

- [ ] **Step 1: Write the failing test for the pure value**

```javascript
// frontend/src/modules/Fitness/nav/rpmArc.test.js
import { describe, it, expect } from 'vitest';
import { rpmArcValue } from './rpmArc.js';

describe('rpmArcValue', () => {
  it('returns the base at tick 0 (sin 0)', () => {
    expect(rpmArcValue(0, { base: 80, amp: 10, periodS: 20 })).toBe(80);
  });
  it('returns base+amp at a quarter period (sin π/2)', () => {
    expect(rpmArcValue(5, { base: 80, amp: 10, periodS: 20 })).toBe(90);
  });
  it('clamps to the 0..150 range', () => {
    expect(rpmArcValue(5, { base: 145, amp: 50, periodS: 20 })).toBe(150);
    expect(rpmArcValue(15, { base: 5, amp: 50, periodS: 20 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/nav/rpmArc.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure value**

```javascript
// frontend/src/modules/Fitness/nav/rpmArc.js
/**
 * Deterministic wandering-RPM value for a 1 Hz arc driver. tick = seconds since
 * the arc started; rpm = base + amp·sin(2π·tick/periodS), clamped to 0..150.
 */
export function rpmArcValue(tick, { base = 70, amp = 15, periodS = 20 } = {}) {
  const raw = base + amp * Math.sin((2 * Math.PI * tick) / periodS);
  return Math.max(0, Math.min(150, Math.round(raw)));
}

export default rpmArcValue;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/nav/rpmArc.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Write the failing controller test for the interval driver**

Create `frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FitnessSimulationController } from './FitnessSimulationController.js';

function makeController() {
  const wsService = { send: vi.fn() };
  const session = {
    _deviceRouter: {
      getEquipmentCatalog: () => [
        { id: 'cycle_ace', name: 'Ace', cadence: 'cad1', eligible_users: ['user_2', 'user_3'] },
        { id: 'cycle_bee', name: 'Bee', cadence: 'cad2', eligible_users: ['kc'] }
      ]
    },
    getEquipmentRider: () => null,
    setEquipmentRider: vi.fn(),
    deviceManager: { getAllDevices: () => [] }
  };
  const ctrl = new FitnessSimulationController({
    wsService,
    getSession: () => session,
    zoneConfig: { zones: [{ id: 'active', min: 100 }] },
    getUsersConfig: () => ({})
  });
  return { ctrl, wsService, session };
}

describe('FitnessSimulationController — RPM arc driver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('driveRpmArc sends cadence each second and stopRpmArc stops it', () => {
    const { ctrl, wsService } = makeController();
    ctrl.driveRpmArc('cycle_ace', { base: 80, amp: 0, periodS: 10 });
    vi.advanceTimersByTime(1000);
    const sendsAfter1s = wsService.send.mock.calls.length;
    expect(sendsAfter1s).toBeGreaterThan(0);

    ctrl.stopRpmArc('cycle_ace');
    wsService.send.mockClear();
    vi.advanceTimersByTime(3000);
    expect(wsService.send).not.toHaveBeenCalled();
  });

  it('stopAllRpmArcs clears every running arc', () => {
    const { ctrl, wsService } = makeController();
    ctrl.driveRpmArc('cycle_ace', { base: 70 });
    ctrl.driveRpmArc('cycle_bee', { base: 70 });
    ctrl.stopAllRpmArcs();
    wsService.send.mockClear();
    vi.advanceTimersByTime(3000);
    expect(wsService.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js`
Expected: FAIL — `ctrl.driveRpmArc is not a function`.

- [ ] **Step 7: Implement the arc driver on the controller**

At the top of `FitnessSimulationController.js`, add the import:

```javascript
import { rpmArcValue } from './rpmArc.js';
```

In the constructor (after the existing field initializers), add an arc registry:

```javascript
    this._rpmArcs = new Map(); // equipmentId -> { intervalId, tick }
```

Add these methods to the class (place them near `setRpm`/`stopEquipment`):

```javascript
  /**
   * Start a 1 Hz wandering-RPM driver on a bike (re-sends each second so the
   * cadence stays fresh). Idempotent per equipment — restarts if already running.
   */
  driveRpmArc(equipmentId, opts = {}) {
    if (!equipmentId) return { ok: false, error: 'equipmentId required' };
    this.stopRpmArc(equipmentId);
    const arc = { tick: 0, intervalId: null };
    const send = () => {
      this.setRpm(equipmentId, rpmArcValue(arc.tick, opts));
      arc.tick += 1;
    };
    send(); // emit immediately so the bike reads active without a 1s wait
    arc.intervalId = setInterval(send, 1000);
    this._rpmArcs.set(String(equipmentId), arc);
    return { ok: true, equipmentId };
  }

  /** Stop a single bike's RPM arc and let it go stale. */
  stopRpmArc(equipmentId) {
    const arc = this._rpmArcs.get(String(equipmentId));
    if (arc?.intervalId) clearInterval(arc.intervalId);
    this._rpmArcs.delete(String(equipmentId));
    this.stopEquipment(equipmentId);
    return { ok: true, equipmentId };
  }

  /** Stop every running RPM arc. */
  stopAllRpmArcs() {
    for (const id of [...this._rpmArcs.keys()]) this.stopRpmArc(id);
    return { ok: true };
  }
```

In the existing `destroy()` method, add arc cleanup as the first line of the body:

```javascript
    this.stopAllRpmArcs();
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/nav/rpmArc.test.js frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js`
Expected: PASS (3 + 2).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/modules/Fitness/nav/rpmArc.js \
        frontend/src/modules/Fitness/nav/rpmArc.test.js \
        frontend/src/modules/Fitness/nav/FitnessSimulationController.js \
        frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js
git commit -m "feat(sim): wandering-RPM arc driver on the simulation controller

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Auto-assign riders to bikes

**Files:**
- Modify: `frontend/src/modules/Fitness/nav/FitnessSimulationController.js`
- Test: `frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js`

- [ ] **Step 1: Write the failing test**

Append to `FitnessSimulationController.test.js`:

```javascript
describe('FitnessSimulationController — autoAssignRiders', () => {
  it('assigns distinct eligible riders to the first N bikes', () => {
    const { ctrl, session } = makeController();
    const out = ctrl.autoAssignRiders(2);
    expect(out).toEqual([
      { equipmentId: 'cycle_ace', userId: 'user_2' },
      { equipmentId: 'cycle_bee', userId: 'kc' }
    ]);
    expect(session.setEquipmentRider).toHaveBeenCalledWith('cycle_ace', 'user_2');
    expect(session.setEquipmentRider).toHaveBeenCalledWith('cycle_bee', 'kc');
  });

  it('skips a bike when its only eligible rider is already taken', () => {
    const { ctrl, session } = makeController();
    // cycle_bee's only eligible rider is 'kc'; force ace to also take 'kc' by
    // making ace eligible only for kc.
    session._deviceRouter.getEquipmentCatalog = () => ([
      { id: 'cycle_ace', cadence: 'cad1', eligible_users: ['kc'] },
      { id: 'cycle_bee', cadence: 'cad2', eligible_users: ['kc'] }
    ]);
    const out = ctrl.autoAssignRiders(2);
    expect(out).toEqual([{ equipmentId: 'cycle_ace', userId: 'kc' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js`
Expected: FAIL — `ctrl.autoAssignRiders is not a function`.

- [ ] **Step 3: Implement**

Add to the class (near `setEquipmentRider`):

```javascript
  /**
   * Assign distinct eligible riders to the first `count` bikes (the 1-click
   * race setup). Returns the assignments actually made; a bike whose only
   * eligible riders are already taken is skipped.
   */
  autoAssignRiders(count = 2) {
    const bikes = this.getEquipment().slice(0, Math.max(0, count));
    const taken = new Set();
    const assignments = [];
    for (const bike of bikes) {
      const pick = (bike.eligibleUsers || []).find((u) => !taken.has(u));
      if (!pick) continue;
      taken.add(pick);
      this.setEquipmentRider(bike.equipmentId, pick);
      assignments.push({ equipmentId: bike.equipmentId, userId: pick });
    }
    return assignments;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/nav/FitnessSimulationController.js \
        frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js
git commit -m "feat(sim): auto-assign distinct riders to bikes for the race preset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Ambient workout + stop-everything

**Files:**
- Modify: `frontend/src/modules/Fitness/nav/FitnessSimulationController.js`
- Test: `frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js`

- [ ] **Step 1: Write the failing test**

Append to `FitnessSimulationController.test.js`:

```javascript
describe('FitnessSimulationController — ambient + stop', () => {
  it('startAmbientWorkout runs auto-session-all and a bike arc per equipment', () => {
    const { ctrl } = makeController();
    const sess = vi.spyOn(ctrl, 'startAutoSessionAll').mockReturnValue({ ok: true });
    const arc = vi.spyOn(ctrl, 'driveRpmArc').mockReturnValue({ ok: true });
    ctrl.startAmbientWorkout();
    expect(sess).toHaveBeenCalledTimes(1);
    expect(arc).toHaveBeenCalledWith('cycle_ace', expect.any(Object));
    expect(arc).toHaveBeenCalledWith('cycle_bee', expect.any(Object));
  });

  it('stopEverything stops HR, bikes, and all arcs', () => {
    const { ctrl } = makeController();
    const hr = vi.spyOn(ctrl, 'stopAll').mockReturnValue({ ok: true });
    const arcs = vi.spyOn(ctrl, 'stopAllRpmArcs').mockReturnValue({ ok: true });
    const eq = vi.spyOn(ctrl, 'stopEquipment').mockReturnValue({ ok: true });
    ctrl.stopEverything();
    expect(hr).toHaveBeenCalledTimes(1);
    expect(arcs).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('cycle_ace');
    expect(eq).toHaveBeenCalledWith('cycle_bee');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js`
Expected: FAIL — `ctrl.startAmbientWorkout is not a function`.

- [ ] **Step 3: Implement**

Add to the class:

```javascript
  /**
   * "Ambient workout" preset: every HR strap runs an auto-session arc and every
   * bike spins on a gently varying RPM arc. No game, no navigation.
   */
  startAmbientWorkout() {
    this.startAutoSessionAll();
    this.getEquipment().forEach((bike, i) => {
      this.driveRpmArc(bike.equipmentId, { base: 68 + i * 4, amp: 14, periodS: 22 });
    });
    return { ok: true };
  }

  /** "Stop All" preset: halt HR straps, bike arcs, and any lingering cadence. */
  stopEverything() {
    this.stopAll();
    this.stopAllRpmArcs();
    this.getEquipment().forEach((bike) => this.stopEquipment(bike.equipmentId));
    return { ok: true };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/nav/FitnessSimulationController.js \
        frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js
git commit -m "feat(sim): ambient-workout and stop-everything presets on the controller

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: FitnessApp no-reload module-launch seam

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx`

This is a UI seam on a large component that jsdom can't meaningfully unit-test; verify by running the app (Step 3).

- [ ] **Step 1: Add the launch seam**

In `FitnessApp.jsx`, find the existing effect that exposes a global queue setter (the `useEffect` that sets `window.addToFitnessQueue`, around line 644). Immediately **after** that effect, add a new effect that mirrors `handleNavigate`'s `module` case so the popup can open a module without reloading the page:

```javascript
  // Sim-panel seam: let the simulation popup open a module (e.g. the cycle game)
  // via SPA navigation — NO page reload, so window.__fitnessSimController and the
  // popup's reference to it survive.
  useEffect(() => {
    window.__fitnessLaunchModule = (moduleId) => {
      if (!moduleId) return;
      setActiveModule({ id: moduleId });
      setActiveCollection(null);
      setSelectedShow(null);
      setCurrentView('module');
      navigate(`/fitness/module/${moduleId}`, { replace: true });
    };
    return () => {
      if (window.__fitnessLaunchModule) delete window.__fitnessLaunchModule;
    };
  }, [navigate]);
```

(`setActiveModule`, `setActiveCollection`, `setSelectedShow`, `setCurrentView`, and `navigate` are all already in scope in this component.)

- [ ] **Step 2: Build to confirm it compiles**

Run: `cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3`
Expected: build succeeds.

- [ ] **Step 3: Manual verify (run the app)**

On localhost/Chrome dev, open the fitness app, then in the browser console run `window.__fitnessLaunchModule('cycle_game')`. Expected: the app navigates to the cycle game module **without a full page reload** (URL becomes `/fitness/module/cycle_game`, and `window.__fitnessSimController` is still defined afterward).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "feat(sim): expose a no-reload module-launch seam for the sim popup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: CycleGameContainer start hook (override course + window control)

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx`

Verify by running the app (jsdom can't exercise the full container); the pure mapping it relies on (`buildAutoStartCourse`) is already unit-tested in Task 1.

- [ ] **Step 1: Make `startRace` accept an override course**

In `CycleGameContainer.jsx`, change the `startRace` callback signature and its type/goal/timeCap derivation. The current code (around line 569-583) is:

```javascript
  const startRace = useCallback(() => {
    log.info('cycle_game.start_pressed', {
      raceType: ghost ? 'ghost' : raceType, hasGhost: !!ghost, control: 'lobby.start-button'
    });
    const type = ghost ? ghost.winCondition : (raceType || 'distance');
    const goalM = type === 'distance'
      ? (ghost ? ghost.goalM : (Number.isFinite(raceValueM) ? raceValueM : distanceDefaultM))
      : null;
    const timeCapS = type === 'time'
      ? (ghost ? ghost.timeCapS : (Number.isFinite(raceValueS) ? raceValueS : timeDefaultS))
      : null;
```

Replace it with (adds an optional `override` arg that wins over ghost/state):

```javascript
  const startRace = useCallback((override = null) => {
    const ov = override && override.win_condition ? override : null;
    log.info('cycle_game.start_pressed', {
      raceType: ov ? ov.win_condition : (ghost ? 'ghost' : raceType),
      hasGhost: !!ghost,
      control: ov ? 'sim.autostart' : 'lobby.start-button'
    });
    const type = ov ? ov.win_condition : (ghost ? ghost.winCondition : (raceType || 'distance'));
    const goalM = type === 'distance'
      ? (ov ? ov.goal_m : (ghost ? ghost.goalM : (Number.isFinite(raceValueM) ? raceValueM : distanceDefaultM)))
      : null;
    const timeCapS = type === 'time'
      ? (ov ? ov.time_cap_s : (ghost ? ghost.timeCapS : (Number.isFinite(raceValueS) ? raceValueS : timeDefaultS)))
      : null;
```

Leave the rest of `startRace` unchanged (it already builds `course` from `type`/`goalM`/`timeCapS`). **Important:** React may pass a synthetic event when `startRace` is used directly as an `onClick`/`onStart` handler — the `override && override.win_condition` guard makes a stray event argument harmless (an event has no `win_condition`, so `ov` stays null and lobby behavior is unchanged).

- [ ] **Step 2: Register the `window.__cycleGameControl` hook**

Add the import near the other `lib/cycleGame` imports at the top of the file:

```javascript
import { buildAutoStartCourse } from '@/modules/Fitness/lib/cycleGame/autoStartCourse.js';
```

Add a `ref` that always points at the latest `startRace` (so the hook never goes stale and we register once). Place this **after** the `startRace` `useCallback`:

```javascript
  // Keep a stable ref to the latest startRace so the sim control hook (registered
  // once) always calls the current closure.
  const startRaceRef = useRef(startRace);
  useEffect(() => { startRaceRef.current = startRace; }, [startRace]);

  // Sim-panel seam: expose a programmatic race start so the simulation popup's
  // "Cycle Game Race" preset can launch a real race. Riders are assigned
  // separately (the sim sets equipment riders, which buildRiders reads).
  useEffect(() => {
    window.__cycleGameControl = {
      ready: true,
      startRace: ({ winCondition, value } = {}) =>
        startRaceRef.current(buildAutoStartCourse({ winCondition, value }))
    };
    return () => {
      if (window.__cycleGameControl) delete window.__cycleGameControl;
    };
  }, []);
```

(`useRef` and `useEffect` are already imported in this file; confirm — if `useRef` is missing from the React import, add it.)

- [ ] **Step 3: Build to confirm it compiles**

Run: `cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3`
Expected: build succeeds.

- [ ] **Step 4: Run the existing cycle-game suite (no regression)**

Run: `cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run frontend/src/modules/Fitness/widgets/CycleGame/ frontend/src/modules/Fitness/lib/cycleGame/`
Expected: PASS (the lobby `onStart={startRace}` path still works because a stray event arg is ignored).

- [ ] **Step 5: Manual verify (run the app)**

Open the cycle game module on localhost/Chrome. In the console: assign two riders (`window.__fitnessSimController.autoAssignRiders(2)`), then `window.__cycleGameControl.startRace({ winCondition: 'time', value: 60 })`. Expected: the race stages → counts down → runs as a 60 s time race. Repeat with `{ winCondition: 'distance', value: 100 }` → a 100 m race.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
git commit -m "feat(sim): programmatic cycle-game start hook (window.__cycleGameControl)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Rewrite the sim panel

**Files:**
- Modify (full rewrite): `frontend/public/sim-panel.html`

The panel is static HTML/JS (no build, no imports) served from `public/` and opened by `HRSimTrigger`. It is not unit-tested; verify manually (Step 3). It calls the now-tested controller methods + the two seams.

- [ ] **Step 1: Replace the file with the new tabbed panel**

Write `frontend/public/sim-panel.html` with the structure below. Reuse the existing file's `<style>` block as a starting point (dark theme, sliders, zone/RPM chips) and add `.tabs`/`.tab`/`.quick` classes. The **JavaScript must contain exactly these functions** (full implementations shown):

```html
<script>
  let controller = null;
  let activeTab = 'riders';          // persists across re-renders
  const sliderValues = {};
  let activeSlider = null;
  const rpmSliderValues = {};
  let activeRpmSlider = null;

  function init() {
    if (!window.opener) { showError('Open this panel from the Fitness app'); return; }
    controller = window.opener.__fitnessSimController;
    if (!controller) { showError('Simulation not available — reload the Fitness app'); return; }
    window.opener.addEventListener('sim-state-change', render);
    render();
  }
  function showError(msg) { document.getElementById('content').innerHTML = `<div class="error">${msg}</div>`; }
  function escapeHtml(s){ return s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function zoneColor(z){ return ({cool:'#2563eb',active:'#059669',warm:'#d97706',hot:'#dc2626',fire:'#7c2d12'})[z]||'#888'; }

  // ----- Quick Sims -----
  function cycleRaceWin(win){ window.__cgWin = win; document.querySelectorAll('.cg-win').forEach(b=>b.classList.toggle('selected', b.dataset.win===win)); }
  async function runCycleGameRace() {
    const win = window.__cgWin || 'time';
    const value = win === 'time' ? 60 : 100;
    const opener = window.opener;
    const assigns = controller.autoAssignRiders(2);
    if (assigns.length === 0) { alert('No bikes available to race.'); return; }
    if (typeof opener.__fitnessLaunchModule !== 'function') { alert('Launch seam missing — reload the Fitness app.'); return; }
    opener.__fitnessLaunchModule('cycle_game');
    const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
    const deadline = Date.now() + 5000;
    while (!(opener.__cycleGameControl && opener.__cycleGameControl.ready)) {
      if (Date.now() > deadline) { alert("Cycle game didn't start (control hook never appeared)."); return; }
      await sleep(200);
    }
    opener.__cycleGameControl.startRace({ winCondition: win, value });
    assigns.forEach((a, i) => controller.driveRpmArc(a.equipmentId, { base: 80 + i*5, amp: 12, periodS: 18 }));
  }
  function runAmbient(){ controller.startAmbientWorkout(); render(); }
  function stopAll(){ controller.stopEverything(); render(); }

  // ----- Tabs -----
  function setTab(t){ activeTab = t; render(); }

  // ----- Per-device control handlers (reused from the old panel) -----
  function onHrInput(id,v){ const hr=parseInt(v,10); sliderValues[id]=hr; const l=document.getElementById('hr-'+id); if(l){l.textContent=hr+' bpm'; l.style.color=zoneColor(controller._hrToZone(hr));} controller.setHR(id,hr); }
  function onHrChange(id,v){ sliderValues[id]=parseInt(v,10); activeSlider=null; controller.setHR(id,parseInt(v,10)); }
  function setZone(id,z){ controller.setZone(id,z); }
  function startSession(id){ controller.startAutoSession(id); }
  function stopDevice(id){ controller.stopDevice(id); }
  function onRpmInput(id,v){ const r=parseInt(v,10); rpmSliderValues[id]=r; const l=document.getElementById('rpm-'+id); if(l)l.textContent=r+' rpm'; controller.setRpm(id,r); }
  function onRpmChange(id,v){ rpmSliderValues[id]=parseInt(v,10); activeRpmSlider=null; controller.setRpm(id,parseInt(v,10)); }
  function setRpmQuick(id,r){ controller.setRpm(id,r); const s=document.getElementById('rpms-'+id); if(s)s.value=r; const l=document.getElementById('rpm-'+id); if(l)l.textContent=r+' rpm'; rpmSliderValues[id]=r; }
  function stopEquipment(id){ controller.stopRpmArc(id); render(); }
  function setRider(id,u){ if(u) controller.setEquipmentRider(id,u); render(); }

  // ----- Advanced: governance + cycle challenge (ported verbatim from old panel) -----
  function toggleGovernance(){ const s=controller.getGovernanceState(); s.phase?controller.disableGovernance():controller.enableGovernance(); render(); }
  function triggerChallenge(){ controller.triggerChallenge({ targetZone:'hot' }); render(); }
  function triggerCycleChallenge(){ const sel=document.getElementById('cyc-sel')?.value; const rider=document.getElementById('cyc-rider')?.value; if(!sel){alert('Pick a cycle selection');return;} const r=controller.triggerCycleChallenge({selectionId:sel, riderId:rider||undefined}); if(!r?.success) alert('Trigger failed: '+(r?.reason||'unknown')); render(); }
  function swapCycleRider(){ const rider=document.getElementById('cyc-rider')?.value; if(!rider){alert('Pick a rider');return;} const r=controller.swapCycleRider(rider,{force:true}); if(!r?.success) alert('Swap failed: '+(r?.reason||'unknown')); render(); }
  // runCycleDemo(): copy the existing implementation from the old sim-panel.html verbatim.

  function render() {
    if (!controller) return;
    const devices = controller.getDevices();
    const equipment = controller.getEquipment?.() || [];
    const gov = controller.getGovernanceState();
    const win = window.__cgWin || 'time';

    let html = '';
    // Quick Sims
    html += `<div class="section"><div class="section-title">Quick Sims</div>
      <div class="quick">
        <button class="quick-btn" onclick="runCycleGameRace()">🚴 Cycle Game Race</button>
        <span class="cg-toggle">
          <button class="cg-win${win==='time'?' selected':''}" data-win="time" onclick="cycleRaceWin('time')">Flash</button>
          <button class="cg-win${win==='distance'?' selected':''}" data-win="distance" onclick="cycleRaceWin('distance')">100 m</button>
        </span>
        <button class="quick-btn" onclick="runAmbient()">❤️ Ambient Workout</button>
        <button class="quick-btn danger" onclick="stopAll()">⏹ Stop All</button>
      </div></div>`;

    // Tab strip
    html += `<div class="tabs">
      ${['riders','bikes','advanced'].map(t=>`<button class="tab${activeTab===t?' active':''}" onclick="setTab('${t}')">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}
    </div>`;

    if (activeTab === 'riders') {
      html += `<div class="section">`;
      for (const d of devices) {
        const hr = (activeSlider===d.deviceId ? (sliderValues[d.deviceId]||d.currentHR||80) : (d.currentHR||sliderValues[d.deviceId]||80));
        sliderValues[d.deviceId]=hr; const zc=zoneColor(d.currentZone);
        html += `<div class="device">
          <div class="device-header"><span>${escapeHtml(d.name)}</span><span class="device-hr ${d.isActive?'':'inactive'}">${d.currentHR?d.currentHR+' bpm':'-- bpm'}</span></div>
          <div class="hr-slider-row">
            <input type="range" class="hr-slider" min="40" max="220" value="${hr}" style="accent-color:${zc}"
                   oninput="onHrInput('${d.deviceId}',this.value)" onchange="onHrChange('${d.deviceId}',this.value)"
                   onmousedown="activeSlider='${d.deviceId}'" onmouseup="activeSlider=null" ontouchstart="activeSlider='${d.deviceId}'" ontouchend="activeSlider=null">
            <span class="hr-value" id="hr-${d.deviceId}" style="color:${zc}">${hr} bpm</span>
          </div>
          <div class="zone-buttons">${['cool','active','warm','hot','fire'].map(z=>`<button class="zone-btn ${z}${d.currentZone===z?' selected':''}" onclick="setZone('${d.deviceId}','${z}')">${z}</button>`).join('')}</div>
          <div class="auto-buttons"><button onclick="startSession('${d.deviceId}')">▶ session</button><button class="danger" onclick="stopDevice('${d.deviceId}')">✕</button></div>
        </div>`;
      }
      html += `</div>`;
    } else if (activeTab === 'bikes') {
      html += `<div class="section">`;
      if (equipment.length===0) html += `<div style="color:#666;font-size:11px;padding:8px">No cycle-capable equipment.</div>`;
      for (const e of equipment) {
        const rpm = (activeRpmSlider===e.equipmentId ? (rpmSliderValues[e.equipmentId]??e.currentRpm??0) : (e.currentRpm??rpmSliderValues[e.equipmentId]??0));
        rpmSliderValues[e.equipmentId]=rpm;
        html += `<div class="equipment-tile">
          <div class="equipment-header"><span>${escapeHtml(e.name)}</span><span class="equipment-rpm ${e.isActive?'':'inactive'}">${e.currentRpm!=null?e.currentRpm+' rpm':'-- rpm'}</span></div>
          <div class="rpm-slider-row">
            <input type="range" class="rpm-slider" id="rpms-${e.equipmentId}" min="0" max="150" value="${rpm}"
                   oninput="onRpmInput('${e.equipmentId}',this.value)" onchange="onRpmChange('${e.equipmentId}',this.value)"
                   onmousedown="activeRpmSlider='${e.equipmentId}'" onmouseup="activeRpmSlider=null" ontouchstart="activeRpmSlider='${e.equipmentId}'" ontouchend="activeRpmSlider=null">
            <span class="rpm-value" id="rpm-${e.equipmentId}">${rpm} rpm</span>
          </div>
          <div class="rpm-quick-row">${[0,40,60,80,100].map(v=>`<button class="rpm-quick-btn" onclick="setRpmQuick('${e.equipmentId}',${v})">${v}</button>`).join('')}<button class="rpm-quick-btn danger" onclick="stopEquipment('${e.equipmentId}')">✕</button></div>
          <div class="rider-row"><span style="font-size:10px;color:#666">rider:</span>
            <select onchange="setRider('${e.equipmentId}',this.value)"><option value="">— none —</option>${(e.eligibleUsers||[]).map(u=>`<option value="${escapeHtml(u)}"${e.rider===u?' selected':''}>${escapeHtml(u)}</option>`).join('')}</select>
          </div>
        </div>`;
      }
      html += `</div>`;
    } else {
      // advanced
      html += `<div class="section"><div class="section-title">Governance</div>
        <div class="gov-status"><span>Phase: ${gov.phase||'none'}</span></div>
        <div class="btn-row"><button onclick="toggleGovernance()">${gov.phase?'Disable Gov':'Enable Gov'}</button><button onclick="triggerChallenge()" ${!gov.phase?'disabled':''}>Trigger HR Challenge</button></div></div>`;
      html += `<div class="section"><div class="section-title">Cycle Challenge</div>
        <div class="cycle-ctrl"><select id="cyc-sel" onchange="updateRiderPicker()"></select><select id="cyc-rider"></select>
          <div class="btn-row"><button onclick="triggerCycleChallenge()">Trigger Cycle</button><button onclick="swapCycleRider()">Swap Rider</button></div>
          <div class="btn-row"><button id="cycle-demo-btn" onclick="runCycleDemo()" style="flex:1">▶ Run Cycle Demo (~3 min)</button></div>
          <div id="cycle-demo-status" style="font-size:11px;color:#bbb;min-height:14px"></div></div></div>`;
    }

    document.getElementById('content').innerHTML = html;
    if (activeTab === 'advanced') updateCycleSelectionPicker();
  }

  // updateCycleSelectionPicker() and updateRiderPicker(): copy verbatim from the old
  // sim-panel.html (they read controller.listCycleSelections()/getEquipment()).

  init();
</script>
```

Carry over from the old file **verbatim**: the `runCycleDemo()` function, `updateCycleSelectionPicker()`, `updateRiderPicker()`, and `readCycleChallengeInfo()` (if you keep the live cycle readout in Advanced). Keep the old `<head>`/`<style>` and the `<body>` shell (`<h1>Fitness Simulation Panel <button onclick="window.close()">X</button></h1><div id="content">Loading…</div>`); add CSS for `.tabs/.tab/.tab.active`, `.quick/.quick-btn`, `.cg-toggle/.cg-win`.

- [ ] **Step 2: Build to confirm assets copy**

Run: `cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3`
Expected: build succeeds (static `public/` files are copied to `dist/`).

- [ ] **Step 3: Manual verify (the whole feature)**

On localhost/Chrome: open the fitness app, click the ⚙ gear (bottom-left) to open the panel. Verify:
1. **Riders / Bikes / Advanced** tabs switch; the active tab survives a `sim-state-change` re-render.
2. **Riders tab** rows: slider sets bpm (thumb zone-tinted), zone chips jump zones, ▶ session starts an arc, ✕ stops.
3. **Bikes tab** rows: slider + RPM presets set cadence, rider dropdown assigns, ✕ stops.
4. **❤️ Ambient Workout** → HR straps drift and bikes spin; **⏹ Stop All** halts everything (no lingering cadence after ~6 s).
5. **🚴 Cycle Game Race**: pick **Flash** → click → app opens the cycle game, two riders auto-assigned, a 60 s time race starts and runs to the finish on its own. Pick **100 m** → a 100 m distance race runs.
6. **Advanced**: Enable/Disable Gov, Trigger HR Challenge, cycle-challenge Trigger/Swap, and **Run Cycle Demo** behave as before.

- [ ] **Step 4: Commit**

```bash
git add frontend/public/sim-panel.html
git commit -m "feat(sim): reimagined tabbed sim panel with 1-click Quick Sims

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run all new/affected unit suites**

```bash
cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run \
  frontend/src/modules/Fitness/lib/cycleGame/ \
  frontend/src/modules/Fitness/nav/rpmArc.test.js \
  frontend/src/modules/Fitness/nav/FitnessSimulationController.test.js \
  frontend/src/modules/Fitness/widgets/CycleGame/
```
Expected: all PASS.

- [ ] **Build**

```bash
cd /opt/Code/DaylightStation/frontend && npx vite build 2>&1 | tail -3
```
Expected: succeeds.

- [ ] **Full manual pass** of Task 7 Step 3 on the deployed/dev app, then deploy per `CLAUDE.local.md` if desired.

---

## Notes / risks

- **Stale-closure guard (T6):** `startRace`'s `override && override.win_condition` check is load-bearing — it lets the same function serve both the lobby button (no arg / event arg) and the sim hook (course arg). The Task 6 Step 4 suite confirms the lobby path is unbroken.
- **No reload (T5):** the launch seam must use SPA `navigate`, never `location.assign`/reload — a reload destroys `__fitnessSimController` and the popup's live reference, breaking the RPM drivers mid-race.
- **Arc cleanup (T2):** every RPM arc is an interval; `stopRpmArc`/`stopAllRpmArcs`/`destroy()` must clear them or cadence keeps injecting after the user moves on. Stop All and starting a new preset both call `stopEverything`/`stopAllRpmArcs`.
- **Gating unchanged:** `HRSimTrigger` still only renders on localhost/Chrome; the panel is a dev tool.
