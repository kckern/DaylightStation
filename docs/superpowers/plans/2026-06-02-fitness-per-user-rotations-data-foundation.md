# Per-User Cumulative Rotations — Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attribute pedal rotations to the rider currently claiming each bike, accumulating a per-user total (the rider's own work) and a session-wide total, and persist both into the saved session — mirroring how coins/heart-beats already work.

**Architecture:** `TreasureBox` becomes the home for rotation totals (exactly parallel to coins): it owns a global `_totalRotations` and a per-user `_perUserRotations` Map. `TimelineRecorder.recordTick()` computes each tick's rotation delta per cadence device (preferring the hardware crank counter, falling back to integrating RPM), looks up the equipment's claimed rider via an injected resolver, and attributes the delta to that rider only — unassigned bikes are dropped, and deltas never transfer on a swap because each lands on whoever is claimed *now*. The recorder reads the totals back into timeline series (`global:rotations_total`, `user:{id}:rotations_total`) and also dyes live RPM onto the rider (`user:{id}:rpm`). `SessionSerializerV3` emits `totals.rotations` and per-participant `total_rotations`.

**Tech Stack:** Plain ES modules under `frontend/src/hooks/fitness/`. Tests are colocated `*.test.js` files importing from `vitest` (same pattern as `FitnessSession.equipmentRider.test.js`), run with `./node_modules/.bin/vitest run --config vitest.config.mjs <path>`.

**Scope note:** This is Plan #1 of four. It is the data foundation that unblocks the follow-ons: (#2) on-screen rider-assignment modal, (#3) roster-card RPM enrichment, (#4) session-detail timeline RPM rail. This plan produces working, testable software on its own.

**Known limitation (handled in #2):** A guest rider with no HR strap will get a `user:{id}:rotations_total` *timeline series* but no entry in the participant *summary* block, because the summary iterates `participantsMeta` (built from roster + HR device assignments). Adding bike-only riders to the roster is Plan #2's concern; do not solve it here.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/src/hooks/fitness/TreasureBox.js` | Owns coin + rotation totals (global + per-user) | Add rotation state, `addRotations()`, `totalRotations` getter, `getPerUserRotationTotals()`, include `totalRotations` in `summary`, clear on `reset()` |
| `frontend/src/hooks/fitness/TimelineRecorder.js` | Per-tick metric recording + cumulative attribution | Inject `resolveEquipmentRider`, track prev crank counter, attribute rotation delta to rider, dye rider RPM, write rotation series |
| `frontend/src/hooks/fitness/SessionSerializerV3.js` | v3 session serialization | Emit `totals.rotations`, per-participant `total_rotations`, map `rotations_total`→`rotations` |
| `frontend/src/hooks/fitness/FitnessSession.js` | Wires recorder dependencies | Pass `resolveEquipmentRider` into `_timelineRecorder.configure()` |
| `frontend/src/hooks/fitness/TreasureBox.rotations.test.js` | Unit test (new) | TreasureBox rotation accumulation |
| `frontend/src/hooks/fitness/TimelineRecorder.rotations.test.js` | Unit test (new) | Rider attribution + delta math |
| `frontend/src/hooks/fitness/SessionSerializerV3.rotations.test.js` | Unit test (new) | Serialized rotation fields |

---

## Task 1: TreasureBox owns rotation totals

**Files:**
- Modify: `frontend/src/hooks/fitness/TreasureBox.js` (constructor ~line 25, `reset()` ~line 166, `summary` getter ~line 703, new methods near `getPerUserTotals` ~line 735)
- Test: `frontend/src/hooks/fitness/TreasureBox.rotations.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/TreasureBox.rotations.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { FitnessTreasureBox } from './TreasureBox.js';

describe('FitnessTreasureBox — rotations', () => {
  it('starts at zero', () => {
    const box = new FitnessTreasureBox();
    expect(box.totalRotations).toBe(0);
    expect(box.getPerUserRotationTotals().size).toBe(0);
  });

  it('accumulates per-user and global totals', () => {
    const box = new FitnessTreasureBox();
    box.addRotations('user_3', 10);
    box.addRotations('user_3', 5);
    box.addRotations('user_2', 7);
    expect(box.getPerUserRotationTotals().get('user_3')).toBe(15);
    expect(box.getPerUserRotationTotals().get('user_2')).toBe(7);
    expect(box.totalRotations).toBe(22);
  });

  it('ignores missing user, zero, and negative deltas', () => {
    const box = new FitnessTreasureBox();
    box.addRotations(null, 10);
    box.addRotations('user_3', 0);
    box.addRotations('user_3', -3);
    box.addRotations('user_3', NaN);
    expect(box.totalRotations).toBe(0);
    expect(box.getPerUserRotationTotals().size).toBe(0);
  });

  it('exposes totalRotations in summary', () => {
    const box = new FitnessTreasureBox();
    box.addRotations('user_3', 12);
    expect(box.summary.totalRotations).toBe(12);
  });

  it('returns a defensive copy from getPerUserRotationTotals', () => {
    const box = new FitnessTreasureBox();
    box.addRotations('user_3', 4);
    const snap = box.getPerUserRotationTotals();
    snap.set('user_3', 999);
    expect(box.getPerUserRotationTotals().get('user_3')).toBe(4);
  });

  it('clears rotation state on reset', () => {
    const box = new FitnessTreasureBox();
    box.addRotations('user_3', 8);
    box.reset();
    expect(box.totalRotations).toBe(0);
    expect(box.getPerUserRotationTotals().size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/TreasureBox.rotations.test.js`
Expected: FAIL — `box.addRotations is not a function` / `totalRotations` undefined.

- [ ] **Step 3: Add rotation state to the constructor**

In `TreasureBox.js`, immediately after `this.perUser = new Map(); // userId -> accumulator` (line 25):

```js
    this._totalRotations = 0;           // global cumulative pedal rotations (session)
    this._perUserRotations = new Map(); // userId -> cumulative pedal rotations
```

- [ ] **Step 4: Clear rotation state in `reset()`**

In `reset()`, immediately after `this.perUser.clear();` (line 168):

```js
    this._totalRotations = 0;
    this._perUserRotations.clear();
```

- [ ] **Step 5: Add `totalRotations` to the `summary` getter**

Change the `summary` getter (lines 703–710) to include `totalRotations`:

```js
  get summary() {
    // Derive session timing from owning sessionRef (if available and started)
    return {
      coinTimeUnitMs: this.coinTimeUnitMs,
      totalCoins: this.totalCoins,
      totalRotations: this._totalRotations,
      buckets: { ...this.buckets }
    };
  }
```

- [ ] **Step 6: Add the rotation methods**

Immediately after the `getPerUserTotals()` method (ends ~line 743), add:

```js
  /**
   * Accumulate pedal rotations for a rider. Rotations are the rider's own work and
   * never transfer between users — callers attribute each tick's delta to the
   * currently-claimed rider only (unassigned bikes are dropped before calling).
   * @param {string} userId
   * @param {number} delta - rotations to add this tick (must be > 0)
   */
  addRotations(userId, delta) {
    if (!userId || !Number.isFinite(delta) || delta <= 0) return;
    this._totalRotations += delta;
    const prev = this._perUserRotations.get(userId) || 0;
    this._perUserRotations.set(userId, prev + delta);
  }

  /** @returns {number} global cumulative rotations for the session */
  get totalRotations() {
    return this._totalRotations;
  }

  /** @returns {Map<string, number>} defensive copy of per-user cumulative rotations */
  getPerUserRotationTotals() {
    return new Map(this._perUserRotations);
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/TreasureBox.rotations.test.js`
Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/fitness/TreasureBox.js frontend/src/hooks/fitness/TreasureBox.rotations.test.js
git commit -m "feat(fitness): TreasureBox tracks per-user + global pedal rotations"
```

---

## Task 2: TimelineRecorder attributes rotation delta to the rider

**Files:**
- Modify: `frontend/src/hooks/fitness/TimelineRecorder.js` (constructor ~line 82/86, `configure()` ~line 117, `reset()` ~line 175, device loop ~line 308/334, read-back after TreasureBox block ~line 516)
- Test: `frontend/src/hooks/fitness/TimelineRecorder.rotations.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/TimelineRecorder.rotations.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { TimelineRecorder } from './TimelineRecorder.js';

// Minimal fakes ----------------------------------------------------------

function makeDevice(id, { rpm = null, revolutionCount = null } = {}) {
  return {
    id,
    inactiveSince: null,
    getMetricsSnapshot: () => ({ rpm, cadence: rpm, revolutionCount, heartRate: null, power: null, distance: null })
  };
}

function makeTimeline() {
  const series = {};
  return {
    series,
    timebase: { tickCount: 0, intervalMs: 5000 },
    tick(payload) {
      Object.entries(payload).forEach(([k, v]) => {
        if (!series[k]) series[k] = [];
        series[k][this.timebase.tickCount] = v;
      });
      this.timebase.tickCount += 1;
      return { tickIndex: this.timebase.tickCount - 1 };
    }
  };
}

function makeTreasureBox() {
  const perUser = new Map();
  let total = 0;
  return {
    _perUser: perUser,
    get totalRotations() { return total; },
    addRotations(userId, delta) {
      if (!userId || !(delta > 0)) return;
      total += delta;
      perUser.set(userId, (perUser.get(userId) || 0) + delta);
    },
    getPerUserRotationTotals() { return new Map(perUser); },
    getPerUserTotals() { return new Map(); },
    processTick() {},
    summary: { totalCoins: 0 }
  };
}

function buildRecorder({ devices, riderFor, treasureBox, timeline }) {
  const recorder = new TimelineRecorder({ intervalMs: 5000 });
  recorder.setTimeline(timeline);
  recorder.configure({
    deviceManager: { getAllDevices: () => devices },
    userManager: { resolveUserForDevice: () => null, assignmentLedger: { get: () => null } },
    treasureBox,
    timeline,
    activityMonitor: { getPreviousTickActive: () => new Set(), recordTick: () => {} },
    eventJournal: { log: () => {} },
    resolveEquipmentId: () => 'bike1',
    resolveEquipmentRider: (equipmentId) => riderFor[equipmentId] || null
  });
  return recorder;
}

// Tests ------------------------------------------------------------------

describe('TimelineRecorder — per-rider rotations', () => {
  it('integrates RPM into the rider when no crank counter is present', () => {
    const timeline = makeTimeline();
    const treasureBox = makeTreasureBox();
    // 60 rpm over a 5s tick = 5 rotations
    const recorder = buildRecorder({
      devices: [makeDevice('cad1', { rpm: 60 })],
      riderFor: { bike1: 'user_3' },
      treasureBox,
      timeline
    });
    recorder.recordTick({ timestamp: 1000, sessionId: 's1' });
    expect(treasureBox.getPerUserRotationTotals().get('user_3')).toBeCloseTo(5, 5);
    expect(timeline.series['user:user_3:rotations_total'][0]).toBeCloseTo(5, 5);
    expect(timeline.series['global:rotations_total'][0]).toBeCloseTo(5, 5);
    expect(timeline.series['user:user_3:rpm'][0]).toBe(60);
  });

  it('drops rotations for an unassigned bike', () => {
    const timeline = makeTimeline();
    const treasureBox = makeTreasureBox();
    const recorder = buildRecorder({
      devices: [makeDevice('cad1', { rpm: 90 })],
      riderFor: {}, // no rider
      treasureBox,
      timeline
    });
    recorder.recordTick({ timestamp: 1000, sessionId: 's1' });
    expect(treasureBox.totalRotations).toBe(0);
    expect(timeline.series['user:user_3:rotations_total']).toBeUndefined();
  });

  it('prefers the hardware crank counter delta and handles 16-bit wrap', () => {
    const timeline = makeTimeline();
    const treasureBox = makeTreasureBox();
    const device = makeDevice('cad1', { rpm: 999, revolutionCount: 65530 });
    const recorder = buildRecorder({
      devices: [device],
      riderFor: { bike1: 'user_3' },
      treasureBox,
      timeline
    });
    // Tick 1 establishes baseline (delta 0), rpm not used for counter path
    recorder.recordTick({ timestamp: 1000, sessionId: 's1' });
    expect(treasureBox.getPerUserRotationTotals().get('user_3') || 0).toBe(0);
    // Tick 2: counter wraps 65530 -> 4  => diff = 4 + 65536 - 65530 = 10
    device.getMetricsSnapshot = () => ({ rpm: 999, cadence: 999, revolutionCount: 4, heartRate: null });
    recorder.recordTick({ timestamp: 6000, sessionId: 's1' });
    expect(treasureBox.getPerUserRotationTotals().get('user_3')).toBe(10);
  });

  it('does not carry rotations across a rider swap (delta lands on current rider)', () => {
    const timeline = makeTimeline();
    const treasureBox = makeTreasureBox();
    const riderFor = { bike1: 'user_3' };
    const device = makeDevice('cad1', { rpm: 60 });
    const recorder = buildRecorder({ devices: [device], riderFor, treasureBox, timeline });
    recorder.recordTick({ timestamp: 1000, sessionId: 's1' }); // user_3 +5
    riderFor.bike1 = 'user_2';                                  // swap
    recorder.recordTick({ timestamp: 6000, sessionId: 's1' }); // user_2 +5
    expect(treasureBox.getPerUserRotationTotals().get('user_3')).toBeCloseTo(5, 5);
    expect(treasureBox.getPerUserRotationTotals().get('user_2')).toBeCloseTo(5, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/TimelineRecorder.rotations.test.js`
Expected: FAIL — no rider attribution; `user:user_3:rotations_total` undefined.

- [ ] **Step 3: Add the resolver field + crank-counter state to the constructor**

In `TimelineRecorder.js`, after `this._resolveEquipmentId = null;` (line 82):

```js
    this._resolveEquipmentRider = null;
```

And after `this._cumulativeRotations = new Map();` (line 86):

```js
    // Per-device previous raw crank revolution counter, for hardware-counter deltas
    this._prevRevolutionCount = new Map();
```

- [ ] **Step 4: Wire the resolver in `configure()`**

In `configure()`, after `this._resolveEquipmentId = deps.resolveEquipmentId || (() => null);` (line 117):

```js
    this._resolveEquipmentRider = deps.resolveEquipmentRider || (() => null);
```

- [ ] **Step 5: Clear crank state in `reset()`**

In `reset()`, after `this._cumulativeRotations.clear();` (line 175):

```js
    this._prevRevolutionCount.clear();
```

- [ ] **Step 6: Capture `revolutionCount` in the device snapshot**

In the device loop, extend `sanitizedDeviceMetrics` (lines 302–308) to include the raw counter:

```js
      const sanitizedDeviceMetrics = {
        rpm: sanitizeNumber(metrics?.rpm ?? metrics?.cadence),
        power: sanitizeNumber(metrics?.power),
        speed: sanitizeNumber(metrics?.speed),
        distance: sanitizeDistance(metrics?.distance),
        heartRate: sanitizeHeartRate(metrics?.heartRate),
        revolutionCount: sanitizeNumber(metrics?.revolutionCount)
      };
```

- [ ] **Step 7: Attribute the rotation delta to the rider**

Immediately after `if (device.inactiveSince) return;` (line 334), before `// Map device to user`, insert:

```js
      // -------------------- Per-Rider Rotation Attribution --------------------
      // Attribute pedal rotations to the equipment's currently-claimed rider.
      // Unassigned bikes are ignored (work is only saved to users). Rotations
      // never transfer on a swap — each tick's delta lands on whoever is claimed
      // now. Prefer the hardware crank counter delta; fall back to integrating RPM.
      const riderId = equipmentId ? this._resolveEquipmentRider(equipmentId) : null;
      if (riderId) {
        const rawCount = sanitizedDeviceMetrics.revolutionCount;
        const prevCount = this._prevRevolutionCount.get(deviceId);
        let deltaRotations = null;
        if (Number.isFinite(rawCount)) {
          if (Number.isFinite(prevCount)) {
            let diff = rawCount - prevCount;
            if (diff < 0) diff += 65536; // 16-bit ANT+ counter wrap
            // Reject implausible jumps (>1000 rotations/tick); fall back to RPM
            deltaRotations = diff <= 1000 ? diff : null;
          } else {
            deltaRotations = 0; // first sample establishes the baseline
          }
          this._prevRevolutionCount.set(deviceId, rawCount);
        }
        if (deltaRotations == null) {
          deltaRotations = Number.isFinite(sanitizedDeviceMetrics.rpm) && sanitizedDeviceMetrics.rpm > 0
            ? (sanitizedDeviceMetrics.rpm / 60) * intervalSeconds
            : 0;
        }
        if (this._treasureBox && deltaRotations > 0) {
          this._treasureBox.addRotations(riderId, deltaRotations);
        }
        // Dye live RPM onto the rider, independent of HR ownership (handles
        // HR-less guests on a bike).
        if (Number.isFinite(sanitizedDeviceMetrics.rpm) && sanitizedDeviceMetrics.rpm > 0) {
          assignUserMetric(riderId, 'rpm', sanitizedDeviceMetrics.rpm);
        }
      }
```

> Note: `equipmentId` is already in scope from line 321 (`const equipmentId = this._resolveEquipmentId(device);`).

- [ ] **Step 8: Read rotation totals back into timeline series**

Immediately after the `// -------------------- TreasureBox Processing --------------------` block closes (after line 516, before the `// Pending Snapshot Reference` block), insert:

```js
    // -------------------- Per-Rider Rotation Series --------------------
    if (this._treasureBox) {
      const totalRotations = this._treasureBox.totalRotations;
      if (Number.isFinite(totalRotations)) {
        assignMetric('global:rotations_total', totalRotations);
      }
      const perUserRotations = typeof this._treasureBox.getPerUserRotationTotals === 'function'
        ? this._treasureBox.getPerUserRotationTotals()
        : null;
      if (perUserRotations) {
        perUserRotations.forEach((rot, userId) => {
          if (!userId) return;
          assignMetric(`user:${userId}:rotations_total`, Number.isFinite(rot) ? rot : null);
        });
      }
    }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/TimelineRecorder.rotations.test.js`
Expected: PASS (4 tests).

- [ ] **Step 10: Run the existing fitness suite to confirm no regression**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/`
Expected: PASS (existing tests green; new tests green).

- [ ] **Step 11: Commit**

```bash
git add frontend/src/hooks/fitness/TimelineRecorder.js frontend/src/hooks/fitness/TimelineRecorder.rotations.test.js
git commit -m "feat(fitness): attribute pedal-rotation delta to the claimed rider"
```

---

## Task 3: Serialize rotation totals into the saved session

**Files:**
- Modify: `frontend/src/hooks/fitness/SessionSerializerV3.js` (`totals` block ~line 63, participant block ~line 82, `METRIC_MAP` ~line 341)
- Test: `frontend/src/hooks/fitness/SessionSerializerV3.rotations.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/SessionSerializerV3.rotations.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { SessionSerializerV3 } from './SessionSerializerV3.js';

describe('SessionSerializerV3 — rotations', () => {
  const base = {
    sessionId: '20260602120000',
    startTime: 1717329600000,
    endTime: 1717330200000, // +600s
    timezone: 'UTC',
    treasureBox: { totalCoins: 40, totalRotations: 123.4, buckets: { red: 40 } },
    participants: {
      user_3: { display_name: 'User_3', is_primary: true }
    },
    timeline: {
      timebase: { intervalMs: 5000, tickCount: 3 },
      series: {
        'user:user_3:heart_rate': [120, 121, 122],
        'user:user_3:rotations_total': [5, 10, 15],
        'user:user_3:rpm': [60, 60, 60],
        'global:rotations_total': [5, 10, 15]
      }
    }
  };

  it('emits session-wide rotations in the totals block', () => {
    const out = SessionSerializerV3.serialize(base);
    expect(out.totals.rotations).toBe(123.4);
    expect(out.totals.coins).toBe(40);
  });

  it('emits per-participant total_rotations from the series', () => {
    const out = SessionSerializerV3.serialize(base);
    expect(out.participants.user_3.total_rotations).toBe(15);
  });

  it('maps the rotations_total series into the timeline under "rotations"', () => {
    const out = SessionSerializerV3.serialize(base);
    expect(out.timeline.participants.user_3.rotations).toBeDefined();
    // rpm passes through unmapped
    expect(out.timeline.participants.user_3.rpm).toBeDefined();
    expect(out.timeline.global.rotations).toBeDefined();
  });

  it('defaults totals.rotations to 0 when treasureBox lacks it', () => {
    const out = SessionSerializerV3.serialize({ ...base, treasureBox: { totalCoins: 1, buckets: {} } });
    expect(out.totals.rotations).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/SessionSerializerV3.rotations.test.js`
Expected: FAIL — `out.totals.rotations` undefined; `total_rotations` undefined; `timeline.participants.user_3.rotations` undefined (series key would map to `rotations_total`, not `rotations`).

- [ ] **Step 3: Add `rotations` to the totals block**

Change the totals block (lines 63–68):

```js
    // Add totals block if treasureBox exists
    if (treasureBox) {
      result.totals = {
        coins: treasureBox.totalCoins,
        rotations: treasureBox.totalRotations || 0,
        buckets: treasureBox.buckets
      };
    }
```

- [ ] **Step 4: Add `total_rotations` to the participant summary**

In the `participantsMeta` loop, add the decode (after line 80) and the field (after `total_beats`, line 92):

```js
        const beatsSeries = this.decodeSeries(series[`user:${userId}:heart_beats`]);
        const rotationsSeries = this.decodeSeries(series[`user:${userId}:rotations_total`]);

        participants[userId] = {
          display_name: meta.display_name,
          is_primary: meta.is_primary || false,
          is_guest: meta.is_guest || false,
          ...(meta.hr_device && { hr_device: meta.hr_device }),
          ...(meta.cadence_device && { cadence_device: meta.cadence_device }),
          coins_earned: this.getLastValue(coinsSeries),
          active_seconds: this.computeActiveSeconds(hrSeries, intervalSeconds),
          zone_time_seconds: this.computeZoneTime(zoneSeries, intervalSeconds),
          hr_stats: this.computeHrStats(hrSeries),
          total_beats: this.getLastValue(beatsSeries),
          total_rotations: this.getLastValue(rotationsSeries)
        };
```

- [ ] **Step 5: Map `rotations_total` → `rotations` in `METRIC_MAP`**

Change `METRIC_MAP` in `mapSeriesKey()` (lines 341–346):

```js
    const METRIC_MAP = {
      heart_rate: 'hr',
      zone_id: 'zone',
      coins_total: 'coins',
      heart_beats: 'beats',
      rotations_total: 'rotations'
    };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/SessionSerializerV3.rotations.test.js`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/SessionSerializerV3.js frontend/src/hooks/fitness/SessionSerializerV3.rotations.test.js
git commit -m "feat(fitness): persist per-user + session rotation totals in v3 session"
```

---

## Task 4: Wire the rider resolver into FitnessSession

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` (`_timelineRecorder.configure()` call, lines 1715–1723)

> This is integration glue. There is no isolated unit test for the `configure()` call site; it is exercised by the existing live/integration fitness flows and the `TimelineRecorder.rotations.test.js` already proves the resolver contract. Verification is the existing fitness test suite.

- [ ] **Step 1: Pass `resolveEquipmentRider` into the recorder config**

Change the `this._timelineRecorder.configure({ ... })` call (lines 1715–1723) to add the resolver:

```js
    this._timelineRecorder.configure({
      deviceManager: this.deviceManager,
      userManager: this.userManager,
      treasureBox: this.treasureBox,
      timeline: this.timeline,
      activityMonitor: this.activityMonitor,
      eventJournal: this.eventJournal,
      resolveEquipmentId: (device) => this._resolveEquipmentId(device),
      resolveEquipmentRider: (equipmentId) => this.getEquipmentRider(equipmentId)
    });
```

- [ ] **Step 2: Run the full fitness unit suite**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/`
Expected: PASS — all existing colocated fitness tests plus the three new rotation suites are green.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js
git commit -m "feat(fitness): wire equipment-rider resolver into TimelineRecorder"
```

---

## Final Verification

- [ ] **Run the complete fitness unit suite once more**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/`
Expected: All green, including `TreasureBox.rotations`, `TimelineRecorder.rotations`, `SessionSerializerV3.rotations`.

- [ ] **Sanity-check the data contract for the follow-on plans.** Confirm these timeline series/fields now exist after a session with a claimed rider:
  - `user:{id}:rpm` — live cadence dyed to the rider (consumed by Plan #4's RPM rail)
  - `user:{id}:rotations_total` → serialized as `participants.{id}.rotations` + summary `total_rotations`
  - `global:rotations_total` → serialized as `timeline.global.rotations`
  - `totals.rotations` — session-wide cumulative (next to `totals.coins`)

---

## Self-Review Notes

- **Spec coverage:** per-user rotations ✓ (Task 1/2), session-wide total in treasure box ✓ (`totals.rotations`, Task 3), hardware-counter-preferred-with-RPM-fallback ✓ (Task 2 Step 7), unassigned bikes dropped ✓ (Task 2 Step 7 `if (riderId)`), no carry-over on swap ✓ (Task 2 test 4 — accumulator keyed by current rider, `transferCumulativeMetrics` is **not** extended to rotations by design), RPM dyed to rider ✓ (Task 2 Step 7), no backfill ✓ (out of scope).
- **Type consistency:** series metric name is `rotations_total` everywhere (recorder writes it, serializer maps it); TreasureBox method names `addRotations` / `totalRotations` / `getPerUserRotationTotals` used identically in recorder and tests.
- **Deliberately NOT changed:** the existing equipment-keyed `device:{equipmentKey}:rotations` series (lines 320–331) and `transferCumulativeMetrics` rotation transfer (lines 591–597) are left intact — they are independent of the new per-user path and removing them is out of scope for this foundation.
