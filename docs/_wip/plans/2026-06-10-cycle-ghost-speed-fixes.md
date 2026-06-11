# Cycle Ghost Speed & Identity Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 10 code-review findings from the ghost-rider speed bugfix: jitter-free interval-aware ghost speed computed in the engine, equipment threading for correct gauge scaling, and participant-identity reuse in RaceRecap.

**Architecture:** Move display-speed physics out of the view layer into `CycleRaceEngine` (per-rider windowed `speedKmh` from unrounded distances, zeroed at the finish line) and into a shared pure helper (`windowedSeriesKmh` in `speed.js`) for replays. Thread the already-persisted `equipment` field through ghost candidates → ghost riders so gauge `maxRpm` resolves per-equipment. Replace ad-hoc ghost-id string parsing with the existing `resolveParticipantIdentity` SSOT.

**Tech Stack:** React (jsx), pure-JS lib modules, Vitest (colocated `*.test.js` files, run via `npx vitest run <path>` from repo root).

---

## IMPORTANT — project rules that override the default workflow

- **Do NOT commit.** CLAUDE.md forbids automatic commits — KC reviews all changes. Every task ends with `git add` (staging) only. KC commits manually after review.
- **Baseline:** the working tree already contains an uncommitted first-pass fix in `CycleGameContainer.jsx` and `RaceRecap.jsx` (ghost speed from a 1-tick distance delta; isGhost/avatar fixes in recap). This plan **revises** that diff — Tasks 4 and 5 replace parts of it. Do not try to restore the committed (broken) versions first.
- **Logging:** any new diagnostic logging must use the structured framework (`getLogger().child(...)`), never raw `console.*`. No new logging is required by this plan.

## Findings → Task map

| # | Finding | Fixed in |
|---|---------|----------|
| 1 | Ghost speed flickers ±3.6 km/h (integer-rounded series, 1-tick delta) | Task 1, 2, 4, 5 |
| 2 | Finished ghost shows nonzero km/h for one tick | Task 2, 4 |
| 3 | Ghost `equipmentId: null` → gauge maxRpm wrong (root cause not fixed) | Task 3 |
| 4 | rpm-less legacy ghost: needle 0 under a moving km/h | Task 2, 4 |
| 5 | Ghost speed formula bakes in 1-second tick (no interval division) | Task 2, 4 |
| 6 | RaceRecap re-implements ghost-id parse (`split(':')[2]` breaks nested ids); container `sourceId` same | Task 4, 5 |
| 7 | Recap riderLive missing `maxRpm` (needle pegged at 120 default) | Task 3, 5 |
| 8 | `kmh()` SSOT helper in `speed.js` not reused; two divergent inline formulas | Task 1, 2, 5 |
| 9 | `wheelM` dead computation in ghost path | Task 4 (becomes genuinely shared — used for synth rpm) |
| 10 | Recap `distNow` duplicates `sampleAt`; redundant `\|\| 1` | Task 5 |

---

### Task 1: `windowedSeriesKmh` helper in speed.js

Pure helper for "display speed at tick *t* of a recorded cumulative-distance series." Used by RaceRecap (Task 5). Window-averaging is what kills the jitter: series values are integer metres (the serializer and the engine both round), so a 1-sample delta is ±1 m (±3.6 km/h at 1 s); a 5-sample window bounds the error to ±0.72 km/h.

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/speed.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/speed.test.js`

**Step 1: Write the failing tests**

Append to `speed.test.js` (import line becomes `import { kmh, kmhLabel, participantDurationS, windowedSeriesKmh } from './speed.js';`):

```javascript
describe('windowedSeriesKmh', () => {
  // Steady 8.4 m/s saved as rounded cumulative metres — 1-tick deltas alternate 8/9.
  const series = [8, 17, 25, 34, 42, 50, 59, 67];
  it('averages over the trailing window to smooth integer-metre jitter', () => {
    const v = windowedSeriesKmh(series, 6, 1); // window [t=1..6]: (59-17)/5s = 8.4 m/s
    expect(v).toBeCloseTo(30.24, 2);
  });
  it('uses the first sample alone at tick 0', () => {
    expect(windowedSeriesKmh(series, 0, 1)).toBeCloseTo(28.8, 5); // 8 m in 1 s
  });
  it('divides by the recording interval', () => {
    expect(windowedSeriesKmh([10, 20, 30], 2, 5)).toBeCloseTo(7.2, 5); // 20 m over 10 s
  });
  it('clamps the tick index into the series and handles empties', () => {
    expect(windowedSeriesKmh(series, 99, 1)).toBe(windowedSeriesKmh(series, 7, 1));
    expect(windowedSeriesKmh([], 3, 1)).toBe(0);
    expect(windowedSeriesKmh(null, 3, 1)).toBe(0);
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run frontend/src/modules/Fitness/lib/cycleGame/speed.test.js`
Expected: FAIL — `windowedSeriesKmh is not a function` (4 new tests fail, 8 existing pass).

**Step 3: Implement**

Append to `speed.js`:

```javascript
/**
 * Display speed (km/h) at one tick of a cumulative-distance series, averaged over
 * a trailing window. Recorded series hold integer metres (rounded at save time),
 * so a single-sample delta jitters by ±1 m — the window bounds that error.
 * tickIndex is clamped into the series; tick 0 reads the first sample alone.
 */
export function windowedSeriesKmh(series, tickIndex, intervalS, windowTicks = 5) {
  if (!Array.isArray(series) || series.length === 0) return 0;
  const t = Math.min(Math.max(0, tickIndex), series.length - 1);
  if (t === 0) return kmh(series[0], intervalS);
  const from = Math.max(0, t - windowTicks);
  return kmh(series[t] - series[from], (t - from) * intervalS);
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run frontend/src/modules/Fitness/lib/cycleGame/speed.test.js`
Expected: PASS (12 tests).

**Step 5: Stage**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/speed.js frontend/src/modules/Fitness/lib/cycleGame/speed.test.js
```

---

### Task 2: Engine-owned `speedKmh` + `hasRpmData`

The engine owns the physics; it knows the tick interval, the *unrounded* cumulative distance, and finish state. Exposing per-rider `speedKmh` in `getState()` fixes the interval coupling (finding 5), the finished-ghost nonzero tick (finding 2), and as much of the jitter as the recorded data permits (finding 1). `hasRpmData` lets the view distinguish "ghost pedaling 0 rpm" from "ghost recorded before rpm_series existed" (finding 4).

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`

**Step 1: Write the failing tests**

Append to `CycleRaceEngine.test.js` (it already defines `const HOT = [{ id: 'hot', distance_multiplier: 2 }];` at top — reuse it):

```javascript
describe('CycleRaceEngine — display speedKmh', () => {
  const ghostRace = (ghostSeries, goalM = 1000) => new CycleRaceEngine({
    winCondition: 'distance', goalM, intervalMs: 1000,
    riders: [{ userId: 'g', displayName: 'G', ghostSeries, ghostIntervalS: 1 }]
  });

  it('averages ghost speed over a window, smoothing integer-metre jitter', () => {
    // Steady 8.4 m/s saved rounded: [8,17,25,34,42,50,59,67,76,84]
    const series = Array.from({ length: 10 }, (_, i) => Math.round((i + 1) * 8.4));
    const e = ghostRace(series);
    for (let i = 0; i < 6; i++) e.tick({});
    expect(e.getState().riders.g.speedKmh).toBeCloseTo(30.24, 1);
  });

  it('reads 0 from the very tick a distance-race rider crosses the line', () => {
    const e = ghostRace([10, 20, 30], 25); // crosses on tick 3 (30 ≥ 25)
    e.tick({}); e.tick({});
    expect(e.getState().riders.g.speedKmh).toBeGreaterThan(0);
    e.tick({});
    const s = e.getState();
    expect(s.riders.g.finishTimeS).toBe(3);
    expect(s.riders.g.speedKmh).toBe(0);
  });

  it('scales with the engine tick interval', () => {
    // 60 rpm × 2.1 m wheel × hot(2) = 21 m per 5 s tick → 4.2 m/s → 15.12 km/h, NOT 21·3.6.
    const e = new CycleRaceEngine({
      winCondition: 'distance', goalM: 10000, intervalMs: 5000, zones: HOT,
      riders: [{ userId: 'a', displayName: 'A', equipmentId: 'x', wheelCircumferenceM: 2.1 }]
    });
    e.tick({ a: { rpm: 60, zoneId: 'hot' } });
    expect(e.getState().riders.a.speedKmh).toBeCloseTo(15.12, 2);
  });

  it('reads 0 before any tick has run', () => {
    const e = ghostRace([10, 20, 30]);
    expect(e.getState().riders.g.speedKmh).toBe(0);
  });

  it('flags hasRpmData false only for ghosts without an rpm series', () => {
    const e = new CycleRaceEngine({
      winCondition: 'distance', goalM: 1000, intervalMs: 1000,
      riders: [
        { userId: 'g1', displayName: 'G1', ghostSeries: [5, 10], ghostIntervalS: 1 },
        { userId: 'g2', displayName: 'G2', ghostSeries: [5, 10], ghostRpmSeries: [60, 60], ghostIntervalS: 1 },
        { userId: 'live', displayName: 'L', equipmentId: 'x', wheelCircumferenceM: 2.1 }
      ]
    });
    const s = e.tick({});
    expect(s.riders.g1.hasRpmData).toBe(false);
    expect(s.riders.g2.hasRpmData).toBe(true);
    expect(s.riders.live.hasRpmData).toBe(true);
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`
Expected: FAIL — the 5 new tests fail (`speedKmh`/`hasRpmData` undefined); all pre-existing tests still pass.

**Step 3: Implement**

In `CycleRaceEngine.js`:

(a) Add the import and window constant at the top:

```javascript
import { computeDistanceDelta, zoneMultiplierFor } from './distanceModel.js';
import { kmh } from './speed.js';

// Display speed is averaged over this many ticks. Recorded/replayed distance
// series hold integer metres, so a 1-tick delta jitters by ±1 m (±3.6 km/h at
// 1 s ticks); a 5-tick window bounds that error to under 1 km/h.
const SPEED_WINDOW_TICKS = 5;
```

(b) In the constructor's rider object (after `zoneSeries: [],` line ~35), add the unrounded ring buffer, seeded with the start-line zero:

```javascript
        // Unrounded cumulative distances for the display-speed window — kept
        // separate from distanceSeries, whose Math.round quantizes 1-tick deltas.
        recentDist: [0],
```

(c) In `tick()`, after `rider.hrSeries.push(hr);` (line ~127), add:

```javascript
      rider.recentDist.push(rider.cumulativeDistanceM);
      if (rider.recentDist.length > SPEED_WINDOW_TICKS + 1) rider.recentDist.shift();
```

(d) Add a private method (next to `_ghostSampleAt`):

```javascript
  // Display speed over the trailing window. A rider parked at the finish line
  // of a distance race reads 0 immediately — including the tick they cross.
  _speedKmh(rider) {
    if (this.winCondition === 'distance' && rider.finishTimeS != null) return 0;
    const ring = rider.recentDist;
    if (!ring || ring.length < 2) return 0;
    return kmh(ring[ring.length - 1] - ring[0], (ring.length - 1) * this.intervalSeconds);
  }
```

(e) In `getState()`'s per-rider object (after `isGhost: !!r.isGhost`), add:

```javascript
        speedKmh: this._speedKmh(r),
        // False only for ghosts whose source record predates rpm_series — the
        // view can synthesize a display cadence instead of parking the needle.
        hasRpmData: r.isGhost ? !!(r.ghostRpmArr && r.ghostRpmArr.length) : true
```

**Step 4: Run to verify pass**

Run: `npx vitest run frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`
Expected: PASS (all, including the 5 new).

Also run the controller + snapshot tests, which consume `getState()`:
`npx vitest run frontend/src/modules/Fitness/lib/cycleGame/CycleRaceController.test.js frontend/src/modules/Fitness/lib/cycleGame/deriveRaceSnapshot.test.js`
Expected: PASS (additive fields only).

**Step 5: Stage**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js
```

---

### Task 3: Thread `equipment` through the ghost pipeline

`raceRecord.js` already persists `equipment: r.equipmentId` per participant; nothing reads it back. Threading it: ghost gauges scale to the recording equipment (`maxRpm` at `CycleGameContainer.jsx:1365` resolves via `bikeById`), and the recap gets a precomputed `gaugeMaxRpm`. Records that predate the field fall back to today's behavior (120 default) gracefully.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` (three sites: `ghostCandidates` ~line 512, `onSelectGhost` ~line 1103, `buildRiders` ~line 192)

No new unit test — `buildRiders`/`ghostCandidates` are internal to the container component, and the observable behavior (gauge scale) is covered by the recap test in Task 5 plus the existing container suite. Verify by running the existing widget tests.

**Step 1: `ghostCandidates` participant mapping** (~line 512)

Inside the `.map(([id, p]) => { ... return { ... } })`, add two fields after `avatarSrc: ident.avatarSrc,`:

```javascript
            equipment: p.equipment || null,
            // Gauge scale of the recording equipment, resolved here (the recap
            // has no bikes config). Default 120 for records predating the field.
            gaugeMaxRpm: resolveRpmLimits(bikeById.get(p.equipment) || {}).gaugeMaxRpm,
```

Then add `bikeById` to the `useMemo` dependency array: `[pastRaces, getDisplayLabel]` → `[pastRaces, getDisplayLabel, bikeById]`. (`resolveRpmLimits` is already imported — used at line ~868.)

**Step 2: `onSelectGhost` rider mapping** (~line 1103)

In the returned rider object, after `displayName: ...`, add:

```javascript
        equipmentId: p.equipment || null,
```

**Step 3: `buildRiders` ghost push** (~line 192)

Change `equipmentId: null,` to:

```javascript
          // The recording equipment — drives the gauge's maxRpm and the synth-rpm
          // wheel size. Distance still replays from the recorded series (the ghost
          // branch in the engine), so this never double-applies wheel physics.
          equipmentId: g.equipmentId || null,
```

Leave `wheelCircumferenceM: 0` — the engine's ghost branch never converts rpm to distance, and the container resolves wheel size from `bikeById` when it needs it.

**Step 4: Run existing tests to verify no regression**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.test.jsx`
Expected: PASS.

**Step 5: Stage**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
```

---

### Task 4: Container racing block — engine speed, synth rpm, identity resolver

Replaces the baseline diff's IIFE in the `riderLive` construction (lines ~1334-1345). Ghost speed now comes from the engine (interval-aware, windowed, finish-zeroed). For ghosts with no recorded rpm (`hasRpmData === false`), synthesize a display cadence from speed + wheel size so the needle doesn't park at 0 under a moving km/h readout. `wheelM` is now genuinely used by both branches (resolves finding 9 by making it shared, not by moving it). Also fixes the naive `sourceId` parse (finding 6, container half).

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` (lines ~1319-1345)

**Step 1: Fix `sourceId`** (~line 1322)

Replace:

```javascript
      const sourceId = isGhostRider ? userId.split(':')[2] : userId;
```

with (helper already imported at the top of this file):

```javascript
      const sourceId = isGhostRider ? resolveParticipantIdentity(userId).sourceId : userId;
```

**Step 2: Replace the speed/rpm block** (~lines 1325-1345)

Replace everything from `const cadence = ...` through `const speedKmh = ...` (i.e. the baseline diff's version, including the IIFE) with:

```javascript
      const cadence = isGhostRider ? null : session?.getEquipmentCadence?.(rider.equipmentId);
      const vitals = isGhostRider ? {} : (getUserVitals?.(userId) || {});
      // Ghosts replay their recorded rpm + zone; live riders read cadence/vitals.
      const zoneId = isGhostRider ? (rider.zoneId || null) : (vitals.zoneId || null);
      const wheelM = Number.isFinite(rider.wheelCircumferenceM) && rider.wheelCircumferenceM > 0
        ? rider.wheelCircumferenceM
        : (bikeById.get(rider.equipmentId)?.wheel_circumference_m || 0);
      // Ghost speed comes from the engine (windowed distance delta, already 0
      // once finished). Records predating rpm_series have no cadence to replay —
      // synthesize one from speed + wheel size so the needle doesn't park at 0
      // under a moving km/h. (Approximate: recorded distance bakes in the zone
      // boost, so the synth needle overreads during boosted stretches.)
      const ghostSpeedKmh = Number.isFinite(rider.speedKmh) ? rider.speedKmh : 0;
      const ghostRpm = rider.hasRpmData === false && wheelM > 0
        ? (ghostSpeedKmh / 3.6 / wheelM) * 60
        : (Number.isFinite(rider.rpm) ? rider.rpm : 0);
      const liveRpm = isGhostRider ? ghostRpm : (cadence && cadence.connected ? cadence.rpm : 0);
      const effRpm = isFinished ? 0 : liveRpm;
      const mult = isFinished ? 1 : zoneMultiplierFor(zoneId, zones, hrlessMultiplier);
      // Live speed = the SAME physics the engine uses to accrue distance, taken
      // per second (rpm/60 rotations) → km/h.
      const speedKmh = isGhostRider ? ghostSpeedKmh : computeDistanceDelta(effRpm / 60, wheelM, mult) * 3.6;
```

(Everything below — the `riderLive[userId] = { rpm: effRpm, speedKmh, ... }` object — stays as it is in the working tree.)

**Step 3: Run the widget + lib suites**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/CycleGame/ frontend/src/modules/Fitness/lib/cycleGame/`
Expected: PASS.

**Step 4: Stage**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
```

---

### Task 5: RaceRecap — identity SSOT, windowed speed, maxRpm

Replaces the baseline diff's recap changes. Identity (isGhost, avatar) passes through from the candidate when present and falls back to `resolveParticipantIdentity` (which handles nested `ghost:R2:ghost:R1:user` ids — never `split(':')[2]`). Speed uses `windowedSeriesKmh`; a rider whose series has ended (finished early, replay continues) reads 0. `maxRpm` threads from the candidate's `gaugeMaxRpm` (Task 3).

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.jsx`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.test.jsx`

**Step 1: Write the failing tests**

Append inside the existing `describe('RaceRecap', ...)` block in `RaceRecap.test.jsx`:

```jsx
  it('shows a km/h hero derived from the recorded distance series', () => {
    const { getAllByTestId } = render(<RaceRecap candidate={candidate} onClose={() => {}} />);
    // t=0: first sample = 20 m over 1 s → 72 km/h
    expect(getAllByTestId('cycle-speedometer-speed')[0].textContent).toContain('72');
  });

  it('applies ghost styling and resolves the source avatar for ghost participants', () => {
    const ghostCand = {
      ...candidate,
      participants: [
        candidate.participants[0],
        { id: 'ghost:20260601090000:ghost:20260501080000:dad', displayName: 'Dad 👻',
          distanceSeries: JSON.stringify([10, 50, 90]), hrSeries: JSON.stringify([]),
          finalDistanceM: 90, finalTimeS: null, placement: 2 }
        // no avatarSrc, no isGhost → recap must fall back to resolveParticipantIdentity,
        // which takes the FINAL segment of a nested ghost id ('dad'), never [2] ('ghost').
      ]
    };
    const { container } = render(<RaceRecap candidate={ghostCand} onClose={() => {}} />);
    expect(container.querySelector('.cycle-speedometer__avatar.cg-ghost')).toBeTruthy();
    const srcs = [...container.querySelectorAll('img')].map((el) => el.getAttribute('src') || '');
    expect(srcs.some((s) => s.endsWith('/users/dad'))).toBe(true);
    expect(srcs.some((s) => s.endsWith('/users/ghost'))).toBe(false);
  });

  it('threads the per-equipment gauge max into the recap speedometers', () => {
    const cand = { ...candidate, participants: [{ ...candidate.participants[0], gaugeMaxRpm: 250 }] };
    const { container } = render(<RaceRecap candidate={cand} onClose={() => {}} />);
    const labels = [...container.querySelectorAll('.cycle-speedometer__tick-label')]
      .map((el) => Number(el.textContent));
    expect(labels.some((n) => n > 120)).toBe(true); // 120-default dial never labels past 120
  });
```

Note for the avatar assertion: `CircularUserAvatar` may render the avatar as a CSS background instead of `<img>`. If the `img` query finds nothing, check how `CircularUserAvatar` renders (`frontend/src/modules/Fitness/components/CircularUserAvatar.jsx`) and assert on that mechanism instead (e.g. `style.backgroundImage`). The two assertions that MUST hold: ghost styling class present, and the string `/users/ghost` absent from whatever carries the avatar URL.

**Step 2: Run to verify failure**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.test.jsx`
Expected: the speed test may PASS already (baseline diff added speedKmh); the ghost-identity test FAILS (nested id resolves to 'ghost' with the baseline `split(':')[2]`); the gauge-max test FAILS (no maxRpm threaded). Existing 3 tests still pass.

**Step 3: Implement**

In `RaceRecap.jsx`:

(a) Add imports (after the `LINE_COLORS` import):

```javascript
import resolveParticipantIdentity from '@/modules/Fitness/lib/cycleGame/participantIdentity.js';
import { windowedSeriesKmh } from '@/modules/Fitness/lib/cycleGame/speed.js';
```

(b) Replace the `decoded` useMemo's parts mapping (lines ~23-34) with:

```javascript
    const parts = (candidate?.participants || []).map((p, idx) => {
      // Candidates from the lobby rail arrive with identity already resolved
      // (isGhost/avatarSrc via resolveParticipantIdentity upstream); the resolver
      // is the fallback for callers passing bare persisted records. It handles
      // nested ghost ids (ghost:R2:ghost:R1:user → final segment), so never
      // re-parse the id by hand here.
      const ident = resolveParticipantIdentity(p.id, p.displayName);
      return {
        id: p.id,
        isGhost: p.isGhost ?? ident.isGhost,
        displayName: p.displayName || ident.displayName,
        avatarSrc: p.avatarSrc || ident.avatarSrc,
        maxRpm: Number.isFinite(p.gaugeMaxRpm) ? p.gaugeMaxRpm : null,
        color: LINE_COLORS[idx % LINE_COLORS.length],
        dist: SessionSerializerV3.decodeSeries(p.distanceSeries) || [],
        hr: SessionSerializerV3.decodeSeries(p.hrSeries) || [],
        rpm: SessionSerializerV3.decodeSeries(p.rpmSeries) || [],
        finalDistanceM: p.finalDistanceM ?? 0,
        finalTimeS: p.finalTimeS ?? null,
        placement: p.placement ?? null
      };
    });
```

(c) Replace the riders/riderLive loop body (lines ~61-86, the baseline-diff version) with:

```javascript
  decoded.parts.forEach((p) => {
    const distNow = sampleAt(p.dist, t);
    riders[p.id] = {
      userId: p.id,
      displayName: p.displayName,
      equipmentId: null,
      cumulativeDistanceM: distNow,
      distanceSeries: p.dist.slice(0, t + 1),
      finishTimeS: p.finalTimeS,
      isGhost: p.isGhost
    };
    const hr = p.hr.length ? p.hr[Math.min(t, p.hr.length - 1)] : null;
    const rpm = p.rpm.length ? p.rpm[Math.min(t, p.rpm.length - 1)] : 0;
    riderLive[p.id] = {
      rpm: Number.isFinite(rpm) ? Math.round(rpm) : 0,
      // Windowed so the integer-metre series doesn't strobe at replay speed;
      // a rider whose series has ended is parked at the line → 0.
      speedKmh: t < p.dist.length ? windowedSeriesKmh(p.dist, t, intervalS) : 0,
      maxRpm: p.maxRpm ?? undefined,
      avatarSrc: p.avatarSrc,
      heartRate: Number.isFinite(hr) ? hr : null,
      zoneId: null,
      zoneColor: p.color,
      zoneProgress: null,
      multiplier: 1
    };
  });
```

Note: `intervalS` is declared a few lines ABOVE this loop (`const intervalS = candidate?.intervalSeconds || 1;` at ~line 56) but the `decoded` useMemo is earlier — keep the speed computation here in the loop (not in the useMemo) so it can see `intervalS` and `t`. The redundant `|| 1` divisor guard from the baseline diff disappears with this rewrite (finding 10).

**Step 4: Run to verify pass**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.test.jsx`
Expected: PASS (6 tests).

**Step 5: Stage**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.jsx frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.test.jsx
```

---

### Task 6: Full verification

**Step 1: Run the complete cycle-game surface**

```bash
npx vitest run frontend/src/modules/Fitness/lib/cycleGame/ frontend/src/modules/Fitness/widgets/CycleGame/
```

Expected: ALL PASS. Any failure is a real regression — fix it before proceeding (No Excuses Policy).

**Step 2: Review the final diff as a whole**

```bash
git diff HEAD
git status --short
```

Confirm the diff contains ONLY: `speed.js` + test, `CycleRaceEngine.js` + test, `CycleGameContainer.jsx`, `RaceRecap.jsx` + test, and this plan file. Confirm the baseline IIFE and the `split(':')[2]` parses are gone (`grep -n "split(':')\[2\]" frontend/src/modules/Fitness/widgets/CycleGame/*.jsx` → no matches).

**Step 3: Hand off to KC**

Do NOT commit. Summarize the change set for KC's review, noting:
- Visual check on the garage kiosk after deploy: race a ghost, watch for (a) steady km/h on the ghost gauge, (b) 0 km/h the moment the ghost finishes, (c) correct gauge scale for a tricycle-recorded ghost.
- Recap replays of pre-June-4 records (no rpm_series) now show a synthesized needle — flag if that reads oddly.
