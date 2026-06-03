# CycleGame Race Director & Layout Manager — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development for same-session) to implement this plan task-by-task. Each task follows @superpowers:test-driven-development.

**Goal:** Replace the cycle-game race screen's hardcoded layout with a pure-function **race director** that adaptively places panels into zones based on field size, race phase, and dramatic events — plus a new lap model and three new panels (lap table, oval track, camera zoom).

**Architecture:** A one-way pipeline of pure functions sits between the existing `CycleRaceEngine` and the screen: `getState()` → `deriveRaceSnapshot()` → `raceDirector()` → `<RaceLayoutManager>` renders the returned zone→panel mapping. The director threads its timing state through `prevDecision` (no internal timers), exactly like the existing sticky `logRef` in `CycleRaceScreen`. Laps are a config-gated overlay (`lapLengthM`), not a new win-condition.

**Tech Stack:** React (.jsx), vitest + @testing-library/react (jsdom), SCSS with the `_cgTokens.scss` synthwave token system. Pure logic in `frontend/src/modules/Fitness/lib/cycleGame/`.

**Design doc:** `docs/plans/2026-06-03-cycle-game-race-director-design.md` (all 7 sections validated).

**Test command (vitest is NOT in `node_modules/.bin`):**
```bash
npx --no-install vitest run --config vitest.config.mjs <path-to-test>
```
Test idiom: `import { describe, it, expect } from 'vitest';` with relative imports (`./module.js`). Component tests add `import { render, screen } from '@testing-library/react';`.

**Commit footer (every commit):**
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

> **Note on commits:** CLAUDE.md says do not auto-commit without review. If executing via subagent-driven-development, confirm per-task commit authorization with KC first (as in the prior synthwave run).

---

## PHASE A — Lap foundation (no UI change)

### Task 1: `lapModel.js` — lap count & progress

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/lapModel.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/lapModel.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { lapCount, lapProgress } from './lapModel.js';

describe('lapCount', () => {
  it('counts completed full laps', () => {
    expect(lapCount(0, 100)).toBe(0);
    expect(lapCount(99, 100)).toBe(0);
    expect(lapCount(100, 100)).toBe(1);
    expect(lapCount(250, 100)).toBe(2);
  });
  it('returns 0 when laps are disabled (lapLengthM falsy)', () => {
    expect(lapCount(500, 0)).toBe(0);
    expect(lapCount(500, null)).toBe(0);
  });
});

describe('lapProgress', () => {
  it('returns the 0..1 fraction into the current lap', () => {
    expect(lapProgress(0, 100)).toBe(0);
    expect(lapProgress(50, 100)).toBeCloseTo(0.5, 5);
    expect(lapProgress(100, 100)).toBe(0); // exactly on the line = start of next
    expect(lapProgress(150, 100)).toBeCloseTo(0.5, 5);
  });
  it('returns 0 when laps are disabled', () => {
    expect(lapProgress(50, 0)).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx --no-install vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/lapModel.test.js`
Expected: FAIL — "Failed to resolve import './lapModel.js'".

**Step 3: Write minimal implementation**

```javascript
/**
 * Lap math for the cycle game. Laps are a config-gated overlay on top of the
 * existing distance model: lapLengthM = meters per lap (e.g. 100 or 400). A
 * falsy lapLengthM means laps are disabled — every function returns 0.
 */

/** Completed full laps. @returns {number} */
export function lapCount(distanceM, lapLengthM) {
  if (!lapLengthM || lapLengthM <= 0) return 0;
  return Math.floor((Number(distanceM) || 0) / lapLengthM);
}

/** Fraction (0..1) into the current lap. @returns {number} */
export function lapProgress(distanceM, lapLengthM) {
  if (!lapLengthM || lapLengthM <= 0) return 0;
  const d = Number(distanceM) || 0;
  return (d % lapLengthM) / lapLengthM;
}
```

**Step 4: Run test to verify it passes**

Run: same command as Step 2. Expected: PASS (2 files? no — 1 file, 4 tests pass).

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/lapModel.js frontend/src/modules/Fitness/lib/cycleGame/lapModel.test.js
git commit -m "feat(cycle-game): lap model — count & progress (config-gated)"
```

---

### Task 2: Engine captures lap splits

The engine is the only layer that sees every tick, so it must capture lap-crossing **times** (interpolated), beside the existing `finishTimeS` detection.

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`

**Step 1: Write the failing test** (append to the existing test file's describe block)

```javascript
import { describe, it, expect } from 'vitest';
import CycleRaceEngine from './CycleRaceEngine.js';

describe('CycleRaceEngine lap splits', () => {
  it('records interpolated lap-crossing times when lapLengthM is set', () => {
    // 1 rider, wheel 1m/rotation, hrless mult 1, 1s ticks, lap = 100m.
    // 6000 rpm = 100 rotations/sec = 100 m/s → crosses 100m at exactly t=1s.
    const eng = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 10, intervalMs: 1000, lapLengthM: 100,
      hrlessMultiplier: 1,
      riders: [{ userId: 'a', wheelCircumferenceM: 1 }]
    });
    eng.tick({ a: { rpm: 6000 } }); // +100m → 1 lap at t=1
    eng.tick({ a: { rpm: 6000 } }); // +100m → 2 laps at t=2
    const st = eng.getState();
    expect(st.riders.a.lapSplits.length).toBe(2);
    expect(st.riders.a.lapSplits[0]).toBeCloseTo(1, 2);
    expect(st.riders.a.lapSplits[1]).toBeCloseTo(2, 2);
  });

  it('interpolates a mid-tick crossing', () => {
    // 3000 rpm = 50 m/s. After 1 tick = 50m (no lap). After 2 ticks = 100m → lap
    // crossing exactly at t=2. After a faster tick we cross mid-interval.
    const eng = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 10, intervalMs: 1000, lapLengthM: 100,
      hrlessMultiplier: 1, riders: [{ userId: 'a', wheelCircumferenceM: 1 }]
    });
    eng.tick({ a: { rpm: 3000 } }); // 50m, t=1
    eng.tick({ a: { rpm: 6000 } }); // +100m → 150m at t=2; crosses 100m mid-tick
    const st = eng.getState();
    // d0=50, d1=150 over [t=1,t=2]; boundary 100 at frac 0.5 → t≈1.5
    expect(st.riders.a.lapSplits[0]).toBeCloseTo(1.5, 2);
  });

  it('records nothing when laps are disabled (no lapLengthM)', () => {
    const eng = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 10, intervalMs: 1000,
      hrlessMultiplier: 1, riders: [{ userId: 'a', wheelCircumferenceM: 1 }]
    });
    eng.tick({ a: { rpm: 6000 } });
    expect(eng.getState().riders.a.lapSplits).toEqual([]);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx --no-install vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`
Expected: FAIL — `lapSplits` is undefined.

**Step 3: Implement**

3a. Constructor — accept `lapLengthM` (default 0) and init per-rider `lapSplits`:

In the destructured options (top of constructor), add `lapLengthM = 0`:
```javascript
    mode = 'simultaneous', winCondition = 'distance',
    goalM = 3000, timeCapS = 300, intervalMs = 5000,
    riders = [], zones = [], hrlessMultiplier = 1, lapLengthM = 0
```
After `this.hrlessMultiplier = hrlessMultiplier;` add:
```javascript
    this.lapLengthM = Number.isFinite(lapLengthM) && lapLengthM > 0 ? lapLengthM : 0;
```
In the `this.riders.set(...)` object literal, add beside `distanceSeries: []`:
```javascript
        lapSplits: [],
```

3b. In `tick()`, capture the pre-update distance and detect crossings. At the very top of the `for (const rider of this.riders.values())` body, before the `alreadyFinished` branch:
```javascript
      const lapD0 = rider.cumulativeDistanceM; // distance at start of this tick
```
Immediately AFTER the finish-detection `if` block (after the line that clamps `rider.cumulativeDistanceM = this.goalM;`), and BEFORE `rider.distanceSeries.push(...)`, add:
```javascript
      if (this.lapLengthM > 0) {
        const d1 = rider.cumulativeDistanceM;
        const t0 = this.elapsedS - this.intervalSeconds;
        let lap = Math.floor(lapD0 / this.lapLengthM) + 1;
        while (lap * this.lapLengthM <= d1) {
          const boundary = lap * this.lapLengthM;
          const frac = d1 > lapD0 ? (boundary - lapD0) / (d1 - lapD0) : 0;
          rider.lapSplits.push(Math.round((t0 + frac * this.intervalSeconds) * 100) / 100);
          lap += 1;
        }
      }
```

3c. In `getState()`, add to the per-rider mapped object (beside `distanceSeries: r.distanceSeries.slice()`):
```javascript
        lapSplits: r.lapSplits.slice(),
```

**Step 4: Run to verify it passes**

Run: same as Step 2. Expected: PASS (all existing engine tests + 3 new).

**Step 5: Wire `lapLengthM` from config into engine construction**

- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` — find where `new CycleRaceEngine({...})` is constructed (search `new CycleRaceEngine`). Add `lapLengthM: Number.isFinite(cycleGameConfig?.lap_length_m) ? cycleGameConfig.lap_length_m : 0,` to the options. (No test — config plumbing; verified by the smoke run later.)

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
git commit -m "feat(cycle-game): engine captures interpolated lap splits (config-gated)"
```

---

## PHASE B — Director core (pure, fully tested, not yet wired)

### Task 3: `deriveRaceSnapshot.js` — the director's eyes

Turns an engine `getState()` into semantic signals. Pure; `prevSnapshot` enables edge detection + phase hysteresis.

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/deriveRaceSnapshot.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/deriveRaceSnapshot.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { deriveRaceSnapshot } from './deriveRaceSnapshot.js';

const rider = (over = {}) => ({
  cumulativeDistanceM: 0, lapSplits: [], isGhost: false, finishTimeS: null, ...over
});
const state = (riders, over = {}) => ({
  elapsedS: 10, winCondition: 'distance', goalM: 1000, timeCapS: 300,
  finished: false, riders, ...over
});

describe('deriveRaceSnapshot composition', () => {
  it('counts ghosts toward fieldSize; solo means one entity total', () => {
    const human = deriveRaceSnapshot(state({ a: rider() }), { lapLengthM: 0 }, null);
    expect(human.fieldSize).toBe(1);
    expect(human.isSolo).toBe(true);

    const withGhost = deriveRaceSnapshot(
      state({ a: rider(), g: rider({ isGhost: true }) }), { lapLengthM: 0 }, null);
    expect(withGhost.fieldSize).toBe(2);
    expect(withGhost.isSolo).toBe(false);
    expect(withGhost.ghostCount).toBe(1);
    expect(withGhost.humanCount).toBe(1);
  });

  it('lapsEnabled tracks config', () => {
    expect(deriveRaceSnapshot(state({ a: rider() }), { lapLengthM: 100 }, null).lapsEnabled).toBe(true);
    expect(deriveRaceSnapshot(state({ a: rider() }), { lapLengthM: 0 }, null).lapsEnabled).toBe(false);
  });
});

describe('deriveRaceSnapshot phase', () => {
  it('progresses PRE → EARLY → MID → FINALE → FINISHED with hysteresis', () => {
    const cfg = { lapLengthM: 0 };
    const at = (distM, prev, over = {}) =>
      deriveRaceSnapshot(state({ a: rider({ cumulativeDistanceM: distM }) }, over), cfg, prev);

    const pre = at(0, null, { elapsedS: 0 });
    expect(pre.phase).toBe('PRE');
    const early = at(50, pre); // 5% of 1000
    expect(early.phase).toBe('EARLY');
    const mid = at(500, early);
    expect(mid.phase).toBe('MID');
    const finale = at(900, mid); // 90%
    expect(finale.phase).toBe('FINALE');
    // hysteresis: dropping to 86% stays FINALE (exit band is < 80%)
    const stillFinale = at(860, finale);
    expect(stillFinale.phase).toBe('FINALE');
    const finished = at(1000, finale, { finished: true });
    expect(finished.phase).toBe('FINISHED');
  });
});

describe('deriveRaceSnapshot events', () => {
  it('fires LEAD_CHANGE on the edge only', () => {
    const cfg = { lapLengthM: 0 };
    const s1 = deriveRaceSnapshot(
      state({ a: rider({ cumulativeDistanceM: 100 }), b: rider({ cumulativeDistanceM: 50 }) }), cfg, null);
    expect(s1.leaderId).toBe('a');
    // b overtakes a
    const s2 = deriveRaceSnapshot(
      state({ a: rider({ cumulativeDistanceM: 100 }), b: rider({ cumulativeDistanceM: 200 }) }), cfg, s1);
    expect(s2.leaderId).toBe('b');
    expect(s2.events.some((e) => e.type === 'LEAD_CHANGE')).toBe(true);
    // no further change → no event
    const s3 = deriveRaceSnapshot(
      state({ a: rider({ cumulativeDistanceM: 110 }), b: rider({ cumulativeDistanceM: 220 }) }), cfg, s2);
    expect(s3.events.some((e) => e.type === 'LEAD_CHANGE')).toBe(false);
  });

  it('fires RIDER_FINISHED when finishTimeS newly set', () => {
    const cfg = { lapLengthM: 0 };
    const s1 = deriveRaceSnapshot(state({ a: rider({ cumulativeDistanceM: 900 }) }), cfg, null);
    const s2 = deriveRaceSnapshot(
      state({ a: rider({ cumulativeDistanceM: 1000, finishTimeS: 42 }) }), cfg, s1);
    expect(s2.events.some((e) => e.type === 'RIDER_FINISHED' && e.riderIds.includes('a'))).toBe(true);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx --no-install vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/deriveRaceSnapshot.test.js`
Expected: FAIL — import unresolved.

**Step 3: Implement**

```javascript
import { lapCount, lapProgress } from './lapModel.js';

// Phase progress thresholds with hysteresis (enter/exit pairs) so phase can't
// flap at a boundary — mirrors the sticky logRef in CycleRaceScreen.
const EARLY_ENTER = 0.0, EARLY_EXIT = 0.15;   // EARLY while progress < 0.15
const FINALE_ENTER = 0.85, FINALE_EXIT = 0.80; // FINALE once > 0.85, until < 0.80
const PHOTO_FINISH_GAP_M = 25;

function progressOf(state) {
  if (state.winCondition === 'distance') {
    const lead = Math.max(0, ...Object.values(state.riders).map((r) => r.cumulativeDistanceM || 0));
    return state.goalM > 0 ? lead / state.goalM : 0;
  }
  return state.timeCapS > 0 ? state.elapsedS / state.timeCapS : 0;
}

function nextPhase(prevPhase, started, finished, progress) {
  if (finished) return 'FINISHED';
  if (!started) return 'PRE';
  if (prevPhase === 'FINALE') return progress < FINALE_EXIT ? 'MID' : 'FINALE';
  if (progress >= FINALE_ENTER) return 'FINALE';
  if (prevPhase === 'EARLY') return progress >= EARLY_EXIT ? 'MID' : 'EARLY';
  if (progress < EARLY_ENTER + 1e-9 || progress < EARLY_EXIT) {
    return prevPhase === 'MID' && progress >= EARLY_EXIT ? 'MID' : 'EARLY';
  }
  return 'MID';
}

export function deriveRaceSnapshot(state, config = {}, prevSnapshot = null) {
  const lapLengthM = Number.isFinite(config.lapLengthM) && config.lapLengthM > 0 ? config.lapLengthM : 0;
  const lapsEnabled = lapLengthM > 0;
  const ids = Object.keys(state.riders || {});
  const fieldSize = ids.length;
  const ghostCount = ids.filter((id) => state.riders[id].isGhost).length;
  const humanCount = fieldSize - ghostCount;
  const isSolo = fieldSize === 1;

  // Per-rider derived view.
  const ridersView = {};
  ids.forEach((id) => {
    const r = state.riders[id];
    const d = r.cumulativeDistanceM || 0;
    const splits = r.lapSplits || [];
    ridersView[id] = {
      id, distanceM: d, isGhost: !!r.isGhost, finishTimeS: r.finishTimeS ?? null,
      laps: lapCount(d, lapLengthM), lapProgress: lapProgress(d, lapLengthM),
      lapSplits: splits, lastLapTimeS: splits.length >= 2 ? splits[splits.length - 1] - splits[splits.length - 2] : null
    };
  });

  // Leader + tension metrics.
  const byDist = [...ids].sort((a, b) => (state.riders[b].cumulativeDistanceM || 0) - (state.riders[a].cumulativeDistanceM || 0));
  const leaderId = byDist[0] ?? null;
  const leaderGapM = byDist.length >= 2
    ? (state.riders[byDist[0]].cumulativeDistanceM || 0) - (state.riders[byDist[1]].cumulativeDistanceM || 0)
    : 0;
  let tightestPairGapM = Infinity;
  for (let i = 1; i < byDist.length; i++) {
    tightestPairGapM = Math.min(tightestPairGapM,
      (state.riders[byDist[i - 1]].cumulativeDistanceM || 0) - (state.riders[byDist[i]].cumulativeDistanceM || 0));
  }
  if (!Number.isFinite(tightestPairGapM)) tightestPairGapM = 0;
  const lapsArr = Object.values(ridersView).map((r) => r.laps);
  const lapDeltaMax = lapsArr.length >= 2 ? Math.max(...lapsArr) - Math.min(...lapsArr) : 0;
  const closingRateMPS = prevSnapshot && Number.isFinite(prevSnapshot.leaderGapM) && state.elapsedS > prevSnapshot.elapsedS
    ? (leaderGapM - prevSnapshot.leaderGapM) / (state.elapsedS - prevSnapshot.elapsedS)
    : 0;

  const started = (state.elapsedS || 0) > 0;
  const progress = progressOf(state);
  const phase = nextPhase(prevSnapshot?.phase || 'PRE', started, !!state.finished, progress);

  // Edge-triggered drama events.
  const events = [];
  const fire = (type, riderIds = []) => events.push({ type, riderIds, firedAtClock: state.elapsedS });
  if (prevSnapshot) {
    if (leaderId && prevSnapshot.leaderId && leaderId !== prevSnapshot.leaderId) fire('LEAD_CHANGE', [leaderId]);
    const newlyFinished = ids.filter((id) => ridersView[id].finishTimeS != null
      && (prevSnapshot.ridersView?.[id]?.finishTimeS == null));
    if (newlyFinished.length) fire('RIDER_FINISHED', newlyFinished);
    if (lapsEnabled && lapDeltaMax >= 1 && (prevSnapshot.lapDeltaMax || 0) < 1) fire('LAPPING_IMMINENT', [leaderId]);
    if (phase === 'FINALE' && tightestPairGapM <= PHOTO_FINISH_GAP_M && (prevSnapshot.tightestPairGapM ?? Infinity) > PHOTO_FINISH_GAP_M) fire('PHOTO_FINISH');
    // FINAL_LAP: any rider entered their last lap (distance race + laps on).
    if (lapsEnabled && state.winCondition === 'distance') {
      const lastLap = Math.max(0, lapCount(state.goalM, lapLengthM) - 1);
      const entered = ids.filter((id) => ridersView[id].laps >= lastLap
        && (prevSnapshot.ridersView?.[id]?.laps ?? 0) < lastLap);
      if (entered.length) fire('FINAL_LAP', entered);
    }
  }

  return {
    elapsedS: state.elapsedS, winCondition: state.winCondition, goalM: state.goalM,
    fieldSize, humanCount, ghostCount, isSolo, lapsEnabled, lapLengthM,
    phase, progress, leaderId, leaderGapM, tightestPairGapM, lapDeltaMax, closingRateMPS,
    ridersView, events
  };
}

export default deriveRaceSnapshot;
```

**Step 4: Run to verify it passes**

Run: same as Step 2. Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/deriveRaceSnapshot.js frontend/src/modules/Fitness/lib/cycleGame/deriveRaceSnapshot.test.js
git commit -m "feat(cycle-game): deriveRaceSnapshot — composition, phase (hysteresis), tension, edge events"
```

---

### Task 4: `racePanels.js` — panel descriptor registry

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/racePanels.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/racePanels.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { RACE_PANELS, panelById } from './racePanels.js';

const snap = (over = {}) => ({
  fieldSize: 2, isSolo: false, lapsEnabled: false, leaderGapM: 0, lapDeltaMax: 0,
  phase: 'MID', events: [], ...over
});

describe('racePanels registry', () => {
  it('every panel has the descriptor contract', () => {
    RACE_PANELS.forEach((p) => {
      expect(typeof p.id).toBe('string');
      expect(Array.isArray(p.zones)).toBe(true);
      expect(['wide', 'standard', 'focus']).toContain(p.sizeHint);
      expect(typeof p.candidacy).toBe('function');
      expect(typeof p.priority).toBe('function');
    });
  });

  it('speedoRow is always a candidate; rankings/chart need fieldSize >= 2', () => {
    expect(panelById('speedoRow').candidacy(snap({ fieldSize: 1, isSolo: true }))).toBe(true);
    expect(panelById('rankings').candidacy(snap({ fieldSize: 1, isSolo: true }))).toBe(false);
    expect(panelById('rankings').candidacy(snap({ fieldSize: 2 }))).toBe(true); // ghost counts
    expect(panelById('distanceChart').candidacy(snap({ fieldSize: 1, isSolo: true }))).toBe(false);
  });

  it('lapTable needs laps and is boosted when solo', () => {
    expect(panelById('lapTable').candidacy(snap({ lapsEnabled: false }))).toBe(false);
    const grouped = panelById('lapTable').priority(snap({ lapsEnabled: true, isSolo: false }));
    const solo = panelById('lapTable').priority(snap({ lapsEnabled: true, isSolo: true }));
    expect(solo).toBeGreaterThan(grouped);
  });

  it('cameraZoom only candidates on its trigger events', () => {
    expect(panelById('cameraZoom').candidacy(snap({ events: [] }))).toBe(false);
    expect(panelById('cameraZoom').candidacy(snap({ events: [{ type: 'LAPPING_IMMINENT' }] }))).toBe(true);
    expect(panelById('cameraZoom').transient.minHoldS).toBeGreaterThan(0);
  });
});
```

**Step 2: Run to verify it fails** — `npx --no-install vitest run --config vitest.config.mjs .../racePanels.test.js`. Expected: import unresolved.

**Step 3: Implement**

```javascript
/**
 * Panel descriptor registry for the race director. Each panel declares where it
 * can live (zones, best-first), how big it wants to be, whether it can share a
 * zone via rotation, and pure candidacy/priority functions over the snapshot.
 * Transient panels (camera) carry hold/cooldown timing the director enforces.
 */
const CAMERA_TRIGGERS = ['LAPPING_IMMINENT', 'PHOTO_FINISH'];

export const RACE_PANELS = [
  {
    id: 'speedoRow', zones: ['bottom'], sizeHint: 'wide', cycles: false,
    candidacy: () => true, priority: () => 100, transient: null
  },
  {
    id: 'distanceChart', zones: ['topLeft', 'topCenter'], sizeHint: 'standard', cycles: true,
    candidacy: (s) => s.fieldSize >= 2,
    priority: (s) => 50 + Math.min(20, (s.leaderGapM || 0) * 0.02), transient: null
  },
  {
    id: 'rankings', zones: ['topRight', 'topCenter'], sizeHint: 'standard', cycles: true,
    candidacy: (s) => s.fieldSize >= 2, // ghosts count toward fieldSize
    priority: (s) => 45 + Math.min(30, (s.leaderGapM || 0) * 0.05), transient: null
  },
  {
    id: 'lapTable', zones: ['topLeft', 'topCenter', 'topRight'], sizeHint: 'standard', cycles: true,
    candidacy: (s) => !!s.lapsEnabled,
    priority: (s) => (s.isSolo ? 80 : 40), transient: null
  },
  {
    id: 'ovalTrack', zones: ['topCenter', 'topLeft'], sizeHint: 'standard', cycles: true,
    candidacy: (s) => !!s.lapsEnabled && s.fieldSize >= 2,
    priority: (s) => 42 + Math.min(25, (s.lapDeltaMax || 0) * 15), transient: null
  },
  {
    id: 'cameraZoom', zones: ['topCenter'], sizeHint: 'focus', cycles: false,
    candidacy: (s) => (s.events || []).some((e) => CAMERA_TRIGGERS.includes(e.type)),
    priority: () => 200, // wins the focus zone when active
    transient: { minHoldS: 6, cooldownS: 10, triggers: CAMERA_TRIGGERS }
  }
];

export function panelById(id) {
  return RACE_PANELS.find((p) => p.id === id) || null;
}

export default RACE_PANELS;
```

**Step 4: Run to verify it passes** — same command. Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/racePanels.js frontend/src/modules/Fitness/lib/cycleGame/racePanels.test.js
git commit -m "feat(cycle-game): panel descriptor registry (candidacy/priority/transient)"
```

---

### Task 5: `raceDirector.js` — the assignment engine (centerpiece)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/raceDirector.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/raceDirector.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { raceDirector } from './raceDirector.js';

const base = (over = {}) => ({
  fieldSize: 2, isSolo: false, lapsEnabled: false, phase: 'MID',
  leaderGapM: 100, lapDeltaMax: 0, tightestPairGapM: 50, events: [], ...over
});

describe('raceDirector zone assignment', () => {
  it('solo with laps: no rankings/chart, lap table promoted up top', () => {
    const snap = base({ fieldSize: 1, isSolo: true, lapsEnabled: true });
    const d = raceDirector(snap, null, 10);
    expect(d.zones.bottom).toBe('speedoRow');
    const top = [d.zones.topLeft, d.zones.topCenter, d.zones.topRight];
    expect(top).toContain('lapTable');
    expect(top).not.toContain('rankings');
    expect(top).not.toContain('distanceChart');
  });

  it('human + ghost: rankings present (ghost counts as a competitor)', () => {
    const d = raceDirector(base({ fieldSize: 2 }), null, 10);
    const top = [d.zones.topLeft, d.zones.topCenter, d.zones.topRight];
    expect(top).toContain('rankings');
  });
});

describe('raceDirector transient camera', () => {
  it('promotes camera on event and HOLDS it for minHoldS after the event clears', () => {
    const fired = base({ lapsEnabled: true, fieldSize: 2, lapDeltaMax: 1, events: [{ type: 'LAPPING_IMMINENT' }] });
    const d1 = raceDirector(fired, null, 10);
    expect(d1.zones.topCenter).toBe('cameraZoom');
    // event gone at t=12 (within 6s hold) → still showing
    const d2 = raceDirector(base({ lapsEnabled: true, fieldSize: 2, events: [] }), d1, 12);
    expect(d2.zones.topCenter).toBe('cameraZoom');
    // t=17 (> 6s after shownAt=10) → released
    const d3 = raceDirector(base({ lapsEnabled: true, fieldSize: 2, events: [] }), d2, 17);
    expect(d3.zones.topCenter).not.toBe('cameraZoom');
  });

  it('respects cooldown — will not re-fire within cooldownS of release', () => {
    const fire = base({ lapsEnabled: true, fieldSize: 2, events: [{ type: 'LAPPING_IMMINENT' }] });
    const d1 = raceDirector(fire, null, 10);
    const d3 = raceDirector(base({ lapsEnabled: true, fieldSize: 2, events: [] }), d1, 17); // released
    const d4 = raceDirector(fire, d3, 19); // event again, but < cooldown(10) since show
    expect(d4.zones.topCenter).not.toBe('cameraZoom');
  });
});

describe('raceDirector stability', () => {
  it('does not swap an incumbent for a near-equal challenger (hysteresis)', () => {
    // two panels competing for topCenter with close scores across ticks
    const s = base({ fieldSize: 2, lapsEnabled: true });
    const d1 = raceDirector(s, null, 10);
    const incumbent = d1.zones.topCenter;
    const d2 = raceDirector(s, d1, 11);
    expect(d2.zones.topCenter).toBe(incumbent); // no thrash on identical input
  });
});
```

**Step 2: Run to verify it fails** — `npx --no-install vitest run --config vitest.config.mjs .../raceDirector.test.js`. Expected: import unresolved.

**Step 3: Implement**

```javascript
import { RACE_PANELS } from './racePanels.js';

const ZONES = ['bottom', 'topLeft', 'topCenter', 'topRight'];
const MIN_DWELL_S = 5;       // min time a panel holds a zone before eviction
const CYCLE_DWELL_S = 8;     // rotation dwell when a zone has an overflow pool
const HYSTERESIS = 1.15;     // challenger must beat incumbent score by 15%

const emptyDecision = () => ({
  zones: { bottom: null, topLeft: null, topCenter: null, topRight: null },
  pools: {}, timers: { assignedAt: {}, cycleAt: {} }, transient: {}
});

export function raceDirector(snapshot, prevDecision, clock) {
  const prev = prevDecision || emptyDecision();
  const decision = emptyDecision();
  const scored = RACE_PANELS
    .filter((p) => p.candidacy(snapshot))
    .map((p) => ({ panel: p, score: p.priority(snapshot) }))
    .sort((a, b) => b.score - a.score);

  const taken = new Set();
  const assign = (zone, id) => {
    decision.zones[zone] = id;
    taken.add(zone);
    decision.timers.assignedAt[zone] = (prev.zones[zone] === id && prev.timers.assignedAt[zone] != null)
      ? prev.timers.assignedAt[zone] : clock; // preserve dwell start if unchanged
  };

  // STAGE 2 — transient promotion (highest precedence).
  RACE_PANELS.filter((p) => p.transient).forEach((p) => {
    const t = p.transient;
    const zone = p.zones[0];
    const tr = prev.transient[p.id] || {};
    const triggered = (snapshot.events || []).some((e) => t.triggers.includes(e.type));
    const wasShowing = prev.zones[zone] === p.id;
    const shownAt = tr.shownAt;
    let show = false;
    if (wasShowing) {
      // hold until minHoldS elapses; extend hold if still triggered
      const heldFor = clock - (shownAt ?? clock);
      show = triggered || heldFor < t.minHoldS;
    } else if (triggered) {
      // re-fire only if past cooldown since last show ended
      const lastShown = tr.shownAt ?? -Infinity;
      show = (clock - lastShown) >= t.cooldownS;
    }
    if (show) {
      assign(zone, p.id);
      decision.transient[p.id] = { shownAt: wasShowing ? (shownAt ?? clock) : clock };
    } else {
      decision.transient[p.id] = { shownAt: tr.shownAt }; // remember for cooldown
    }
  });

  // STAGE 3 — greedy resident assignment by score, with dwell + hysteresis.
  const pools = {}; ZONES.forEach((z) => { pools[z] = []; });
  scored.filter(({ panel }) => !panel.transient).forEach(({ panel, score }) => {
    const zone = panel.zones.find((z) => !taken.has(z));
    if (!zone) {
      // no free preferred zone — drop into the first preferred zone's pool
      pools[panel.zones[0]].push({ id: panel.id, score, cycles: panel.cycles });
      return;
    }
    const incumbent = prev.zones[zone];
    const incumbentDwell = clock - (prev.timers.assignedAt[zone] ?? -Infinity);
    if (incumbent && incumbent !== panel.id && incumbentDwell < MIN_DWELL_S) {
      // incumbent still within min dwell — keep it, pool the challenger
      assign(zone, incumbent);
      pools[zone].push({ id: panel.id, score, cycles: panel.cycles });
      return;
    }
    if (incumbent && incumbent !== panel.id) {
      const incScore = (scored.find((s) => s.panel.id === incumbent) || {}).score || 0;
      if (score < incScore * HYSTERESIS) { // not enough to dethrone
        assign(zone, incumbent);
        pools[zone].push({ id: panel.id, score, cycles: panel.cycles });
        return;
      }
    }
    assign(zone, panel.id);
  });

  // STAGE 4 — cycling: a taken zone with >1 pooled candidate and a cycling lead rotates.
  ZONES.forEach((zone) => {
    const pool = (pools[zone] || []).filter((c) => c.cycles).sort((a, b) => b.score - a.score);
    decision.pools[zone] = pool.map((c) => c.id);
    const lead = decision.zones[zone];
    const leadCycles = RACE_PANELS.find((p) => p.id === lead)?.cycles;
    if (!leadCycles || pool.length === 0) { decision.timers.cycleAt[zone] = prev.timers.cycleAt?.[zone] ?? clock; return; }
    const rotation = [lead, ...pool.map((c) => c.id)];
    const cycleStart = prev.timers.cycleAt?.[zone] ?? clock;
    if (clock - cycleStart >= CYCLE_DWELL_S) {
      const curIdx = rotation.indexOf(prev.zones[zone]);
      const next = rotation[(curIdx + 1) % rotation.length];
      assign(zone, next);
      decision.timers.cycleAt[zone] = clock;
    } else {
      decision.timers.cycleAt[zone] = cycleStart;
    }
  });

  return decision;
}

export default raceDirector;
```

**Step 4: Run to verify it passes** — same command. Expected: PASS. *(If a stability test flakes, the executor should tune `MIN_DWELL_S`/`HYSTERESIS` — these are the documented knobs.)*

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/raceDirector.js frontend/src/modules/Fitness/lib/cycleGame/raceDirector.test.js
git commit -m "feat(cycle-game): raceDirector — transient/greedy/cycle assignment with hysteresis"
```

---

## PHASE C — Layout shell + panel extraction (reproduce existing layout first)

> Goal: refactor with ZERO visual change first, then let the director drive. Existing `CycleRaceScreen.test.js` must stay green throughout.

### Task 6: Extract resident panels from CycleRaceScreen

Pure extraction — move JSX into standalone components, no behavior change.

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/Rankings.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/Rankings.test.jsx` (one per panel, light)

**Step 1: Write a failing render test for each panel** (example — Rankings):

```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Rankings from './Rankings.jsx';

describe('Rankings panel', () => {
  it('renders one row per rider sorted by distance, leader first', () => {
    render(<Rankings
      riderIds={['a', 'b']}
      riders={{ a: { displayName: 'Ann', cumulativeDistanceM: 100 }, b: { displayName: 'Bob', cumulativeDistanceM: 300 } }}
      riderLive={{ a: {}, b: {} }}
    />);
    const rows = screen.getAllByTestId('roster-row');
    expect(rows).toHaveLength(2);
    // Bob (300m) ranked first
    expect(rows[0]).toHaveTextContent('Bob');
  });
});
```
(For `SpeedoRow` assert N `cycle-speedometer` render; for `DistanceChart` assert `race-line` count = rider count. Add `data-testid="roster-row"` to the row in extraction.)

**Step 2: Run to verify it fails** — import unresolved.

**Step 3: Extract.** Move the relevant JSX blocks verbatim out of `CycleRaceScreen.jsx`:
- `SpeedoRow` ← the `__speedos` block (lines ~319-347) + the speedo-sizing `useEffect` + `speedosRef`/`speedoSize` state. Props: `riderIds, riders, riderLive, cadenceBands, showSpeedos`.
- `DistanceChart` ← the `__chart-wrap` SVG + tags block (lines ~201-292) + chart-height effect + log/linear scale logic. Props: `riderIds, riders, riderLive, winCondition, goalM`.
- `Rankings` ← the `__roster` aside (lines ~294-316). Props: `riderIds, riders, riderLive`.

`CycleRaceScreen.jsx` keeps the clock frame, penalty banner, background video, and now renders `<DistanceChart/> <Rankings/>` inside `__top` and `<SpeedoRow/>` below — identical DOM. Keep all existing `data-testid`s.

**Step 4: Run to verify** — new panel tests PASS **and** existing `CycleRaceScreen.test.js` still PASS:
```bash
npx --no-install vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/
```
Expected: all green (the whole widget suite).

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/ frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx
git commit -m "refactor(cycle-game): extract SpeedoRow/DistanceChart/Rankings panels (no visual change)"
```

---

### Task 7: `RaceLayoutManager` + `PanelSlot` — wire the director

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.scss`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PanelSlot.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx` (delegate top+bottom to the manager)
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RaceLayoutManager from './RaceLayoutManager.jsx';

const panels = {
  speedoRow: () => <div data-testid="p-speedo">speedo</div>,
  rankings: () => <div data-testid="p-rankings">rank</div>,
  distanceChart: () => <div data-testid="p-chart">chart</div>
};

describe('RaceLayoutManager', () => {
  it('renders the panel each zone is assigned, and collapses null zones', () => {
    render(<RaceLayoutManager
      decision={{ zones: { bottom: 'speedoRow', topLeft: 'distanceChart', topCenter: null, topRight: 'rankings' } }}
      panels={panels}
    />);
    expect(screen.getByTestId('p-speedo')).toBeInTheDocument();
    expect(screen.getByTestId('p-chart')).toBeInTheDocument();
    expect(screen.getByTestId('p-rankings')).toBeInTheDocument();
    // collapsed center has the collapsed modifier
    expect(screen.getByTestId('zone-topCenter')).toHaveClass('race-layout__zone--empty');
  });
});
```

**Step 2: Run to verify it fails** — import unresolved.

**Step 3: Implement**

`PanelSlot.jsx` — a thin wrapper that crossfades its child on key change:
```javascript
import React from 'react';
import PropTypes from 'prop-types';
// Fade+slide on mount; CSS handles the transition (motion plays — animation-kill
// is Menu-scoped, not here). Keyed by panelId so a swap remounts + animates.
export default function PanelSlot({ panelId, children }) {
  return (
    <div className="race-layout__slot" key={panelId} data-panel={panelId}>{children}</div>
  );
}
PanelSlot.propTypes = { panelId: PropTypes.string, children: PropTypes.node };
```

`RaceLayoutManager.jsx`:
```javascript
import React from 'react';
import PropTypes from 'prop-types';
import PanelSlot from './panels/PanelSlot.jsx';
import './RaceLayoutManager.scss';

const TOP = ['topLeft', 'topCenter', 'topRight'];

export default function RaceLayoutManager({ decision, panels }) {
  const zones = decision?.zones || {};
  const filledTop = TOP.filter((z) => zones[z]).length || 1;
  const renderZone = (zone) => {
    const id = zones[zone];
    const Panel = id ? panels[id] : null;
    return (
      <div key={zone} data-testid={`zone-${zone}`}
        className={`race-layout__zone race-layout__zone--${zone}${id ? '' : ' race-layout__zone--empty'}`}>
        {Panel ? <PanelSlot panelId={id}><Panel /></PanelSlot> : null}
      </div>
    );
  };
  return (
    <div className="race-layout" style={{ '--top-filled': filledTop }}>
      <div className="race-layout__top">{TOP.map(renderZone)}</div>
      {renderZone('bottom')}
    </div>
  );
}
RaceLayoutManager.propTypes = { decision: PropTypes.object, panels: PropTypes.object };
```

`RaceLayoutManager.scss` (consume synthwave tokens):
```scss
@use './cgTokens' as t;
.race-layout {
  display: grid; grid-template-rows: 1fr auto; gap: 16px; height: 100%;
  &__top {
    display: grid; gap: 16px;
    grid-template-columns: repeat(var(--top-filled, 3), 1fr);
  }
  &__zone { position: relative; min-width: 0; }
  &__zone--empty { display: none; } // collapsed; siblings reflow via --top-filled
  &__zone--bottom { /* wide strip */ }
  &__slot { animation: race-slot-in 300ms ease both; }
}
@keyframes race-slot-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
```
> Note: `--top-filled` counts filled top zones so collapsed zones don't leave gaps (1→full width, 2→halves, 3→thirds), per design §6.

**Step 4: Wire into `CycleRaceScreen.jsx`.** Build the snapshot+decision with refs (mirroring the existing `logRef` pattern), pass a `panels` map of closures binding the extracted panels to current props:
```javascript
import { deriveRaceSnapshot } from '@/modules/Fitness/lib/cycleGame/deriveRaceSnapshot.js';
import { raceDirector } from '@/modules/Fitness/lib/cycleGame/raceDirector.js';
// inside the component:
const prevSnapRef = useRef(null);
const prevDecisionRef = useRef(null);
const snapshot = deriveRaceSnapshot(
  { elapsedS, winCondition, goalM, timeCapS, finished: false, riders }, { lapLengthM }, prevSnapRef.current);
prevSnapRef.current = snapshot;
const decision = raceDirector(snapshot, prevDecisionRef.current, elapsedS);
prevDecisionRef.current = decision;
const panels = {
  speedoRow: () => <SpeedoRow {...speedoProps} />,
  distanceChart: () => <DistanceChart {...chartProps} />,
  rankings: () => <Rankings {...rankProps} />
  // lapTable/ovalTrack/cameraZoom added in Phase D
};
// replace the hardcoded __top + __speedos JSX with:
<RaceLayoutManager decision={decision} panels={panels} />
```
Accept `lapLengthM` as a new prop (default 0) and have `CycleGameContainer` pass `cycleGameConfig?.lap_length_m`. Keep clock/penalty/background as-is.

**Step 5: Run the whole widget suite** — `npx --no-install vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/`. Expected: all green. For a group race with no laps, the director reproduces today's layout (chart left, rankings right, speedos bottom).

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.jsx frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.scss frontend/src/modules/Fitness/widgets/CycleGame/panels/PanelSlot.jsx frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx
git commit -m "feat(cycle-game): RaceLayoutManager drives layout via the director (existing layout reproduced)"
```

---

## PHASE D — New panels

### Task 8: `LapTable` panel — growing per-lap split table

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/LapTable.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/LapTable.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/LapTable.test.jsx`

**Step 1: Failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LapTable from './LapTable.jsx';

describe('LapTable', () => {
  it('renders one row per completed lap and a column per rider', () => {
    render(<LapTable
      riderIds={['a', 'b']}
      riders={{ a: { displayName: 'Ann' }, b: { displayName: 'Bob' } }}
      lapSplits={{ a: [30, 65], b: [32] }}
    />);
    // Lap 1 and Lap 2 rows
    expect(screen.getByText('Lap 1')).toBeInTheDocument();
    expect(screen.getByText('Lap 2')).toBeInTheDocument();
    // header has both riders
    expect(screen.getByText('Ann')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
  it('shows the per-lap delta, not cumulative time', () => {
    render(<LapTable riderIds={['a']} riders={{ a: { displayName: 'Ann' } }} lapSplits={{ a: [30, 65] }} />);
    expect(screen.getByText('0:30')).toBeInTheDocument(); // lap 1 = 30 - 0
    expect(screen.getByText('0:35')).toBeInTheDocument(); // lap 2 = 65 - 30
  });
});
```

**Step 2: Run → fail.** **Step 3:** implement — build rows from `max(lapSplits[*].length)`; cell = `formatClock(splits[i] - (splits[i-1] || 0))` using `cycleGameLobby.formatClock`; lane-color the columns via `LINE_COLORS`; style with `_cgTokens.scss` (italic tabular numerals via `cg-numeral`). **Step 4:** run → pass. **Step 5:** add `lapTable` to the `panels` map in `CycleRaceScreen.jsx` (passing `lapSplits` from `snapshot.ridersView`). Run widget suite → green.

**Step 6: Commit**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/LapTable.* frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx
git commit -m "feat(cycle-game): LapTable panel — growing per-lap split table"
```

---

### Task 9: `OvalTrack` panel — avatars circling an oval

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.test.jsx`

**Step 1: Failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OvalTrack from './OvalTrack.jsx';
import { ovalPoint } from './OvalTrack.jsx';

describe('OvalTrack geometry', () => {
  it('maps lapProgress 0 and 0.5 to opposite sides of the oval', () => {
    const p0 = ovalPoint(0, 100, 50);   // (rx=100, ry=50)
    const pHalf = ovalPoint(0.5, 100, 50);
    expect(p0.x).toBeCloseTo(pHalf.x * -1 + 0, 0); // roughly opposite x... see impl note
  });
});
describe('OvalTrack render', () => {
  it('renders one avatar marker per rider', () => {
    render(<OvalTrack
      riderIds={['a', 'b']}
      riders={{ a: { displayName: 'Ann' }, b: { displayName: 'Bob' } }}
      riderLive={{ a: { lapProgress: 0.1 }, b: { lapProgress: 0.6 } }}
    />);
    expect(screen.getAllByTestId('oval-marker')).toHaveLength(2);
  });
});
```
> Impl note: `ovalPoint(progress, rx, ry)` returns `{x: rx*cos(θ), y: ry*sin(θ)}`, `θ = -π/2 + progress*2π` (start at top, clockwise). Adjust the geometry assertion to the exact formula when implementing.

**Step 2: Run → fail.** **Step 3:** implement `ovalPoint` + an SVG `<ellipse>` track with a start/finish tick, positioning each rider's avatar marker at `ovalPoint(lapProgress)`, lane-colored, ghost dashed. CSS transition on marker transform for smooth motion. **Step 4:** run → pass. **Step 5:** add `ovalTrack` to the `panels` map (laps-on, fieldSize ≥ 2). Run widget suite → green.

**Step 6: Commit**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.* frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx
git commit -m "feat(cycle-game): OvalTrack panel — avatars circling a velodrome oval"
```

---

### Task 10: `CameraZoom` panel — auto-framed gap view

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/CameraZoom.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/CameraZoom.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/CameraZoom.test.jsx`

**Step 1: Failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CameraZoom from './CameraZoom.jsx';
import { framePositions } from './CameraZoom.jsx';

describe('CameraZoom framing', () => {
  it('normalizes the involved riders to fill the frame (closest = left, leader = right)', () => {
    const pos = framePositions([
      { id: 'a', distanceM: 980 }, { id: 'b', distanceM: 1000 }
    ]);
    expect(pos.find((p) => p.id === 'b').xPct).toBeCloseTo(100, 0);
    expect(pos.find((p) => p.id === 'a').xPct).toBeCloseTo(0, 0);
  });
});
describe('CameraZoom render', () => {
  it('renders a grid backdrop and a marker per framed rider', () => {
    render(<CameraZoom
      riders={{ a: { displayName: 'Ann', cumulativeDistanceM: 980 }, b: { displayName: 'Bob', cumulativeDistanceM: 1000 } }}
      riderIds={['a', 'b']} riderLive={{ a: {}, b: {} }}
    />);
    expect(screen.getByTestId('camera-grid')).toBeInTheDocument();
    expect(screen.getAllByTestId('camera-marker')).toHaveLength(2);
  });
});
```

**Step 2: Run → fail.** **Step 3:** implement `framePositions(riders)` (min/max distance → 0..100% with small padding) + a panel with a moving grid backdrop (CSS `background-position` animation) and avatar markers, emphasizing the gap. **Step 4:** run → pass. **Step 5:** add `cameraZoom` to the `panels` map; it only appears when the director promotes it (transient). Run widget suite → green.

**Step 6: Commit**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/CameraZoom.* frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx
git commit -m "feat(cycle-game): CameraZoom transient panel — auto-framed lapping/photo-finish view"
```

---

## Final steps (after all tasks)

1. **Full suite green:**
   ```bash
   npx --no-install vitest run --config vitest.config.mjs frontend/src/modules/Fitness/
   ```
2. **Docs:** update `docs/plans/2026-06-03-cycle-game-race-director-design.md` status to "Implemented"; note `lap_length_m` in the cycle-game config docs if a config reference exists.
3. **Manual TV smoke** (per CLAUDE.md — do not start a dev server without checking it isn't already running): solo+laps (lap table prominent, no rankings), human+ghost (rankings present), 5-rider group (all speedos fit), trigger a lapping moment (camera promotes, holds, releases).
4. **Final code review** (subagent-driven-development dispatches a final reviewer over the whole branch).
5. Hand off via @superpowers:finishing-a-development-branch.

## Notes & risks

- **DRY:** `formatClock`/`formatDistance` already exist in `lib/cycleGame` — reuse, don't reimplement.
- **YAGNI:** descriptors are code, not YAML (config-rules option C is deferred). `FINAL_LAP`/`LEAD_CHANGE`/`closingRateMPS` are derived but no v1 panel must consume them — wire camera to `LAPPING_IMMINENT`+`PHOTO_FINISH` first, tune later.
- **Purity guardrail:** `raceDirector`/`deriveRaceSnapshot` must never call `Date.now()` or read React state — all time comes from `elapsedS`/`clock` args and all memory from `prev*`. This is what keeps them unit-testable.
- **No regressions:** Phase C is a pure refactor; the existing `CycleRaceScreen.test.js` is the guard — it must stay green before Phase D adds anything new.
```
