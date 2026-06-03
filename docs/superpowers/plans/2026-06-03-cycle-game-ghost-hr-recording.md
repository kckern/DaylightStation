# Cycle Game — Ghost HR Recording & Tip Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record each rider's heart-rate series during a cycle race, persist it in the saved race record, and replay it for ghost riders so the race screen shows the ghost's historical HR at its line tip.

**Architecture:** The pure `CycleRaceEngine` already records a per-rider `distanceSeries`. We add a symmetric `hrSeries` (driven by a new `heartRate` field on tick inputs). Ghost riders replay a supplied `ghostHrSeries` (interpolated by elapsed time, exactly like `ghostSeries`) and expose a per-tick `heartRate` in `getState()`. `buildRaceRecord` encodes `hr_series` per participant (RLE via `SessionSerializerV3`). Ghost selection decodes it back into the ghost rider config, and the live container threads HR into tick inputs and reads the engine-provided HR for ghosts.

**Tech Stack:** React (frontend), Vitest (colocated `*.test.js`), the existing `SessionSerializerV3` RLE encoder.

**Context — how it works today (read these first):**
- `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js` — pure engine. Each rider object has `distanceSeries: []`; `tick(inputs)` reads `inputs[userId] = { rpm, zoneId }`. Ghost riders carry `ghostArr` (built from `r.ghostSeries`, with a leading 0) and `ghostIntervalS`; `_ghostDistanceAt(rider, t)` interpolates. `getState()` returns per-rider `{ userId, displayName, equipmentId, cumulativeDistanceM, distanceSeries, finishTimeS, isGhost }`.
- `frontend/src/modules/Fitness/lib/cycleGame/raceRecord.js` — `buildRaceRecord(state, meta)` writes `participants[userId] = { display_name, equipment, final_distance_m, final_time_s, placement, distance_series }` where `distance_series = SessionSerializerV3.encodeSeries(r.distanceSeries || [])`.
- `frontend/src/hooks/fitness/SessionSerializerV3.js` — `encodeSeries(arr)` → RLE string (or `null` for empty); `decodeSeries(str)` → array.
- `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx`:
  - The race interval builds `inputs[userId] = { rpm: ..., zoneId: ... }` from `getEquipmentCadence` + `getUserVitals` (vitals already include `heartRate`).
  - `onSelectGhost(candidate)` builds `ghost.riders[]` with `{ userId: 'ghost:<raceId>:<id>', displayName, ghostSeries, ghostIntervalS }`.
  - `buildRiders()` pushes ghost riders with `{ ghostSeries, ghostIntervalS }`.
  - `ghostCandidates` maps each saved participant to `{ id, displayName, avatarSrc, distanceSeries, finalDistanceM, finalTimeS, placement }` — it does NOT yet carry `hr_series`.
  - The racing render builds `riderLive[userId]`: for ghosts it currently sets `heartRate: null`; for real riders `heartRate: vitals.heartRate`.
- `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx` — the line tip already renders `riderLive[id].heartRate` when finite (`__tag-hr`). No change needed there once the container supplies ghost HR.

**Run tests with:** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`

---

### Task 1: Engine records an HR series for live riders

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`

- [ ] **Step 1: Write the failing test** (append to the existing file)

```js
describe('CycleRaceEngine — HR series', () => {
  it('records each tick\'s heart rate into hrSeries and exposes latest heartRate', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 30, intervalMs: 1000,
      riders: [{ userId: 'a', wheelCircumferenceM: 2 }]
    });
    e.tick({ a: { rpm: 60, zoneId: 'hot', heartRate: 150 } });
    e.tick({ a: { rpm: 60, zoneId: 'hot', heartRate: 162 } });
    const s = e.getState();
    expect(s.riders.a.hrSeries).toEqual([150, 162]);
    expect(s.riders.a.heartRate).toBe(162);
  });

  it('records null when no heart rate is present', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 30, intervalMs: 1000,
      riders: [{ userId: 'a', wheelCircumferenceM: 2 }]
    });
    e.tick({ a: { rpm: 60, zoneId: 'hot' } });
    expect(e.getState().riders.a.hrSeries).toEqual([null]);
    expect(e.getState().riders.a.heartRate).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`
Expected: FAIL — `hrSeries` is `undefined`.

- [ ] **Step 3: Implement HR recording in the engine**

In the constructor's `for (const r of riders)` block, add two fields to the stored rider object (alongside `distanceSeries: []`):

```js
        hrSeries: [],
        heartRate: null,
```

In `tick(inputs)`, inside the `for (const rider of this.riders.values())` loop, AFTER the `rider.distanceSeries.push(...)` line and BEFORE the finish check, add:

```js
      const hr = Number.isFinite(input.heartRate) ? input.heartRate : null;
      rider.heartRate = hr;
      rider.hrSeries.push(hr);
```

Note: `input` is already defined in the non-ghost branch as `inputs[rider.userId] || {}`. The ghost branch (Task 2) does not define `input`, so this line must live in a place where `input` exists for BOTH branches. Refactor the tick loop so `input` is read once at the top of the loop body:

```js
    for (const rider of this.riders.values()) {
      const input = inputs[rider.userId] || {};
      if (rider.isGhost) {
        rider.cumulativeDistanceM = this._ghostDistanceAt(rider, this.elapsedS);
      } else {
        const rpm = Number.isFinite(input.rpm) ? input.rpm : 0;
        const rotationsDelta = rpm > 0 ? (rpm / 60) * this.intervalSeconds : 0;
        const mult = zoneMultiplierFor(input.zoneId ?? null, this.zones, this.hrlessMultiplier);
        rider.cumulativeDistanceM += computeDistanceDelta(rotationsDelta, rider.wheelCircumferenceM, mult);
      }
      rider.distanceSeries.push(Math.round(rider.cumulativeDistanceM));
      const hr = Number.isFinite(input.heartRate) ? input.heartRate : null;
      rider.heartRate = hr;
      rider.hrSeries.push(hr);
      if (this.winCondition === 'distance' && rider.finishTimeS == null && rider.cumulativeDistanceM >= this.goalM) {
        rider.finishTimeS = this.elapsedS;
      }
    }
```

In `getState()`, add to the per-rider mapped object (alongside `distanceSeries`):

```js
        hrSeries: r.hrSeries.slice(),
        heartRate: r.heartRate ?? null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`
Expected: PASS (existing engine tests still pass too).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js
git commit -m "feat(cycle-game): engine records per-rider HR series"
```

---

### Task 2: Engine replays a ghost's recorded HR

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
describe('CycleRaceEngine — ghost HR replay', () => {
  it('replays a ghost hr series sampled at the elapsed time', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 30, intervalMs: 1000,
      riders: [{ userId: 'g', ghostSeries: [10, 20, 30], ghostHrSeries: [140, 150, 160], ghostIntervalS: 1 }]
    });
    e.tick({}); // t=1s
    expect(e.getState().riders.g.heartRate).toBe(140);
    e.tick({}); // t=2s
    expect(e.getState().riders.g.heartRate).toBe(150);
  });

  it('reports null ghost HR when no hr series was recorded', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 30, intervalMs: 1000,
      riders: [{ userId: 'g', ghostSeries: [10, 20], ghostIntervalS: 1 }]
    });
    e.tick({});
    expect(e.getState().riders.g.heartRate).toBeNull();
  });
});
```

Note the expected sampling: with `ghostHrSeries: [140,150,160]` at `ghostIntervalS=1`, sample index = `round(t/intervalS) - 1` so t=1s→index 0→140, t=2s→index 1→150. (HR is a step value, not a distance accumulation, so use nearest-sample, not the leading-zero interpolation used for distance.)

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`
Expected: FAIL — ghost `heartRate` is `null`.

- [ ] **Step 3: Implement ghost HR replay**

In the constructor rider object, when `isGhost`, store the raw HR samples (no leading-zero prepend — HR is not cumulative):

```js
        ghostHrArr: isGhost && Array.isArray(r.ghostHrSeries) ? r.ghostHrSeries.map((v) => (Number.isFinite(v) ? v : null)) : null,
```

Add a sampler method next to `_ghostDistanceAt`:

```js
  // Nearest-sample lookup for replayed step values (HR). Samples are at times
  // intervalS, 2*intervalS, ... so the value at elapsed t is index round(t/dt)-1.
  _ghostSampleAt(arr, t, intervalS) {
    if (!arr || !arr.length) return null;
    const idx = Math.min(arr.length - 1, Math.max(0, Math.round(t / intervalS) - 1));
    const v = arr[idx];
    return Number.isFinite(v) ? v : null;
  }
```

In the tick loop, replace the HR capture so ghosts use their replayed HR while live riders use the input HR:

```js
      const hr = rider.isGhost
        ? this._ghostSampleAt(rider.ghostHrArr, this.elapsedS, rider.ghostIntervalS)
        : (Number.isFinite(input.heartRate) ? input.heartRate : null);
      rider.heartRate = hr;
      rider.hrSeries.push(hr);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js
git commit -m "feat(cycle-game): engine replays ghost HR series"
```

---

### Task 3: Persist HR series in the race record

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/raceRecord.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/raceRecord.test.js`

- [ ] **Step 1: Write the failing test** (append a case to the existing describe block)

```js
import { SessionSerializerV3 } from '@/hooks/fitness/SessionSerializerV3.js';

it('encodes each participant hr_series from the engine hrSeries', () => {
  const state = {
    riders: {
      a: { userId: 'a', displayName: 'A', equipmentId: 'cycle_ace', cumulativeDistanceM: 100, finishTimeS: 50, distanceSeries: [50, 100], hrSeries: [150, 160] }
    },
    standings: [{ userId: 'a', placement: 1 }]
  };
  const rec = buildRaceRecord(state, { raceId: '20260603120000', date: 'x', mode: 'simultaneous', winCondition: 'distance', goalM: 100, intervalSeconds: 1 });
  expect(rec.participants.a.hr_series).toBe(SessionSerializerV3.encodeSeries([150, 160]));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/raceRecord.test.js`
Expected: FAIL — `hr_series` is `undefined`.

- [ ] **Step 3: Implement**

In `raceRecord.js`, in the `Object.values(state?.riders || {}).forEach((r) => { participants[r.userId] = {...} })` block, add one field alongside `distance_series`:

```js
      hr_series: SessionSerializerV3.encodeSeries(r.hrSeries || [])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/raceRecord.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/raceRecord.js frontend/src/modules/Fitness/lib/cycleGame/raceRecord.test.js
git commit -m "feat(cycle-game): persist HR series in race record"
```

---

### Task 4: Thread live HR into tick inputs + ghost HR into the replay (container)

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx`

There is no colocated unit test for the container's interval wiring (it's covered by the live Playwright lifecycle test). Verify by reading + the E2E. Steps:

- [ ] **Step 1: Add `heartRate` to the race-tick inputs**

In the race interval, where `inputs[userId]` is built (currently `{ rpm, zoneId }`), add the live HR:

```js
        inputs[userId] = {
          rpm: cadence && cadence.connected ? cadence.rpm : 0,
          zoneId: vitals?.zoneId || null,
          heartRate: Number.isFinite(vitals?.heartRate) ? vitals.heartRate : null
        };
```

- [ ] **Step 2: Carry `hr_series` through `ghostCandidates`**

In the `ghostCandidates` participant map, add `hrSeries: p.hr_series || null` to each participant object (alongside `distanceSeries: p.distance_series || null`).

- [ ] **Step 3: Decode ghost HR on selection**

In `onSelectGhost(candidate)`, when building `riders`, add the decoded HR series:

```js
      ghostHrSeries: SessionSerializerV3.decodeSeries(p.hrSeries) || [],
```

- [ ] **Step 4: Pass ghost HR through `buildRiders`**

In `buildRiders()`, the `ghost.riders.forEach((g) => riders.push({...}))` block, add:

```js
          ghostHrSeries: g.ghostHrSeries,
```

- [ ] **Step 5: Use the engine's replayed HR for ghost riders in `riderLive`**

In the racing render's `riderLive` builder, set HR from the engine for ghosts (it replays the recording) and from live vitals otherwise:

```js
        heartRate: isGhostRider
          ? (Number.isFinite(riders[userId].heartRate) ? riders[userId].heartRate : null)
          : (vitals.heartRate ?? null),
```

(`riders` here is `snapshot.engineState.riders`, which now exposes `heartRate` from Task 1/2. `isGhostRider` is already computed in this block.)

- [ ] **Step 6: Verify the colocated suites still pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/ frontend/src/modules/Fitness/lib/cycleGame/`
Expected: PASS (138+ tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
git commit -m "feat(cycle-game): record live HR + show ghost HR at the line tip"
```

---

### Task 5: Live verification (deploy + E2E)

- [ ] **Step 1: Build + deploy** (kckern-server, deploy-at-will)

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 2: Run the lifecycle E2E and capture the real exit code**

```bash
TEST_FRONTEND_URL=http://localhost:3111 \
DAYLIGHT_MEDIA_LOGS_FITNESS=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/logs/fitness \
npx playwright test tests/live/flow/fitness/cycle-game-lifecycle.runtime.test.mjs --config playwright.prod.config.mjs --reporter=line; echo "PW_EXIT=$?"
```
Expected: `3 passed`. (Note: a freshly-recorded race must run before ghost HR is visible; the E2E records races, so `hr_series` should appear in `GET /api/v1/fitness/cycle-races?date=<today>`.)

- [ ] **Step 3: Spot-check the record carries `hr_series`**

```bash
curl -s "http://localhost:3111/api/v1/fitness/cycle-races?date=$(date +%Y-%m-%d)" | grep -o 'hr_series' | head
```
Expected: at least one `hr_series` (non-null when riders had HR; null when the simulator drove no HR — acceptable).

---

## Notes / gotchas
- **Backward compatibility:** old records have no `hr_series`. `decodeSeries(undefined)` returns `[]`, `ghostHrArr` is empty, and `_ghostSampleAt` returns `null` — old ghosts simply show no HR. No migration needed.
- **The race-screen tip already renders HR** (`CycleRaceScreen.__tag-hr`); this plan only needs to make the container *supply* it for ghosts. No CycleRaceScreen change.
- **Do NOT** apply the distance leading-zero interpolation to HR — HR is a step sample, use `_ghostSampleAt` (nearest), as specified in Task 2.
