# Cycle Game — Plan 3: Race Engine + Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** The race's data core — a pure `CycleRaceEngine` (per-rider distance accumulation, finish detection, standings), a pure `buildRaceRecord` (engine state → v1 YAML record with RLE distance series), and a backend `YamlCycleRaceDatastore` (save/find/list under `history/fitness/cycle-races/`).

**Architecture:** The engine and record builder are pure JS (frontend, vitest) reusing Plan-1 `computeDistanceDelta`/`zoneMultiplierFor` and the existing `SessionSerializerV3.encodeSeries` for RLE. The datastore mirrors `YamlSessionDatastore` using `FileIO` + `ConfigService.getHouseholdPath` (backend, jest, temp-dir I/O). The HTTP API that exposes the datastore is wired in **Plan 4** (where the race screen consumes it).

**Tech Stack:** Plain ES modules. vitest (frontend pure) + jest (backend datastore).

**Plan 3 of 5.** Depends on Plan 1 (`distanceModel`) and the existing `SessionSerializerV3`, `FileIO`, `ConfigService`.

**Spec:** `docs/superpowers/specs/2026-06-02-cycle-game-design.md` §2, §6, §8.

---

## Worktree test commands
- vitest (use the WORKTREE config so `@` resolves worktree files): `/opt/Code/DaylightStation/node_modules/.bin/vitest run --config /opt/Code/DaylightStation/.claude/worktrees/cycle-game/vitest.config.mjs <path> --root /opt/Code/DaylightStation/.claude/worktrees/cycle-game`
- jest: `cd /opt/Code/DaylightStation/.claude/worktrees/cycle-game && /opt/Code/DaylightStation/node_modules/.bin/jest --rootDir . --config /opt/Code/DaylightStation/jest.config.js <path>`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js` (+ test) | pure race state: tick accumulation, finish, standings |
| `frontend/src/modules/Fitness/lib/cycleGame/raceRecord.js` (+ test) | pure: engine state → v1 record (RLE series) |
| `backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.mjs` (+ test) | save/findById/findByDate/listDates under `history/fitness/cycle-races/` |

---

## Task 1: `CycleRaceEngine` (pure)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { CycleRaceEngine } from './CycleRaceEngine.js';

const HOT = [{ id: 'hot', distance_multiplier: 2 }];

const distRace = () => new CycleRaceEngine({
  winCondition: 'distance', goalM: 63, intervalMs: 5000, zones: HOT, hrlessMultiplier: 1,
  riders: [
    { userId: 'a', displayName: 'A', equipmentId: 'cycle_ace', wheelCircumferenceM: 2.1 },
    { userId: 'b', displayName: 'B', equipmentId: 'tricycle', wheelCircumferenceM: 1.2 }
  ]
});
const hotInputs = { a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } };

describe('CycleRaceEngine — distance race', () => {
  it('accumulates distance per rider per tick (rpm→rotations→×wheel×zone)', () => {
    const e = distRace();
    e.tick(hotInputs); // a +21, b +12
    const s = e.getState();
    expect(s.riders.a.cumulativeDistanceM).toBe(21);
    expect(s.riders.b.cumulativeDistanceM).toBe(12);
    expect(s.riders.a.distanceSeries).toEqual([21]);
  });
  it('stamps finishTimeS when a rider crosses the goal, finishes when all cross', () => {
    const e = distRace();
    e.tick(hotInputs); e.tick(hotInputs); e.tick(hotInputs); // a=63 @ t=15
    let s = e.getState();
    expect(s.riders.a.finishTimeS).toBe(15);
    expect(s.riders.b.finishTimeS).toBeNull();
    expect(s.finished).toBe(false);
    e.tick(hotInputs); e.tick(hotInputs); e.tick(hotInputs); // b=72 @ t=30
    s = e.getState();
    expect(s.riders.b.finishTimeS).toBe(30);
    expect(s.finished).toBe(true);
    expect(s.standings[0].userId).toBe('a');
    expect(s.standings[0].placement).toBe(1);
    expect(s.standings[1].userId).toBe('b');
  });
  it('ignores ticks after the race is finished', () => {
    const e = distRace();
    for (let i = 0; i < 6; i++) e.tick(hotInputs);
    const elapsed = e.getState().elapsedS;
    e.tick(hotInputs);
    expect(e.getState().elapsedS).toBe(elapsed);
  });
});

describe('CycleRaceEngine — time race', () => {
  it('finishes at the time cap and ranks by distance', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 10, intervalMs: 5000, zones: HOT,
      riders: [{ userId: 'a', wheelCircumferenceM: 2.0 }, { userId: 'b', wheelCircumferenceM: 1.0 }]
    });
    e.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } }); // t=5
    expect(e.getState().finished).toBe(false);
    e.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } }); // t=10
    const s = e.getState();
    expect(s.finished).toBe(true);
    expect(s.standings[0].userId).toBe('a'); // more distance (bigger wheel)
  });
});

describe('CycleRaceEngine — HR-less rider', () => {
  it('uses the hrless multiplier when zoneId is null', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 100, intervalMs: 5000, zones: [], hrlessMultiplier: 1,
      riders: [{ userId: 'a', wheelCircumferenceM: 2.0 }]
    });
    e.tick({ a: { rpm: 60, zoneId: null } }); // 5 rot × 2.0 × 1 = 10
    expect(e.getState().riders.a.cumulativeDistanceM).toBe(10);
  });
});
```

- [ ] **Step 2: Run — must FAIL** (module missing).

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js`:

```js
import { computeDistanceDelta, zoneMultiplierFor } from './distanceModel.js';

/**
 * Pure cycle-race state machine. Feed per-tick rider inputs ({rpm, zoneId});
 * it accumulates each rider's virtual distance (rotations × wheel × zone-mult),
 * stamps finish times (distance race) and computes standings.
 */
export class CycleRaceEngine {
  constructor({
    mode = 'simultaneous', winCondition = 'distance',
    goalM = 3000, timeCapS = 300, intervalMs = 5000,
    riders = [], zones = [], hrlessMultiplier = 1
  } = {}) {
    this.mode = mode;
    this.winCondition = winCondition;
    this.goalM = goalM;
    this.timeCapS = timeCapS;
    this.intervalSeconds = intervalMs / 1000;
    this.zones = zones;
    this.hrlessMultiplier = hrlessMultiplier;
    this.elapsedS = 0;
    this.finished = false;
    this.riders = new Map();
    for (const r of riders) {
      this.riders.set(r.userId, {
        userId: r.userId,
        displayName: r.displayName || r.userId,
        equipmentId: r.equipmentId || null,
        wheelCircumferenceM: Number.isFinite(r.wheelCircumferenceM) ? r.wheelCircumferenceM : 0,
        cumulativeDistanceM: 0,
        distanceSeries: [],
        finishTimeS: null
      });
    }
  }

  tick(inputs = {}) {
    if (this.finished) return this.getState();
    this.elapsedS += this.intervalSeconds;
    for (const rider of this.riders.values()) {
      const input = inputs[rider.userId] || {};
      const rpm = Number.isFinite(input.rpm) ? input.rpm : 0;
      const rotationsDelta = rpm > 0 ? (rpm / 60) * this.intervalSeconds : 0;
      const mult = zoneMultiplierFor(input.zoneId ?? null, this.zones, this.hrlessMultiplier);
      rider.cumulativeDistanceM += computeDistanceDelta(rotationsDelta, rider.wheelCircumferenceM, mult);
      rider.distanceSeries.push(Math.round(rider.cumulativeDistanceM));
      if (this.winCondition === 'distance' && rider.finishTimeS == null && rider.cumulativeDistanceM >= this.goalM) {
        rider.finishTimeS = this.elapsedS;
      }
    }
    this.finished = this.winCondition === 'distance'
      ? [...this.riders.values()].every((r) => r.finishTimeS != null)
      : this.elapsedS >= this.timeCapS;
    return this.getState();
  }

  standings() {
    const riders = [...this.riders.values()];
    if (this.winCondition === 'distance') {
      return riders.slice().sort((a, b) => {
        if (a.finishTimeS != null && b.finishTimeS != null) return a.finishTimeS - b.finishTimeS;
        if (a.finishTimeS != null) return -1;
        if (b.finishTimeS != null) return 1;
        return b.cumulativeDistanceM - a.cumulativeDistanceM;
      }).map((r, i) => ({ userId: r.userId, placement: i + 1, finishTimeS: r.finishTimeS, distanceM: Math.round(r.cumulativeDistanceM) }));
    }
    return riders.slice().sort((a, b) => b.cumulativeDistanceM - a.cumulativeDistanceM)
      .map((r, i) => ({ userId: r.userId, placement: i + 1, finishTimeS: null, distanceM: Math.round(r.cumulativeDistanceM) }));
  }

  getState() {
    return {
      elapsedS: this.elapsedS,
      finished: this.finished,
      winCondition: this.winCondition,
      goalM: this.goalM,
      timeCapS: this.timeCapS,
      riders: Object.fromEntries([...this.riders.values()].map((r) => [r.userId, {
        userId: r.userId,
        displayName: r.displayName,
        equipmentId: r.equipmentId,
        cumulativeDistanceM: Math.round(r.cumulativeDistanceM),
        distanceSeries: r.distanceSeries.slice(),
        finishTimeS: r.finishTimeS
      }])),
      standings: this.standings()
    };
  }
}

export default CycleRaceEngine;
```

- [ ] **Step 4: Run — must PASS** (3 + 1 + 1 = 5 tests).
- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.js frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js
git commit -m "feat(cycle-game): CycleRaceEngine (distance/time race state machine)"
```

---

## Task 2: `buildRaceRecord` (pure)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/raceRecord.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/raceRecord.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/lib/cycleGame/raceRecord.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildRaceRecord } from './raceRecord.js';

const state = {
  winCondition: 'distance',
  riders: {
    milo: { userId: 'milo', displayName: 'Milo', equipmentId: 'cycle_ace', cumulativeDistanceM: 3000, distanceSeries: [1000, 2000, 3000], finishTimeS: 252 },
    felix: { userId: 'felix', displayName: 'Felix', equipmentId: 'tricycle', cumulativeDistanceM: 2710, distanceSeries: [900, 1800, 2710], finishTimeS: null }
  },
  standings: [
    { userId: 'milo', placement: 1, finishTimeS: 252, distanceM: 3000 },
    { userId: 'felix', placement: 2, finishTimeS: null, distanceM: 2710 }
  ]
};
const meta = { raceId: '20260602143012', date: '2026-06-02', mode: 'simultaneous', winCondition: 'distance', goalM: 3000, intervalSeconds: 5, backgroundPlexId: 'plex:1' };

describe('buildRaceRecord', () => {
  it('builds a v1 record with race metadata', () => {
    const rec = buildRaceRecord(state, meta);
    expect(rec.version).toBe(1);
    expect(rec.race.id).toBe('20260602143012');
    expect(rec.race.win_condition).toBe('distance');
    expect(rec.race.goal_m).toBe(3000);
    expect(rec.race.time_cap_s).toBeUndefined();
    expect(rec.race.interval_seconds).toBe(5);
    expect(rec.race.background_plex_id).toBe('plex:1');
  });
  it('builds per-participant entries with RLE distance series + placement', () => {
    const rec = buildRaceRecord(state, meta);
    expect(rec.participants.milo.final_distance_m).toBe(3000);
    expect(rec.participants.milo.final_time_s).toBe(252);
    expect(rec.participants.milo.placement).toBe(1);
    expect(rec.participants.milo.equipment).toBe('cycle_ace');
    expect(rec.participants.milo.distance_series).toBe('[1000,2000,3000]');
    expect(rec.participants.felix.placement).toBe(2);
    expect(rec.participants.felix.final_time_s).toBeNull();
  });
  it('uses time_cap_s (not goal_m) for a time race', () => {
    const rec = buildRaceRecord({ ...state, winCondition: 'time' }, { ...meta, winCondition: 'time', timeCapS: 300, goalM: undefined });
    expect(rec.race.time_cap_s).toBe(300);
    expect(rec.race.goal_m).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — must FAIL.**

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Fitness/lib/cycleGame/raceRecord.js`:

```js
import { SessionSerializerV3 } from '@/hooks/fitness/SessionSerializerV3.js';

/**
 * Build a v1 cycle-race record (YAML-ready) from engine state + metadata.
 * distance_series is RLE-encoded via the shared SessionSerializerV3 encoder.
 */
export function buildRaceRecord(state, meta = {}) {
  const { raceId, date, mode, winCondition, goalM, timeCapS, intervalSeconds, backgroundPlexId = null } = meta;
  const placeByUser = Object.fromEntries((state?.standings || []).map((s) => [s.userId, s.placement]));

  const participants = {};
  Object.values(state?.riders || {}).forEach((r) => {
    participants[r.userId] = {
      display_name: r.displayName,
      equipment: r.equipmentId,
      final_distance_m: r.cumulativeDistanceM,
      final_time_s: r.finishTimeS ?? null,
      placement: placeByUser[r.userId] ?? null,
      distance_series: SessionSerializerV3.encodeSeries(r.distanceSeries || [])
    };
  });

  const race = {
    id: raceId,
    date,
    mode,
    win_condition: winCondition,
    ...(winCondition === 'distance' ? { goal_m: goalM } : { time_cap_s: timeCapS }),
    interval_seconds: intervalSeconds,
    background_plex_id: backgroundPlexId
  };

  return { version: 1, race, participants };
}

export default buildRaceRecord;
```

- [ ] **Step 4: Run — must PASS** (3 tests).
- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/raceRecord.js frontend/src/modules/Fitness/lib/cycleGame/raceRecord.test.js
git commit -m "feat(cycle-game): buildRaceRecord (engine state → v1 record)"
```

---

## Task 3: `YamlCycleRaceDatastore` (backend)

Mirrors `YamlSessionDatastore` patterns: `ConfigService.getHouseholdPath('history/fitness/cycle-races', hid)` + `FileIO` (paths passed WITHOUT extension — `saveYaml`/`loadYaml` add `.yml`; `listYamlFiles` returns stripped basenames).

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.mjs`
- Test: `tests/unit/adapters/YamlCycleRaceDatastore.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/adapters/YamlCycleRaceDatastore.test.mjs`:

```js
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlCycleRaceDatastore } from '#adapters/persistence/yaml/YamlCycleRaceDatastore.mjs';

let tmp;
const makeStore = () => {
  const configService = { getHouseholdPath: (rel) => path.join(tmp, rel) };
  return new YamlCycleRaceDatastore({ configService });
};
const record = (id = '20260602143012') => ({
  version: 1,
  race: { id, date: '2026-06-02', mode: 'simultaneous', win_condition: 'distance', goal_m: 3000 },
  participants: { milo: { display_name: 'Milo', final_distance_m: 3000, placement: 1, distance_series: '[1000,2000,3000]' } }
});

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cgrace-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('YamlCycleRaceDatastore', () => {
  it('saves a record under history/fitness/cycle-races/{date}/{id}.yml', async () => {
    const ds = makeStore();
    await ds.save(record(), 'default');
    const file = path.join(tmp, 'history/fitness/cycle-races/2026-06-02/20260602143012.yml');
    expect(fs.existsSync(file)).toBe(true);
  });
  it('finds a saved record by id', async () => {
    const ds = makeStore();
    await ds.save(record(), 'default');
    const got = await ds.findById('20260602143012', 'default');
    expect(got.race.id).toBe('20260602143012');
    expect(got.participants.milo.final_distance_m).toBe(3000);
  });
  it('returns null for a missing id', async () => {
    const ds = makeStore();
    expect(await ds.findById('20260101000000', 'default')).toBeNull();
  });
  it('lists records for a date and lists dates', async () => {
    const ds = makeStore();
    await ds.save(record('20260602143012'), 'default');
    await ds.save(record('20260602150000'), 'default');
    const onDate = await ds.findByDate('2026-06-02', 'default');
    expect(onDate).toHaveLength(2);
    const dates = await ds.listDates('default');
    expect(dates).toContain('2026-06-02');
  });
  it('throws when the record has no race.id', async () => {
    const ds = makeStore();
    await expect(ds.save({ version: 1, race: {} }, 'default')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — must FAIL.**

Run: `… jest … tests/unit/adapters/YamlCycleRaceDatastore.test.mjs`

- [ ] **Step 3: Implement**

Create `backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.mjs`:

```js
/**
 * YamlCycleRaceDatastore - YAML persistence for cycle-game races.
 * Stored at: household[-{id}]/history/fitness/cycle-races/{YYYY-MM-DD}/{raceId}.yml
 * Mirrors YamlSessionDatastore; raceId is a YYYYMMDDHHmmss timestamp.
 */
import path from 'path';
import {
  ensureDir,
  saveYaml,
  loadYamlSafe,
  listYamlFiles,
  listDirsMatching
} from '#system/utils/FileIO.mjs';

export class YamlCycleRaceDatastore {
  constructor({ configService } = {}) {
    if (!configService) throw new Error('YamlCycleRaceDatastore requires configService');
    this.configService = configService;
  }

  _baseDir(householdId) {
    return this.configService.getHouseholdPath('history/fitness/cycle-races', householdId);
  }

  _dateFromId(raceId) {
    const s = String(raceId);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  /** @returns {{base, dir, file}} file path WITHOUT extension (FileIO adds .yml) */
  getStoragePaths(raceId, householdId) {
    const base = this._baseDir(householdId);
    const dir = path.join(base, this._dateFromId(raceId));
    return { base, dir, file: path.join(dir, String(raceId)) };
  }

  async save(record, householdId) {
    const raceId = record?.race?.id;
    if (!raceId) throw new Error('cycle race record missing race.id');
    const p = this.getStoragePaths(raceId, householdId);
    ensureDir(p.dir);
    saveYaml(p.file, record);
    return `${p.file}.yml`;
  }

  async findById(raceId, householdId) {
    const p = this.getStoragePaths(raceId, householdId);
    return loadYamlSafe(p.file); // null if missing
  }

  async findByDate(date, householdId) {
    const dir = path.join(this._baseDir(householdId), date);
    return listYamlFiles(dir)
      .map((id) => loadYamlSafe(path.join(dir, id)))
      .filter(Boolean);
  }

  async listDates(householdId) {
    return listDirsMatching(this._baseDir(householdId), /^\d{4}-\d{2}-\d{2}$/);
  }
}

export default YamlCycleRaceDatastore;
```

- [ ] **Step 4: Run — must PASS** (5 tests).
- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.mjs tests/unit/adapters/YamlCycleRaceDatastore.test.mjs
git commit -m "feat(cycle-game): YamlCycleRaceDatastore (save/find/list cycle races)"
```

---

## Final Verification

- [ ] Frontend: `… vitest … frontend/src/modules/Fitness/lib/cycleGame/CycleRaceEngine.test.js frontend/src/modules/Fitness/lib/cycleGame/raceRecord.test.js --root …` → 8 green.
- [ ] Backend: `… jest … tests/unit/adapters/YamlCycleRaceDatastore.test.mjs` → 5 green.

---

## Self-Review Notes

- **Spec coverage:** §2 distance (engine reuses `computeDistanceDelta`/`zoneMultiplierFor`); §6 modes/win-conditions (distance→time, time→distance) + standings; §8.1 record shape (v1, per-rider `distance_series` RLE, placement, finals) → Task 2; §8.1 storage path `history/fitness/cycle-races/{date}/{id}.yml` → Task 3. §8.2 high-scores index + §8.3 ghost querying: the datastore's `findByDate`/`listDates` provide the scan primitives; the derived index + ghost-filter helper land with the API (Plan 4) and the high-scores follow-on.
- **Deferred to Plan 4:** the `/api/v1/fitness/cycle-races` HTTP routes + `app.mjs` DI wiring (exercised by the race screen).
- **Type consistency:** engine `getState()` shape (`riders{userId:{...distanceSeries,finishTimeS}}`, `standings[]`) is exactly what `buildRaceRecord` consumes; record `race.id`/`race.date` drive the datastore path; `distance_series` RLE via `SessionSerializerV3.encodeSeries` (same encoder as sessions).
