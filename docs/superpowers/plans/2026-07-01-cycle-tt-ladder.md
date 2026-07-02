# Cycle Game — Weekly Time-Trial Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A featured course each week with a household ladder: server-computed standings over an indexed race history, a lobby card with one-tap "Ride It" that pre-arms a rival ghost, and ladder-movement callouts on the results board.

**Architecture:** Pure ladder/week/course logic goes in a new domain module (`2_domains/fitness/services/cycleLadder.mjs`). `YamlCycleRaceDatastore` gains monthly `_index/{YYYY-MM}.json` shards (same self-heal pattern as `YamlSessionDatastore`). `CycleRaceService` composes the two behind two new endpoints registered BEFORE `/cycle-races/:raceId`. Frontend: `buildRaceRecord` persists `course_id`; ghost-candidate mapping is extracted to a lib module so the ladder's "Ride It" can arm a ghost from any raceId; a `FeaturedCourseCard` renders in the lobby; `RaceResults` gains ladder notes.

**Tech Stack:** Node ESM (`.mjs`), Express, vitest (+supertest for routers), React 18 + PropTypes (`.jsx`), SCSS, Playwright for live flow.

**Spec:** `docs/superpowers/specs/2026-07-01-cycle-tt-ladder-design.md` — the SSOT for semantics. Key rules restated: matching = `course_id` equality OR legacy `(win_condition, goal)` equality; distance course ranks by min `final_time_s` (null/≤0 excluded), time course by max `final_distance_m` (>0); ghosts excluded; ties → smaller raceId wins; week = local Monday → next Monday, membership by the race's day-folder date string.

## Global Constraints

- **Structured logging only** — `logger.*` backend, `getLogger().child(...)`/`uiLog` frontend. Never raw `console.*`.
- **Run tests with:** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>` from repo root (backend and frontend files alike). Capture the runner's own pass/fail line, not a pipe's exit code.
- **No skipped/vacuous assertions** — a test that can't set up its scenario fails.
- **raceId is `YYYYMMDDHHmmss`**; day-folder date = `id.slice` → `YYYY-MM-DD`. The index and all week math use these local date strings — no timezone conversion anywhere.
- **Route order:** new `/cycle-races/ladder` and `/cycle-races/personal-bests` routes MUST be registered before `GET /cycle-races/:raceId` in `fitness.mjs`.
- **Never `sed -i` YAML in the container** — write complete files via heredoc inside `sh -c`.
- Commit after every task (small commits, `feat(cycle-game): ...`).

---

### Task 1: Domain module — week math, course rotation, ladder computation

**Files:**
- Create: `backend/src/2_domains/fitness/services/cycleLadder.mjs`
- Test: `backend/src/2_domains/fitness/services/cycleLadder.test.mjs`

**Interfaces:**
- Produces (consumed by Tasks 3–4):
  - `currentWeekWindow(now: Date) -> { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }` (Monday, exclusive end)
  - `isoWeekOf(d: Date) -> { year, week }`
  - `parseIsoWeekParam(s: string) -> { week, window: {start,end} } | null`
  - `resolveFeaturedCourse(cycleGameConfig, isoWeekNumber) -> course | null`
  - `raceMatchesCourse(entry, course) -> boolean`
  - `computeLadder({ course, entries, weekStart, weekEnd }) -> { course, week, standings[], allTimeRecord }`
  - `computePersonalBest({ entries, course, userId }) -> { userId, courseId, best|null }`
  - Index-entry shape consumed here (produced by Task 2): `{ id, date, course_id, win_condition, goal_m, time_cap_s, participants: [{ userId, isGhost, final_time_s, final_distance_m, placement }] }`

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/src/2_domains/fitness/services/cycleLadder.test.mjs
import { describe, it, expect } from 'vitest';
import {
  currentWeekWindow, isoWeekOf, parseIsoWeekParam, resolveFeaturedCourse,
  raceMatchesCourse, computeLadder, computePersonalBest
} from './cycleLadder.mjs';

const COURSE_D = { id: 'sprint-1500m', label: 'Sprint 1500', win_condition: 'distance', goal_m: 1500 };
const COURSE_T = { id: 'endurance-5min', label: 'Endurance 5', win_condition: 'time', time_cap_s: 300 };

const entry = (id, date, parts, over = {}) => ({
  id, date, course_id: over.course_id ?? 'sprint-1500m',
  win_condition: over.win_condition ?? 'distance',
  goal_m: over.goal_m ?? 1500, time_cap_s: over.time_cap_s ?? null,
  participants: parts
});
const p = (userId, timeS, distM = 1500, over = {}) => ({
  userId, isGhost: false, final_time_s: timeS, final_distance_m: distM, placement: null, ...over
});

describe('week math', () => {
  it('currentWeekWindow spans local Monday to next Monday (exclusive)', () => {
    // Wed 2026-07-01 → Mon 2026-06-29 .. Mon 2026-07-06
    expect(currentWeekWindow(new Date(2026, 6, 1, 15, 0))).toEqual({ start: '2026-06-29', end: '2026-07-06' });
    // A Monday maps to itself
    expect(currentWeekWindow(new Date(2026, 5, 29, 0, 1)).start).toBe('2026-06-29');
    // Sunday belongs to the week that STARTED the previous Monday
    expect(currentWeekWindow(new Date(2026, 6, 5, 23, 59)).start).toBe('2026-06-29');
  });
  it('isoWeekOf matches known ISO weeks', () => {
    expect(isoWeekOf(new Date(2026, 0, 1))).toEqual({ year: 2026, week: 1 });   // Thu 2026-01-01
    expect(isoWeekOf(new Date(2026, 6, 1)).week).toBe(27);                       // Wed 2026-07-01
  });
  it('parseIsoWeekParam round-trips and rejects garbage', () => {
    const r = parseIsoWeekParam('2026-W27');
    expect(r.week).toBe(27);
    expect(r.window).toEqual({ start: '2026-06-29', end: '2026-07-06' });
    expect(parseIsoWeekParam('nope')).toBeNull();
    expect(parseIsoWeekParam('2026-W99')).toBeNull();
  });
});

describe('resolveFeaturedCourse', () => {
  const cfg = { featured_courses: [COURSE_D, COURSE_T] };
  it('rotates by ISO week number', () => {
    expect(resolveFeaturedCourse(cfg, 26).id).toBe('sprint-1500m');
    expect(resolveFeaturedCourse(cfg, 27).id).toBe('endurance-5min');
  });
  it('override pins a course; unknown override falls back to rotation', () => {
    expect(resolveFeaturedCourse({ ...cfg, featured_course_override: 'endurance-5min' }, 26).id).toBe('endurance-5min');
    expect(resolveFeaturedCourse({ ...cfg, featured_course_override: 'ghost-town' }, 26).id).toBe('sprint-1500m');
  });
  it('null when no courses configured', () => {
    expect(resolveFeaturedCourse({}, 27)).toBeNull();
    expect(resolveFeaturedCourse({ featured_courses: [] }, 27)).toBeNull();
  });
});

describe('raceMatchesCourse', () => {
  it('matches by course_id', () => {
    expect(raceMatchesCourse(entry('x', '2026-06-30', []), COURSE_D)).toBe(true);
  });
  it('legacy fallback: null course_id but same win_condition + goal', () => {
    const legacy = entry('x', '2026-06-30', [], { course_id: null });
    expect(raceMatchesCourse(legacy, COURSE_D)).toBe(true);
    expect(raceMatchesCourse(entry('x', '2026-06-30', [], { course_id: null, goal_m: 2500 }), COURSE_D)).toBe(false);
    expect(raceMatchesCourse(entry('x', '2026-06-30', [], { course_id: null, win_condition: 'time', time_cap_s: 300, goal_m: null }), COURSE_T)).toBe(true);
  });
});

describe('computeLadder', () => {
  const W = { weekStart: '2026-06-29', weekEnd: '2026-07-06' };
  it('best-per-rider within the week, ranked ascending time for distance courses', () => {
    const entries = [
      entry('20260629080000', '2026-06-29', [p('dad', 150), p('milo', 190)]),
      entry('20260701080000', '2026-07-01', [p('milo', 170)]),
      entry('20260620080000', '2026-06-20', [p('dad', 140)]) // outside week
    ];
    const l = computeLadder({ course: COURSE_D, entries, ...W });
    expect(l.standings).toEqual([
      { userId: 'dad', bestValue: 150, raceId: '20260629080000', attempts: 1 },
      { userId: 'milo', bestValue: 170, raceId: '20260701080000', attempts: 2 }
    ]);
    expect(l.allTimeRecord).toEqual({ userId: 'dad', bestValue: 140, raceId: '20260620080000', date: '2026-06-20' });
    expect(l.week).toEqual({ start: '2026-06-29', end: '2026-07-06' });
  });
  it('time course ranks by max distance; zero distance never qualifies', () => {
    const entries = [entry('20260630080000', '2026-06-30',
      [p('dad', null, 2100), p('milo', null, 2400), p('alan', null, 0)],
      { course_id: 'endurance-5min', win_condition: 'time', time_cap_s: 300, goal_m: null })];
    const l = computeLadder({ course: COURSE_T, entries, ...W });
    expect(l.standings.map((s) => s.userId)).toEqual(['milo', 'dad']);
  });
  it('excludes ghosts and null finish times (DNF) on distance courses', () => {
    const entries = [entry('20260630080000', '2026-06-30', [
      p('dad', 150),
      p('ghost:20260601080000:dad', 145, 1500, { isGhost: true }),
      p('milo', null) // rode but never finished
    ])];
    const l = computeLadder({ course: COURSE_D, entries, ...W });
    expect(l.standings).toHaveLength(1);
    expect(l.standings[0].userId).toBe('dad');
  });
  it('tie goes to the earlier raceId', () => {
    const entries = [
      entry('20260630080000', '2026-06-30', [p('milo', 150)]),
      entry('20260629080000', '2026-06-29', [p('dad', 150)])
    ];
    const l = computeLadder({ course: COURSE_D, entries, ...W });
    expect(l.standings.map((s) => s.userId)).toEqual(['dad', 'milo']);
  });
});

describe('computePersonalBest', () => {
  it('returns the all-time best for one rider, or best:null', () => {
    const entries = [
      entry('20260620080000', '2026-06-20', [p('milo', 190)]),
      entry('20260630080000', '2026-06-30', [p('milo', 170)])
    ];
    expect(computePersonalBest({ entries, course: COURSE_D, userId: 'milo' })).toEqual({
      userId: 'milo', courseId: 'sprint-1500m',
      best: { bestValue: 170, raceId: '20260630080000', date: '2026-06-30' }
    });
    expect(computePersonalBest({ entries, course: COURSE_D, userId: 'nobody' }).best).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/2_domains/fitness/services/cycleLadder.test.mjs`
Expected: FAIL — `Cannot find module './cycleLadder.mjs'`

- [ ] **Step 3: Implement the module**

```javascript
// backend/src/2_domains/fitness/services/cycleLadder.mjs
/**
 * Weekly time-trial ladder — pure domain logic. No I/O, no clock reads:
 * callers pass `now` / index entries in. All dates are LOCAL 'YYYY-MM-DD'
 * strings matching the datastore's day-folder names (sliced from the
 * YYYYMMDDHHmmss raceId) — week membership is plain string comparison,
 * so no timezone conversion can disagree with the storage layout.
 */

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const dateFromRaceId = (raceId) => {
  const s = String(raceId);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

/** Local Monday 00:00 → next Monday (exclusive end), as date strings. */
export function currentWeekWindow(now = new Date()) {
  const dow = (now.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const next = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  return { start: ymd(monday), end: ymd(next) };
}

/** ISO-8601 week of a (local) date. */
export function isoWeekOf(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3); // Thursday of this week
  const year = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((date - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

/** 'YYYY-Www' → { week, window } or null if malformed / out of range. */
export function parseIsoWeekParam(s) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const monday = new Date(mondayW1);
  monday.setUTCDate(mondayW1.getUTCDate() + (week - 1) * 7);
  // Reject week numbers past the year's last ISO week (e.g. W99, or W53 in a 52-week year).
  if (isoWeekOf(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate())).week !== week) return null;
  const next = new Date(monday);
  next.setUTCDate(monday.getUTCDate() + 7);
  const u = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { week, window: { start: u(monday), end: u(next) } };
}

/** Featured course for a week: override pin wins, else rotate by ISO week. */
export function resolveFeaturedCourse(cycleGameConfig, isoWeekNumber) {
  const list = (Array.isArray(cycleGameConfig?.featured_courses) ? cycleGameConfig.featured_courses : [])
    .filter((c) => c && c.id);
  if (!list.length) return null;
  const pin = cycleGameConfig?.featured_course_override;
  if (pin) {
    const hit = list.find((c) => c.id === pin);
    if (hit) return hit;
  }
  const n = Number(isoWeekNumber) || 0;
  return list[((n % list.length) + list.length) % list.length];
}

/** course_id equality, or legacy fallback on (win_condition, goal). */
export function raceMatchesCourse(entry, course) {
  if (!entry || !course) return false;
  if (entry.course_id && entry.course_id === course.id) return true;
  if (entry.win_condition !== course.win_condition) return false;
  return course.win_condition === 'distance'
    ? entry.goal_m === course.goal_m
    : entry.time_cap_s === course.time_cap_s;
}

/**
 * Best qualifying attempt per rider over matching entries (optionally windowed).
 * Distance course: min final_time_s (finishers only). Time course: max
 * final_distance_m (> 0). Ghosts never qualify. Tie → smaller raceId.
 */
function bestByRider(entries, course, { start = null, end = null } = {}) {
  const lowerBetter = course.win_condition === 'distance';
  const best = new Map();
  for (const e of entries || []) {
    if (!raceMatchesCourse(e, course)) continue;
    if (start && !(e.date >= start && e.date < end)) continue;
    for (const part of e.participants || []) {
      if (part.isGhost) continue;
      const v = lowerBetter ? part.final_time_s : part.final_distance_m;
      if (!Number.isFinite(v) || v <= 0) continue;
      const cur = best.get(part.userId);
      const attempts = (cur?.attempts || 0) + 1;
      const beats = !cur
        || (lowerBetter ? v < cur.bestValue : v > cur.bestValue)
        || (v === cur.bestValue && String(e.id) < String(cur.raceId));
      best.set(part.userId, beats
        ? { userId: part.userId, bestValue: v, raceId: e.id, attempts }
        : { ...cur, attempts });
    }
  }
  return [...best.values()].sort((a, b) => {
    if (a.bestValue !== b.bestValue) return lowerBetter ? a.bestValue - b.bestValue : b.bestValue - a.bestValue;
    return String(a.raceId).localeCompare(String(b.raceId));
  });
}

export function computeLadder({ course, entries, weekStart, weekEnd }) {
  const standings = bestByRider(entries, course, { start: weekStart, end: weekEnd });
  const top = bestByRider(entries, course)[0] || null;
  return {
    course,
    week: { start: weekStart, end: weekEnd },
    standings,
    allTimeRecord: top
      ? { userId: top.userId, bestValue: top.bestValue, raceId: top.raceId, date: dateFromRaceId(top.raceId) }
      : null
  };
}

export function computePersonalBest({ entries, course, userId }) {
  const mine = bestByRider(entries, course).find((r) => r.userId === userId) || null;
  return {
    userId,
    courseId: course.id,
    best: mine
      ? { bestValue: mine.bestValue, raceId: mine.raceId, date: dateFromRaceId(mine.raceId) }
      : null
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/2_domains/fitness/services/cycleLadder.test.mjs`
Expected: PASS (all suites)

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/fitness/services/cycleLadder.mjs backend/src/2_domains/fitness/services/cycleLadder.test.mjs
git commit -m "feat(cycle-game): pure ladder domain — week math, course rotation, ranking"
```

---

### Task 2: Race index shards in YamlCycleRaceDatastore

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.mjs`
- Test: `backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.index.test.mjs` (new file; leave the existing `YamlCycleRaceDatastore.test.mjs` untouched)

**Interfaces:**
- Consumes: FileIO `readFile, writeFile, getStats` (already exported from `#system/utils/FileIO.mjs`).
- Produces (consumed by Task 3): `async listIndexEntries(householdId) -> entry[]` where entry = `{ id, date, course_id, win_condition, goal_m, time_cap_s, participants: [{ userId, isGhost, final_time_s, final_distance_m, placement }] }`. `save()` now invalidates the affected day.

- [ ] **Step 1: Read the existing datastore test** (`backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.test.mjs`) and reuse its temp-dir + fake-configService harness verbatim in the new test file. Do not invent a different harness.

- [ ] **Step 2: Write the failing tests** (adapt the `makeStore()`/tmp-dir helper names to whatever Step 1 found; the assertions below are the contract):

```javascript
// backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.index.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// ...same imports/tmp-dir harness as YamlCycleRaceDatastore.test.mjs...

const rec = (id, over = {}) => ({
  version: 1,
  race: { id, date: new Date().toISOString(), mode: 'simultaneous',
    win_condition: 'distance', goal_m: 1500, interval_seconds: 1,
    course_id: 'sprint-1500m', ...over },
  participants: {
    dad: { display_name: 'Dad', final_distance_m: 1500, final_time_s: 150.2, placement: 1 },
    'ghost:20260601080000:dad': { display_name: 'Dad 👻', final_distance_m: 1480, final_time_s: null, placement: 2 }
  }
});

describe('listIndexEntries', () => {
  it('builds entries from saved races (ghost flagged, nulls preserved)', async () => {
    await store.save(rec('20260630080000'), 'household');
    const entries = await store.listIndexEntries('household');
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e).toMatchObject({ id: '20260630080000', date: '2026-06-30', course_id: 'sprint-1500m',
      win_condition: 'distance', goal_m: 1500 });
    expect(e.participants).toEqual([
      { userId: 'dad', isGhost: false, final_time_s: 150.2, final_distance_m: 1500, placement: 1 },
      { userId: 'ghost:20260601080000:dad', isGhost: true, final_time_s: null, final_distance_m: 1480, placement: 2 }
    ]);
  });

  it('serves from the shard on a second read and self-heals when a race file is added out-of-band', async () => {
    await store.save(rec('20260630080000'), 'household');
    await store.listIndexEntries('household'); // build shard
    // Write a second race directly through save (which invalidates), then verify both appear
    await store.save(rec('20260630090000'), 'household');
    const entries = await store.listIndexEntries('household');
    expect(entries.map((e) => e.id).sort()).toEqual(['20260630080000', '20260630090000']);
  });

  it('a corrupt shard file is ignored and rebuilt', async () => {
    await store.save(rec('20260630080000'), 'household');
    await store.listIndexEntries('household');
    // Overwrite the shard with garbage
    // (path: <base>/_index/2026-06.json — use the tmp dir from the harness)
    fs.writeFileSync(path.join(tmpBase, 'history/fitness/cycle-races/_index/2026-06.json'), '{nope');
    const entries = await store.listIndexEntries('household');
    expect(entries).toHaveLength(1);
  });

  it('legacy records without course_id index as course_id null', async () => {
    const legacy = rec('20260630080000');
    delete legacy.race.course_id;
    await store.save(legacy, 'household');
    const [e] = await store.listIndexEntries('household');
    expect(e.course_id).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.index.test.mjs`
Expected: FAIL — `store.listIndexEntries is not a function`

- [ ] **Step 4: Implement.** Add to `YamlCycleRaceDatastore.mjs` (imports: extend the existing FileIO import with `readFile, writeFile, getStats`):

```javascript
const INDEX_DIR_NAME = '_index';
const INDEX_VERSION = 1;

/** One index row per race — everything the ladder needs, nothing more. */
export function indexEntryFromRecord(record, date) {
  const race = record?.race || {};
  return {
    id: race.id,
    date,
    course_id: race.course_id ?? null,
    win_condition: race.win_condition || 'distance',
    goal_m: race.goal_m ?? null,
    time_cap_s: race.time_cap_s ?? null,
    participants: Object.entries(record?.participants || {}).map(([userId, p]) => ({
      userId,
      isGhost: String(userId).startsWith('ghost:'),
      final_time_s: Number.isFinite(p?.final_time_s) ? p.final_time_s : null,
      final_distance_m: Number(p?.final_distance_m) || 0,
      placement: p?.placement ?? null
    }))
  };
}
```

and these methods on the class (mirroring `YamlSessionDatastore`'s shard pattern — disposable cache, swallowed write errors, per-day mtime staleness check, write-through invalidation):

```javascript
  /**
   * All index entries across history. Month shards (_index/{YYYY-MM}.json) are
   * lazily (re)built per day: a day is trusted only if its folder mtime matches
   * what the shard recorded. save() invalidates its day, so in-place edits that
   * don't bump the folder mtime are still reflected.
   */
  async listIndexEntries(householdId) {
    const dates = await this.listDates(householdId);
    const shardCache = new Map();
    const dirtyMonths = new Set();
    const getShard = (yyyymm) => {
      if (!shardCache.has(yyyymm)) shardCache.set(yyyymm, this._loadIndexShard(householdId, yyyymm));
      return shardCache.get(yyyymm);
    };
    const entries = [];
    for (const date of dates) {
      const yyyymm = date.slice(0, 7);
      const shard = getShard(yyyymm);
      const mtimeMs = this._dayDirMtimeMs(householdId, date);
      const cached = shard.days?.[date];
      let dayEntries;
      if (cached && cached.mtimeMs === mtimeMs && Array.isArray(cached.races)) {
        dayEntries = cached.races;
      } else {
        const records = await this.findByDate(date, householdId);
        dayEntries = records.map((r) => indexEntryFromRecord(r, date)).filter((e) => e.id);
        shard.days = shard.days || {};
        shard.days[date] = { mtimeMs, races: dayEntries };
        dirtyMonths.add(yyyymm);
      }
      entries.push(...dayEntries);
    }
    for (const yyyymm of dirtyMonths) this._saveIndexShard(householdId, yyyymm, shardCache.get(yyyymm));
    return entries;
  }

  _indexShardPath(householdId, yyyymm) {
    return path.join(this._baseDir(householdId), INDEX_DIR_NAME, `${yyyymm}.json`);
  }

  _loadIndexShard(householdId, yyyymm) {
    const empty = { version: INDEX_VERSION, days: {} };
    const raw = readFile(this._indexShardPath(householdId, yyyymm));
    if (!raw) return empty;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== INDEX_VERSION || typeof parsed.days !== 'object' || parsed.days === null) return empty;
      return parsed;
    } catch {
      return empty;
    }
  }

  _saveIndexShard(householdId, yyyymm, shard) {
    try {
      ensureDir(path.join(this._baseDir(householdId), INDEX_DIR_NAME));
      writeFile(this._indexShardPath(householdId, yyyymm), JSON.stringify(shard));
    } catch {
      // derived data — a failed write just means a rebuild on the next read
    }
  }

  _dayDirMtimeMs(householdId, date) {
    const stats = getStats(path.join(this._baseDir(householdId), date));
    return stats ? stats.mtimeMs : null;
  }

  _invalidateIndexDay(date, householdId) {
    if (!date) return;
    const yyyymm = date.slice(0, 7);
    const shard = this._loadIndexShard(householdId, yyyymm);
    if (shard.days && Object.prototype.hasOwnProperty.call(shard.days, date)) {
      delete shard.days[date];
      this._saveIndexShard(householdId, yyyymm, shard);
    }
  }
```

and in `save()`, after `saveYaml(p.file, record);` add:

```javascript
    this._invalidateIndexDay(this._dateFromId(raceId), householdId);
```

- [ ] **Step 5: Run new + existing datastore tests**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.index.test.mjs backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.test.mjs`
Expected: PASS (both files — save() change must not break existing tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.mjs backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.index.test.mjs
git commit -m "feat(cycle-game): monthly race-index shards (self-healing, write-through invalidation)"
```

---

### Task 3: CycleRaceService — getLadder / getPersonalBest

**Files:**
- Modify: `backend/src/3_applications/fitness/services/CycleRaceService.mjs`
- Test: `backend/src/3_applications/fitness/services/CycleRaceService.test.mjs` (append a new describe block)

**Interfaces:**
- Consumes: Task 1 exports, Task 2 `datastore.listIndexEntries`.
- Produces (consumed by Task 4):
  - `async getLadder({ cycleGameConfig, week = null, householdId }) -> ladder | null` (null = no featured courses). Throws `Error` with `err.code === 'BAD_WEEK'` for a malformed `week`.
  - `async getPersonalBest({ cycleGameConfig, userId, courseId, householdId }) -> { userId, courseId, best|null }`

- [ ] **Step 1: Write the failing tests** (append to the existing test file, reusing its existing fake-datastore style — read the file first and match it):

```javascript
describe('ladder + personal bests', () => {
  const CFG = { featured_courses: [
    { id: 'sprint-1500m', label: 'Sprint 1500', win_condition: 'distance', goal_m: 1500 },
    { id: 'endurance-5min', label: 'Endurance 5', win_condition: 'time', time_cap_s: 300 }
  ] };
  const ENTRIES = [
    { id: '20260629080000', date: '2026-06-29', course_id: 'sprint-1500m', win_condition: 'distance', goal_m: 1500, time_cap_s: null,
      participants: [{ userId: 'dad', isGhost: false, final_time_s: 150, final_distance_m: 1500, placement: 1 }] },
    { id: '20260101080000', date: '2026-01-01', course_id: 'sprint-1500m', win_condition: 'distance', goal_m: 1500, time_cap_s: null,
      participants: [{ userId: 'milo', isGhost: false, final_time_s: 140, final_distance_m: 1500, placement: 1 }] }
  ];
  const makeSvc = () => new CycleRaceService({ datastore: {
    listIndexEntries: async () => ENTRIES.map((e) => ({ ...e }))
  } });

  it('getLadder computes standings for the requested week and all-time record', async () => {
    const l = await makeSvc().getLadder({ cycleGameConfig: { ...CFG, featured_course_override: 'sprint-1500m' },
      week: '2026-W27', householdId: 'household' });
    expect(l.course.id).toBe('sprint-1500m');
    expect(l.standings).toEqual([{ userId: 'dad', bestValue: 150, raceId: '20260629080000', attempts: 1 }]);
    expect(l.allTimeRecord.userId).toBe('milo');
  });

  it('getLadder returns null with no featured courses; throws BAD_WEEK on garbage', async () => {
    expect(await makeSvc().getLadder({ cycleGameConfig: {}, householdId: 'h' })).toBeNull();
    await expect(makeSvc().getLadder({ cycleGameConfig: CFG, week: 'garbage', householdId: 'h' }))
      .rejects.toMatchObject({ code: 'BAD_WEEK' });
  });

  it('getPersonalBest resolves the course from config, or infers it from indexed entries', async () => {
    const withCfg = await makeSvc().getPersonalBest({ cycleGameConfig: CFG, userId: 'milo', courseId: 'sprint-1500m', householdId: 'h' });
    expect(withCfg.best).toEqual({ bestValue: 140, raceId: '20260101080000', date: '2026-01-01' });
    const noCfg = await makeSvc().getPersonalBest({ cycleGameConfig: {}, userId: 'milo', courseId: 'sprint-1500m', householdId: 'h' });
    expect(noCfg.best?.bestValue).toBe(140);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/services/CycleRaceService.test.mjs`
Expected: FAIL — `getLadder is not a function` (existing tests still pass)

- [ ] **Step 3: Implement.** Add to `CycleRaceService.mjs`:

```javascript
import {
  currentWeekWindow, isoWeekOf, parseIsoWeekParam,
  resolveFeaturedCourse, computeLadder, computePersonalBest
} from '#domains/fitness/services/cycleLadder.mjs';
```

(Verify the `#domains` import alias against how sibling application services import from `2_domains`; use the same alias/relative style the codebase already uses.)

Extend the constructor with an optional logger (spec §7 observability — the `getLadder` code above uses it for duration + entry count):

```javascript
  constructor({ datastore, logger = null } = {}) {
    if (!datastore) throw new Error('CycleRaceService requires datastore');
    this.datastore = datastore;
    this.logger = logger;
  }
```

Also wire the logger where the service is constructed in `backend/src/0_system/bootstrap.mjs` (~line 950, next to the existing `CycleRaceService` instantiation): pass the same `logger` the neighboring fitness services receive, and add `backend/src/0_system/bootstrap.mjs` to this task's commit.

```javascript
  /** Weekly ladder for the featured course. null = no featured courses configured. */
  async getLadder({ cycleGameConfig = {}, week = null, householdId } = {}) {
    let window;
    let weekNo;
    if (week != null) {
      const parsed = parseIsoWeekParam(week);
      if (!parsed) {
        const err = new Error(`invalid week: ${week}`);
        err.code = 'BAD_WEEK';
        throw err;
      }
      window = parsed.window;
      weekNo = parsed.week;
    } else {
      const now = new Date();
      window = currentWeekWindow(now);
      weekNo = isoWeekOf(now).week;
    }
    const course = resolveFeaturedCourse(cycleGameConfig, weekNo);
    if (!course) return null;
    const t0 = Date.now();
    const entries = await this.datastore.listIndexEntries(householdId);
    const ladder = computeLadder({ course, entries, weekStart: window.start, weekEnd: window.end });
    this.logger?.debug?.('fitness.cycle_races.ladder.computed', {
      courseId: course.id, entries: entries.length, rungs: ladder.standings.length, ms: Date.now() - t0
    });
    return ladder;
  }

  /** All-time personal best on a course. Course def from config, else inferred from history. */
  async getPersonalBest({ cycleGameConfig = {}, userId, courseId, householdId } = {}) {
    const entries = await this.datastore.listIndexEntries(householdId);
    let course = (Array.isArray(cycleGameConfig?.featured_courses) ? cycleGameConfig.featured_courses : [])
      .find((c) => c?.id === courseId) || null;
    if (!course) {
      const sample = entries.find((e) => e.course_id === courseId);
      course = sample
        ? { id: courseId, win_condition: sample.win_condition, goal_m: sample.goal_m, time_cap_s: sample.time_cap_s }
        : { id: courseId, win_condition: 'distance', goal_m: null, time_cap_s: null };
    }
    return computePersonalBest({ entries, course, userId });
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/fitness/services/CycleRaceService.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/services/CycleRaceService.mjs backend/src/3_applications/fitness/services/CycleRaceService.test.mjs
git commit -m "feat(cycle-game): CycleRaceService ladder + personal-best queries"
```

---

### Task 4: Router endpoints (registered before `/:raceId`)

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs` (insert between the `POST /cycle-races` handler ending at the current line ~428 and `GET /cycle-races/:raceId`)
- Test: `backend/src/4_api/v1/routers/fitness.cycleLadder.test.mjs`

**Interfaces:**
- Consumes: Task 3 service methods; router-config deps already destructured in `createFitnessRouter`: `cycleRaceService`, `configService`, `fitnessConfigService`, `logger`.
- Produces: `GET /api/fitness/cycle-races/ladder?week=` and `GET /api/fitness/cycle-races/personal-bests?userId=&courseId=` (frontend consumes as `/api/v1/fitness/...`).

- [ ] **Step 1: Write the failing tests** (supertest harness modeled on `fitness.grouping.test.mjs` — same silent logger, same `createFitnessRouter` fakes):

```javascript
// backend/src/4_api/v1/routers/fitness.cycleLadder.test.mjs
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';

const silentLogger = { error() {}, warn() {}, info() {}, debug() {} };
const CFG = { cycle_game: { featured_courses: [
  { id: 'sprint-1500m', label: 'Sprint 1500', win_condition: 'distance', goal_m: 1500 }
] } };

function buildApp({ ladder, pb } = {}) {
  const cycleRaceService = {
    getLadder: async ({ week }) => {
      if (week === 'garbage') { const e = new Error('invalid week'); e.code = 'BAD_WEEK'; throw e; }
      return ladder;
    },
    getPersonalBest: async () => pb,
    get: async (raceId) => (raceId === '20260629080000' ? { race: { id: raceId } } : null)
  };
  const router = createFitnessRouter({
    cycleRaceService,
    configService: { getDefaultHouseholdId: () => 'household' },
    fitnessConfigService: { loadRawConfig: () => CFG },
    logger: silentLogger
  });
  const app = express();
  app.use('/api/fitness', router);
  return app;
}

const LADDER = { course: CFG.cycle_game.featured_courses[0], week: { start: '2026-06-29', end: '2026-07-06' },
  standings: [{ userId: 'dad', bestValue: 150, raceId: '20260629080000', attempts: 1 }], allTimeRecord: null };

describe('GET /cycle-races/ladder', () => {
  it('returns the ladder', async () => {
    const res = await request(buildApp({ ladder: LADDER })).get('/api/fitness/cycle-races/ladder');
    expect(res.status).toBe(200);
    expect(res.body.standings[0].userId).toBe('dad');
  });
  it('is NOT swallowed by /cycle-races/:raceId (route-order regression)', async () => {
    const res = await request(buildApp({ ladder: LADDER })).get('/api/fitness/cycle-races/ladder');
    expect(res.body).not.toHaveProperty('race'); // :raceId handler shape
    expect(res.body).toHaveProperty('standings');
  });
  it('404 when no featured courses; 400 on bad week', async () => {
    expect((await request(buildApp({ ladder: null })).get('/api/fitness/cycle-races/ladder')).status).toBe(404);
    expect((await request(buildApp({ ladder: LADDER })).get('/api/fitness/cycle-races/ladder?week=garbage')).status).toBe(400);
  });
});

describe('GET /cycle-races/personal-bests', () => {
  it('returns the PB and 400s on missing params', async () => {
    const pb = { userId: 'milo', courseId: 'sprint-1500m', best: null };
    const app = buildApp({ pb });
    const ok = await request(app).get('/api/fitness/cycle-races/personal-bests?userId=milo&courseId=sprint-1500m');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(pb);
    expect((await request(app).get('/api/fitness/cycle-races/personal-bests?userId=milo')).status).toBe(400);
    expect((await request(app).get('/api/fitness/cycle-races/personal-bests?courseId=x')).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/fitness.cycleLadder.test.mjs`
Expected: FAIL — ladder request falls through to `/:raceId` → 404/`race` shape mismatch

- [ ] **Step 3: Implement.** Insert in `fitness.mjs` immediately AFTER the `POST /cycle-races` handler and BEFORE `router.get('/cycle-races/:raceId', ...)`:

```javascript
  // NOTE: /ladder and /personal-bests MUST precede /cycle-races/:raceId or
  // Express matches them as raceIds.
  router.get('/cycle-races/ladder', async (req, res) => {
    if (!cycleRaceService) return res.status(503).json({ error: 'cycle races unavailable' });
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const cycleGameConfig = fitnessConfigService?.loadRawConfig(householdId)?.cycle_game || {};
    try {
      const ladder = await cycleRaceService.getLadder({ cycleGameConfig, week: req.query.week ?? null, householdId });
      if (!ladder) return res.status(404).json({ error: 'no featured courses configured' });
      return res.json(ladder);
    } catch (err) {
      if (err?.code === 'BAD_WEEK') return res.status(400).json({ error: 'invalid week (expected YYYY-Www)' });
      logger.error?.('fitness.cycle_races.ladder.error', { error: err?.message });
      return res.status(500).json({ error: 'ladder failed' });
    }
  });

  router.get('/cycle-races/personal-bests', async (req, res) => {
    if (!cycleRaceService) return res.status(503).json({ error: 'cycle races unavailable' });
    const { userId, courseId } = req.query;
    if (!userId || !courseId) return res.status(400).json({ error: 'userId and courseId required' });
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const cycleGameConfig = fitnessConfigService?.loadRawConfig(householdId)?.cycle_game || {};
    try {
      return res.json(await cycleRaceService.getPersonalBest({ cycleGameConfig, userId, courseId, householdId }));
    } catch (err) {
      logger.error?.('fitness.cycle_races.pb.error', { error: err?.message });
      return res.status(500).json({ error: 'personal-best failed' });
    }
  });
```

Also add the two routes to the endpoint list in the file-header comment block.

- [ ] **Step 4: Run router tests (new + grouping regression)**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/fitness.cycleLadder.test.mjs backend/src/4_api/v1/routers/fitness.grouping.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs backend/src/4_api/v1/routers/fitness.cycleLadder.test.mjs
git commit -m "feat(cycle-game): ladder + personal-best endpoints (before /:raceId)"
```

---

### Task 5: Persist course_id (frontend record + container meta)

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/raceRecord.js`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx:676-685` (raceMeta)
- Test: `frontend/src/modules/Fitness/lib/cycleGame/raceRecord.test.js` (append)

**Interfaces:**
- Produces: persisted `race.course_id` (string|null). Task 9's Ride It supplies `override.id`; plain lobby/ghost races persist `course_id: null`.

- [ ] **Step 1: Read `raceRecord.test.js`, append failing cases in its existing style:**

```javascript
it('persists course_id from meta, null when absent', () => {
  const state = { standings: [], riders: {} };
  const base = { raceId: '20260701080000', date: 'D', mode: 'simultaneous',
    winCondition: 'distance', goalM: 1500, intervalSeconds: 1 };
  expect(buildRaceRecord(state, { ...base, courseId: 'sprint-1500m' }).race.course_id).toBe('sprint-1500m');
  expect(buildRaceRecord(state, base).race.course_id).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/raceRecord.test.js`
Expected: FAIL — `race.course_id` is `undefined`

- [ ] **Step 3: Implement.** In `raceRecord.js`, extend the meta destructure and race object:

```javascript
  const { raceId, date, mode, winCondition, goalM, timeCapS, intervalSeconds, backgroundPlexId = null, courseId = null } = meta;
```

```javascript
  const race = {
    id: raceId,
    date,
    mode,
    win_condition: winCondition,
    ...(winCondition === 'distance' ? { goal_m: goalM } : { time_cap_s: timeCapS }),
    interval_seconds: intervalSeconds,
    background_plex_id: backgroundPlexId,
    course_id: courseId
  };
```

In `CycleGameContainer.jsx`, add to `raceMetaRef.current = { ... }` (after `backgroundPlexId: cfg.backgroundPlexId`):

```javascript
      // Real course identity only — 'custom'/'ghost' lobby races persist null.
      courseId: ov?.id ?? null
```

- [ ] **Step 4: Run to verify pass** (same command as Step 2). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/raceRecord.js frontend/src/modules/Fitness/lib/cycleGame/raceRecord.test.js frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
git commit -m "feat(cycle-game): persist course_id in race records"
```

---

### Task 6: Extract ghost-candidate mapping into a lib module

The ladder's Ride It must arm a ghost from an arbitrary fetched race record; that mapping currently lives inline in the container. Extract it verbatim — this is a MOVE, not a redesign.

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/ghostCandidate.js`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` (ghostCandidates memo `:501-569`; onSelectGhost `:1117-1165`)
- Test: `frontend/src/modules/Fitness/lib/cycleGame/ghostCandidate.test.js`

**Interfaces:**
- Produces:
  - `mapRaceRecordToCandidate(rec, { getDisplayLabel = null, resolveGaugeMaxRpm = () => 120 } = {}) -> candidate | null` — exact shape the memo currently returns (`raceId, day, timeOfDay, winCondition, goalM, timeCapS, intervalSeconds, participants[], winnerName, goalKind/goalLabel/scoreKind/scoreLabel`).
  - `buildGhostFromCandidate(candidate) -> { ghost, riders } | null` — `ghost` is the exact object `setGhost` currently receives; null when no rider has a non-empty distance series.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/Fitness/lib/cycleGame/ghostCandidate.test.js
import { describe, it, expect } from 'vitest';
import { SessionSerializerV3 } from '@/hooks/fitness/SessionSerializerV3.js';
import { mapRaceRecordToCandidate, buildGhostFromCandidate } from './ghostCandidate.js';

const REC = {
  race: { id: '20260630081500', date: '2026-06-30T15:15:00.000Z', win_condition: 'distance', goal_m: 1500, interval_seconds: 1 },
  participants: {
    dad: { display_name: 'Dad', equipment: 'cycle_ace', final_distance_m: 1500, final_time_s: 150, placement: 1,
      distance_series: SessionSerializerV3.encodeSeries([0, 10, 20]) },
    milo: { display_name: 'Milo', equipment: 'tricycle', final_distance_m: 1200, final_time_s: null, placement: 2,
      distance_series: SessionSerializerV3.encodeSeries([0, 5, 9]) }
  }
};

describe('mapRaceRecordToCandidate', () => {
  it('maps a record to a candidate (winner first, day/time from raceId)', () => {
    const c = mapRaceRecordToCandidate(REC);
    expect(c.raceId).toBe('20260630081500');
    expect(c.day).toBe('2026-06-30');
    expect(c.timeOfDay).toBe('8:15 am');
    expect(c.participants[0].displayName).toBe('Dad');
    expect(c.winnerName).toBe('Dad');
    expect(c.goalKind).toBe('distance');
    expect(c.scoreKind).toBe('time');
  });
  it('returns null for a record with no participants', () => {
    expect(mapRaceRecordToCandidate({ race: { id: 'x' }, participants: {} })).toBeNull();
  });
});

describe('buildGhostFromCandidate', () => {
  it('builds ghost riders with decoded series and ghost: ids', () => {
    const { ghost, riders } = buildGhostFromCandidate(mapRaceRecordToCandidate(REC));
    expect(riders).toHaveLength(2);
    expect(riders[0].userId).toBe('ghost:20260630081500:dad');
    expect(riders[0].ghostSeries).toEqual([0, 10, 20]);
    expect(ghost.sourceRaceId).toBe('20260630081500');
    expect(ghost.winCondition).toBe('distance');
    expect(ghost.riders).toBe(riders);
    expect(ghost.displayName).toBe('Dad 👻 +1');
  });
  it('returns null when no rider has distance data', () => {
    const rec = { race: REC.race, participants: { dad: { display_name: 'Dad', distance_series: null } } };
    expect(buildGhostFromCandidate(mapRaceRecordToCandidate(rec))).toBeNull();
  });
});
```

Note: `ghost.displayName` uses the candidate's `winnerName` + rider-count suffix, exactly as `onSelectGhost` does today — assert whatever exact string the moved code produces (`Dad 👻 +1` assumes winnerName comes from the mapped participant displayName which includes no ghost suffix; adjust the assertion to the actual output on first run ONLY if the moved code demonstrably produced that same string in the container before the move).

- [ ] **Step 2: Run to verify failure** — `Cannot find module './ghostCandidate.js'`.

- [ ] **Step 3: Implement by MOVING code.** Create `ghostCandidate.js` containing:
  - the `fmtMs` helper, and the entire per-record mapping body from the container's `ghostCandidates` memo (lines ~507-567), parameterized: `getDisplayLabel` optional (skip the label re-resolution when absent), `resolveGaugeMaxRpm(equipmentId)` replacing the inline `resolveRpmLimits(bikeById.get(...))` call. Imports: `resolveParticipantIdentity` from `./participantIdentity.js`, `formatDistance` from `./formatDistance.js`.
  - the ghost-rider construction from `onSelectGhost` (lines ~1119-1160), returning `{ ghost, riders }` and doing NO logging (the container keeps its `cycle_game.ghost_rider` / `ghost_empty` logs, using the returned value).

Then in the container:
  - `ghostCandidates` memo becomes:

```javascript
  const ghostCandidates = useMemo(() => {
    const resolveGaugeMaxRpm = (equipmentId) => resolveRpmLimits(bikeById.get(equipmentId) || {}).gaugeMaxRpm;
    return (Array.isArray(pastRaces) ? pastRaces : [])
      .map((rec) => mapRaceRecordToCandidate(rec, { getDisplayLabel, resolveGaugeMaxRpm }))
      .filter(Boolean);
  }, [pastRaces, getDisplayLabel, bikeById]);
```

  - `onSelectGhost` becomes:

```javascript
  const onSelectGhost = useCallback((candidate) => {
    if (!candidate) return;
    const built = buildGhostFromCandidate(candidate);
    if (!built) {
      log.warn('cycle_game.ghost_empty', { raceId: candidate.raceId });
      return;
    }
    log.info('cycle_game.ghost_rider', {
      raceId: candidate.raceId,
      riders: built.riders.map((r) => ({
        userId: r.userId,
        distancePts: r.ghostSeries.length,
        hrPts: r.ghostHrSeries.length,
        rpmPts: r.ghostRpmSeries.length,
        zonePts: r.ghostZoneSeries.length
      }))
    });
    setGhost(built.ghost);
    setRaceType(candidate.winCondition);
    if (candidate.winCondition === 'time') setRaceValueS(candidate.timeCapS);
    else setRaceValueM(candidate.goalM);
    log.info('cycle_game.ghost_selected', { raceId: candidate.raceId, winCondition: candidate.winCondition, riders: built.riders.length });
  }, [log]);
```

- [ ] **Step 4: Run lib test + existing container/home tests (regression on the move)**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/ghostCandidate.test.js frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/home/GhostPicker.test.jsx`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/ghostCandidate.js frontend/src/modules/Fitness/lib/cycleGame/ghostCandidate.test.js frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
git commit -m "refactor(cycle-game): extract ghost-candidate mapping to lib (reusable by ladder)"
```

---

### Task 7: Frontend ladder helpers (pure)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/ladder.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/ladder.test.js`

**Interfaces (consumed by Tasks 8–10):**
- `courseStartOverride(course) -> { id, win_condition, goal_m, time_cap_s }` (startRace override shape)
- `pickRival({ standings, riderId }) -> { kind: 'above'|'self-pb'|'tail'|'none', raceId, rivalUserId }`
- `ladderDelta({ before, after, userId }) -> { rank, prevRank, movedUp, isLead, aboveUserId, gapToAbove } | null`
- `daysLeft(endYmd, now) -> number` (whole days until the exclusive week end, min 0)

- [ ] **Step 1: Write the failing tests**

```javascript
// frontend/src/modules/Fitness/lib/cycleGame/ladder.test.js
import { describe, it, expect } from 'vitest';
import { courseStartOverride, pickRival, ladderDelta, daysLeft } from './ladder.js';

const ROWS = [
  { userId: 'dad', bestValue: 150, raceId: 'r1', attempts: 2 },
  { userId: 'mom', bestValue: 165, raceId: 'r2', attempts: 1 },
  { userId: 'milo', bestValue: 190, raceId: 'r3', attempts: 3 }
];

describe('courseStartOverride', () => {
  it('maps distance and time courses to the startRace override shape', () => {
    expect(courseStartOverride({ id: 'c1', win_condition: 'distance', goal_m: 1500 }))
      .toEqual({ id: 'c1', win_condition: 'distance', goal_m: 1500, time_cap_s: null });
    expect(courseStartOverride({ id: 'c2', win_condition: 'time', time_cap_s: 300 }))
      .toEqual({ id: 'c2', win_condition: 'time', goal_m: null, time_cap_s: 300 });
  });
});

describe('pickRival', () => {
  it('rung above for a ranked rider; self-pb for the leader; tail for unranked; none when empty', () => {
    expect(pickRival({ standings: ROWS, riderId: 'milo' })).toEqual({ kind: 'above', raceId: 'r2', rivalUserId: 'mom' });
    expect(pickRival({ standings: ROWS, riderId: 'dad' })).toEqual({ kind: 'self-pb', raceId: null, rivalUserId: 'dad' });
    expect(pickRival({ standings: ROWS, riderId: 'newkid' })).toEqual({ kind: 'tail', raceId: 'r3', rivalUserId: 'milo' });
    expect(pickRival({ standings: [], riderId: 'dad' })).toEqual({ kind: 'none', raceId: null, rivalUserId: null });
  });
});

describe('ladderDelta', () => {
  it('reports rank, movement, and gap to the rung above', () => {
    const before = [ROWS[0], ROWS[2], ROWS[1]]; // milo was 2nd
    const d = ladderDelta({ before, after: ROWS, userId: 'mom' });
    expect(d).toEqual({ rank: 2, prevRank: 3, movedUp: true, isLead: false, aboveUserId: 'dad', gapToAbove: 15 });
    expect(ladderDelta({ before, after: ROWS, userId: 'dad' }).isLead).toBe(true);
    expect(ladderDelta({ before, after: ROWS, userId: 'nobody' })).toBeNull();
  });
});

describe('daysLeft', () => {
  it('whole days to the exclusive end date, floored at 0', () => {
    expect(daysLeft('2026-07-06', new Date(2026, 6, 1, 12))).toBe(5);
    expect(daysLeft('2026-07-06', new Date(2026, 6, 5, 23))).toBe(1);
    expect(daysLeft('2026-07-06', new Date(2026, 6, 7))).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

```javascript
// frontend/src/modules/Fitness/lib/cycleGame/ladder.js
/** Pure helpers for the weekly featured-course ladder. */

/** Featured course → the override shape CycleGameContainer.startRace consumes. */
export function courseStartOverride(course = {}) {
  const time = course.win_condition === 'time';
  return {
    id: course.id,
    win_condition: course.win_condition,
    goal_m: time ? null : (course.goal_m ?? null),
    time_cap_s: time ? (course.time_cap_s ?? null) : null
  };
}

/**
 * Which past race to arm as the rival ghost. Ranked rider → the rung above;
 * the leader chases their own PB (raceId resolved separately via the PB
 * endpoint); an unranked rider chases the bottom rung.
 */
export function pickRival({ standings = [], riderId = null } = {}) {
  if (!standings.length) return { kind: 'none', raceId: null, rivalUserId: null };
  const idx = riderId ? standings.findIndex((r) => r.userId === riderId) : -1;
  if (idx > 0) return { kind: 'above', raceId: standings[idx - 1].raceId, rivalUserId: standings[idx - 1].userId };
  if (idx === 0) return { kind: 'self-pb', raceId: null, rivalUserId: riderId };
  const tail = standings[standings.length - 1];
  return { kind: 'tail', raceId: tail.raceId, rivalUserId: tail.userId };
}

/** A rider's movement between two ladder snapshots. null if not on the new ladder. */
export function ladderDelta({ before = [], after = [], userId } = {}) {
  const idx = after.findIndex((r) => r.userId === userId);
  if (idx < 0) return null;
  const prevIdx = before.findIndex((r) => r.userId === userId);
  const above = idx > 0 ? after[idx - 1] : null;
  return {
    rank: idx + 1,
    prevRank: prevIdx >= 0 ? prevIdx + 1 : null,
    movedUp: prevIdx >= 0 && idx < prevIdx,
    isLead: idx === 0,
    aboveUserId: above ? above.userId : null,
    gapToAbove: above ? Math.abs(after[idx].bestValue - above.bestValue) : null
  };
}

/** Whole days until the exclusive week-end date ('YYYY-MM-DD'), min 0. */
export function daysLeft(endYmd, now = new Date()) {
  const [y, m, d] = String(endYmd).split('-').map(Number);
  const end = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((end - today) / 86400000));
}
```

- [ ] **Step 4: Run to verify pass** — same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/ladder.js frontend/src/modules/Fitness/lib/cycleGame/ladder.test.js
git commit -m "feat(cycle-game): pure ladder helpers (override, rival pick, delta, days-left)"
```

---

### Task 8: FeaturedCourseCard component

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/home/FeaturedCourseCard.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/home/FeaturedCourseCard.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/home/FeaturedCourseCard.test.jsx`

**Interfaces:**
- Consumes: `daysLeft` (Task 7), `formatDistance`, `AVATAR_BASE`/`FALLBACK_AVATAR` from `./constants.js`.
- Props: `{ ladder, onRide, resolveName }` — `ladder` = the `/ladder` response; `resolveName(userId) -> string`; `onRide()` fires the Ride It flow. Renders nothing when `ladder` is null.
- Produces test ids: `featured-course-card`, `featured-ride`, `featured-row-<userId>`.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/Fitness/widgets/CycleGame/home/FeaturedCourseCard.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FeaturedCourseCard from './FeaturedCourseCard.jsx';

const LADDER = {
  course: { id: 'sprint-1500m', label: 'Sprint 1500', win_condition: 'distance', goal_m: 1500 },
  week: { start: '2026-06-29', end: '2026-07-06' },
  standings: [
    { userId: 'dad', bestValue: 150, raceId: 'r1', attempts: 2 },
    { userId: 'milo', bestValue: 190.4, raceId: 'r2', attempts: 1 }
  ],
  allTimeRecord: { userId: 'dad', bestValue: 141, raceId: 'r0', date: '2026-05-12' }
};
const names = { dad: 'Dad', milo: 'Milo' };
const resolveName = (id) => names[id] || id;

describe('FeaturedCourseCard', () => {
  it('renders course, standings with formatted times, record, and Ride It', () => {
    render(<FeaturedCourseCard ladder={LADDER} onRide={() => {}} resolveName={resolveName} />);
    expect(screen.getByTestId('featured-course-card')).toBeTruthy();
    expect(screen.getByText('Sprint 1500')).toBeTruthy();
    expect(screen.getByTestId('featured-row-dad').textContent).toContain('2:30');
    expect(screen.getByTestId('featured-row-milo').textContent).toContain('3:10');
    expect(screen.getByText(/2:21/).textContent).toBeTruthy(); // all-time record
    expect(screen.getByTestId('featured-ride')).toBeTruthy();
  });
  it('formats time-course values as distance', () => {
    const l = { ...LADDER, course: { id: 'e5', label: 'Endurance 5', win_condition: 'time', time_cap_s: 300 },
      standings: [{ userId: 'dad', bestValue: 2140, raceId: 'r1', attempts: 1 }], allTimeRecord: null };
    render(<FeaturedCourseCard ladder={l} onRide={() => {}} resolveName={resolveName} />);
    expect(screen.getByTestId('featured-row-dad').textContent).toContain('2.14 km');
  });
  it('fires onRide and renders nothing without a ladder', () => {
    const onRide = vi.fn();
    const { container, rerender } = render(<FeaturedCourseCard ladder={LADDER} onRide={onRide} resolveName={resolveName} />);
    fireEvent.click(screen.getByTestId('featured-ride'));
    expect(onRide).toHaveBeenCalledTimes(1);
    rerender(<FeaturedCourseCard ladder={null} onRide={onRide} resolveName={resolveName} />);
    expect(container.querySelector('[data-testid="featured-course-card"]')).toBeNull();
  });
});
```

(Verify `formatDistance(2140)` renders `2.14 km` by reading `formatDistance.js` first; adjust the expected string to that function's actual output, not a guess.)

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

```jsx
// frontend/src/modules/Fitness/widgets/CycleGame/home/FeaturedCourseCard.jsx
import React from 'react';
import PropTypes from 'prop-types';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { daysLeft } from '@/modules/Fitness/lib/cycleGame/ladder.js';
import { AVATAR_BASE, FALLBACK_AVATAR } from './constants.js';
import { uiLog } from './uiLog.js';
import './FeaturedCourseCard.scss';

const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};

/**
 * "This Week's Course" — the weekly time-trial ladder. Standings are the
 * household's best attempts this week on the featured course; Ride It starts
 * the course with a rival ghost pre-armed (handled by the container).
 */
export default function FeaturedCourseCard({ ladder = null, onRide = null, resolveName = (id) => id }) {
  if (!ladder?.course) return null;
  const { course, week, standings = [], allTimeRecord = null } = ladder;
  const fmtVal = course.win_condition === 'distance' ? fmtTime : formatDistance;
  const remaining = daysLeft(week?.end);

  return (
    <section className="cgh-featured" data-testid="featured-course-card">
      <div className="cgh-featured__head">
        <div>
          <div className="cgh-section-label">This week&rsquo;s course</div>
          <h3 className="cgh-featured__title">{course.label || course.id}</h3>
        </div>
        <span className="cgh-featured__ends">{remaining > 0 ? `Ends in ${remaining}d` : 'Final day'}</span>
      </div>

      {standings.length === 0 ? (
        <div className="cgh-featured__empty">No rides yet this week — set the first time.</div>
      ) : (
        <ol className="cgh-featured__rows">
          {standings.map((row, i) => (
            <li key={row.userId} className="cgh-featured__row" data-testid={`featured-row-${row.userId}`}>
              <span className="cgh-featured__rank">{i + 1}</span>
              <img
                className="cgh-featured__avatar"
                src={`${AVATAR_BASE}/${row.userId}`}
                onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }}
                alt=""
              />
              <span className="cgh-featured__name">{resolveName(row.userId)}</span>
              <span className="cgh-featured__value">{fmtVal(row.bestValue)}</span>
            </li>
          ))}
        </ol>
      )}

      {allTimeRecord && (
        <div className="cgh-featured__record">
          Record: {fmtVal(allTimeRecord.bestValue)} · {resolveName(allTimeRecord.userId)}
        </div>
      )}

      <button
        type="button"
        className="cgh-featured__ride"
        data-testid="featured-ride"
        onClick={() => { uiLog().info('cycle_game.ui.ride_featured', { courseId: course.id }); onRide?.(); }}
      >
        Ride it
      </button>
    </section>
  );
}

FeaturedCourseCard.propTypes = {
  ladder: PropTypes.object,
  onRide: PropTypes.func,
  resolveName: PropTypes.func
};
```

```scss
// frontend/src/modules/Fitness/widgets/CycleGame/home/FeaturedCourseCard.scss
@use '../_cgTokens.scss' as cg;

.cgh-featured {
  border: 1px solid cg.$cg-line;
  border-radius: 12px;
  padding: 0.9rem 1rem;
  background: cg.$cg-panel;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;

  &__head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }
  &__title { margin: 0; font-size: 1.35rem; }
  &__ends { color: cg.$cg-muted; font-size: 0.95rem; white-space: nowrap; }
  &__empty { color: cg.$cg-muted; font-size: 1rem; padding: 0.3rem 0; }
  &__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  &__row { display: grid; grid-template-columns: 1.4rem 2rem 1fr auto; align-items: center; gap: 0.5rem; font-size: 1.05rem; }
  &__rank { color: cg.$cg-muted; text-align: right; }
  &__avatar { width: 2rem; height: 2rem; border-radius: 50%; object-fit: cover; }
  &__value { font-variant-numeric: tabular-nums; }
  &__record { color: cg.$cg-muted; font-size: 0.95rem; }
  &__ride { align-self: flex-start; }
}
```

(Before writing the SCSS, open `_cgTokens.scss` and `picker.scss` to confirm the actual token names — `$cg-line`/`$cg-panel`/`$cg-muted` must be replaced with whatever the token file really exports, and the button should reuse the lobby's existing button styling class/mixin if one exists rather than inventing one.)

- [ ] **Step 4: Run to verify pass** — `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/home/FeaturedCourseCard.test.jsx`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/home/FeaturedCourseCard.jsx frontend/src/modules/Fitness/widgets/CycleGame/home/FeaturedCourseCard.scss frontend/src/modules/Fitness/widgets/CycleGame/home/FeaturedCourseCard.test.jsx
git commit -m "feat(cycle-game): FeaturedCourseCard lobby component"
```

---

### Task 9: Container wiring — ladder fetch, Ride It, home card

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx`
- Test: append to `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`

**Interfaces:**
- Consumes: Tasks 4 (endpoints), 6 (`mapRaceRecordToCandidate`, `buildGhostFromCandidate`), 7 (`courseStartOverride`, `pickRival`), 8 (card).
- Produces: `CycleGameHome` new props `featured` (ladder|null) + `onRideFeatured`; container state `featuredLadder`; `buildRiders(ghostOverride)`; `startRace(override, ghostOverride)`; `ladderBeforeRef` (consumed by Task 10).

- [ ] **Step 1: Home-level failing test** (append to `CycleGameHome.test.jsx`, matching its existing render-helper style):

```javascript
it('renders the featured-course card and forwards Ride It', () => {
  const onRideFeatured = vi.fn();
  const featured = {
    course: { id: 'sprint-1500m', label: 'Sprint 1500', win_condition: 'distance', goal_m: 1500 },
    week: { start: '2026-06-29', end: '2026-07-06' },
    standings: [{ userId: 'dad', bestValue: 150, raceId: 'r1', attempts: 1 }],
    allTimeRecord: null
  };
  renderHome({ featured, onRideFeatured }); // adapt to the file's existing render helper
  fireEvent.click(screen.getByTestId('featured-ride'));
  expect(onRideFeatured).toHaveBeenCalledTimes(1);
});

it('renders no featured card when the ladder is unavailable', () => {
  renderHome({ featured: null });
  expect(screen.queryByTestId('featured-course-card')).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure** — unknown prop/testid not found.

- [ ] **Step 3: Implement.**

**CycleGameHome.jsx:** add props `featured = null`, `onRideFeatured = null`, `resolveName = (id) => id` (+ PropTypes); import and render the card inside `__main`, directly under the `<header>`:

```jsx
        <FeaturedCourseCard ladder={featured} onRide={onRideFeatured} resolveName={resolveName} />
```

**CycleGameContainer.jsx:**

a) `buildRiders` accepts an override (default preserves behavior):

```javascript
  const buildRiders = useCallback((ghostOverride) => {
    const g = ghostOverride === undefined ? ghost : ghostOverride;
```
…and replace the two `ghost` reads inside with `g` (`if (g && Array.isArray(g.riders))` / `g.riders.forEach`). Dep array unchanged.

b) `startRace` accepts the ghost override and uses it for riders (the `ov` course override already wins for type/goal):

```javascript
  const startRace = useCallback((override = null, ghostOverride = undefined) => {
    ...
    const riders = buildRiders(ghostOverride);
```

c) Ladder state + fetch (place next to the history-load effect; same cancellation pattern):

```javascript
  const [featuredLadder, setFeaturedLadder] = useState(null);
  const ladderBeforeRef = useRef(null); // snapshot at race start, for results movement (Task 10)

  const fetchLadder = useCallback(async () => {
    const resp = await fetch('/api/v1/fitness/cycle-races/ladder');
    if (!resp.ok) return null; // 404 = no featured courses configured — card just hides
    return resp.json();
  }, []);

  useEffect(() => {
    if (phase !== 'idle') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const ladder = await fetchLadder();
        if (!cancelled) {
          setFeaturedLadder(ladder);
          if (ladder) log.info('cycle_game.ladder_loaded', { courseId: ladder.course?.id, rungs: ladder.standings?.length || 0 });
        }
      } catch (err) {
        if (!cancelled) log.warn('cycle_game.ladder_error', { error: err?.message || String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [phase, fetchLadder, log]);
```

d) Ride It handler:

```javascript
  const onRideFeatured = useCallback(async () => {
    const ladder = featuredLadder;
    const course = ladder?.course;
    if (!course) return;
    const firstRider = bikes.map((b) => session?.getEquipmentRider?.(b.id)).find(Boolean) || null;
    const rival = pickRival({ standings: ladder.standings || [], riderId: firstRider });
    let rivalRaceId = rival.raceId;
    if (rival.kind === 'self-pb' && firstRider) {
      try {
        const resp = await fetch(`/api/v1/fitness/cycle-races/personal-bests?userId=${encodeURIComponent(firstRider)}&courseId=${encodeURIComponent(course.id)}`);
        if (resp.ok) rivalRaceId = (await resp.json())?.best?.raceId || null;
      } catch { /* PB lookup is best-effort; race proceeds plain */ }
    }
    let ghostOverride = null;
    if (rivalRaceId) {
      try {
        const resp = await fetch(`/api/v1/fitness/cycle-races/${encodeURIComponent(rivalRaceId)}`);
        if (resp.ok) {
          const { race } = await resp.json();
          const resolveGaugeMaxRpm = (equipmentId) => resolveRpmLimits(bikeById.get(equipmentId) || {}).gaugeMaxRpm;
          const candidate = mapRaceRecordToCandidate(race, { getDisplayLabel, resolveGaugeMaxRpm });
          const built = candidate ? buildGhostFromCandidate(candidate) : null;
          if (built) { ghostOverride = built.ghost; setGhost(built.ghost); }
        }
      } catch { /* ghost is optional — never block the start */ }
    }
    log.info('cycle_game.ride_featured', {
      courseId: course.id, rider: firstRider, rivalKind: rival.kind,
      rivalRaceId: rivalRaceId || null, ghostArmed: !!ghostOverride
    });
    ladderBeforeRef.current = ladder;
    startRace(courseStartOverride(course), ghostOverride ?? null);
  }, [featuredLadder, bikes, session, bikeById, getDisplayLabel, startRace, log]);
```

Note: `startRace`'s second parameter distinguishes `undefined` (use `ghost` state — all existing callers) from `null`/object (explicit). `onRideFeatured` always passes an explicit value so a previously-selected lobby ghost can't leak into a ladder ride.

e) Pass to Home: `featured={featuredLadder}`, `onRideFeatured={onRideFeatured}`, `resolveName={resolveDisplayName}`.

Imports to add: `mapRaceRecordToCandidate, buildGhostFromCandidate` from the lib (Task 6 — extend the existing import), `courseStartOverride, pickRival` from `@/modules/Fitness/lib/cycleGame/ladder.js`, `FeaturedCourseCard` is Home's import, not the container's.

- [ ] **Step 4: Run**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.test.jsx`
Expected: PASS (new cases + all pre-existing)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx
git commit -m "feat(cycle-game): lobby ladder card + Ride It with rival-ghost pre-arm"
```

---

### Task 10: Results ladder-movement callout

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.jsx` (+ `.scss`)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` (save effect + results render)
- Test: append to `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.test.jsx`

**Interfaces:**
- Consumes: Task 7 `ladderDelta`, Task 9 `ladderBeforeRef`/`fetchLadder`/`featuredLadder`.
- Produces: `RaceResults` prop `ladderNotes: string[]` (rendered under the title, testid `race-results-ladder`).

- [ ] **Step 1: Failing test** (append to `RaceResults.test.jsx` in its existing style):

```javascript
it('renders ladder notes when provided, nothing otherwise', () => {
  const { rerender } = render(<RaceResults standings={[]} riders={{}}
    ladderNotes={['Milo: 2nd this week — 0:04 behind Dad', 'Dad: Ladder lead this week!']} />);
  const box = screen.getByTestId('race-results-ladder');
  expect(box.textContent).toContain('Milo: 2nd this week');
  expect(box.textContent).toContain('Ladder lead');
  rerender(<RaceResults standings={[]} riders={{}} ladderNotes={[]} />);
  expect(screen.queryByTestId('race-results-ladder')).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.**

**RaceResults.jsx** — add `ladderNotes = []` to props (+ PropTypes `PropTypes.arrayOf(PropTypes.string)`), render between `</ol>` and the splits block:

```jsx
      {ladderNotes.length > 0 && (
        <div className="race-results__ladder" data-testid="race-results-ladder">
          {ladderNotes.map((note) => (
            <div key={note} className="race-results__ladder-note">{note}</div>
          ))}
        </div>
      )}
```

**RaceResults.scss** — style consistent with the existing legend block (read the file's legend rules and match tone):

```scss
.race-results__ladder {
  margin: 0.6rem auto 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 1.15rem;
}
```

**Container** — state + computation. Add `const [ladderNotes, setLadderNotes] = useState([]);` near the ladder state; clear it in `startRace` (`setLadderNotes([]);` alongside `setRaceEvents([])`). In the save effect (Task at `:1051-1063`), after a successful save (`if (ok) { ... }`), when the race was a featured-course ride, refetch and diff:

```javascript
        if (ok && meta.courseId && meta.courseId === ladderBeforeRef.current?.course?.id) {
          try {
            const after = await fetchLadder();
            if (after?.course?.id === meta.courseId) {
              const course = after.course;
              const fmtVal = course.win_condition === 'distance' ? fmtClock : formatDistance;
              const before = ladderBeforeRef.current?.standings || [];
              const liveIds = Object.keys(engineState.riders || {}).filter((id) => !id.startsWith('ghost:'));
              const notes = liveIds
                .map((userId) => ({ userId, d: ladderDelta({ before, after: after.standings || [], userId }) }))
                .filter(({ d }) => d)
                .slice(0, 3)
                .map(({ userId, d }) => {
                  const name = resolveDisplayName(userId);
                  if (d.isLead) return `${name}: Ladder lead this week!`;
                  const ord = ['','1st','2nd','3rd'][d.rank] || `${d.rank}th`;
                  return `${name}: ${ord} this week — ${fmtVal(d.gapToAbove)} behind ${resolveDisplayName(d.aboveUserId)}`;
                });
              setLadderNotes(notes);
              setFeaturedLadder(after);
              log.info('cycle_game.ladder_movement', { raceId: meta.raceId, notes: notes.length });
            }
          } catch (err) {
            log.warn('cycle_game.ladder_movement_error', { error: err?.message || String(err) });
          }
        }
```

Notes: `fmtClock` = import `formatClock` from `@/modules/Fitness/lib/cycleGame/cycleGameLobby.js` (already exists) aliased, `ladderDelta` from the ladder lib, `formatDistance` is already imported in the container. The save effect's dep array gains `fetchLadder, resolveDisplayName` (both stable callbacks). Pass `ladderNotes={ladderNotes}` to `<RaceResults …>` in the results render.

- [ ] **Step 4: Run**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.jsx frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.scss frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.test.jsx
git commit -m "feat(cycle-game): ladder-movement callouts on the results board"
```

---

### Task 11: Live config + Playwright flow

**Files:**
- Modify (data volume, NOT git): the household fitness config's `cycle_game` block
- Create: `tests/live/flow/fitness/cycle-game-ladder.runtime.test.mjs`

- [ ] **Step 1: Add featured courses to the live config.** Read the current file first:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/fitness.yml' | sed -n '/^cycle_game:/,/^[a-z_]*:/p'
```

Then rewrite the COMPLETE file (never `sed -i`) with these keys added inside the existing `cycle_game:` block, preserving everything else byte-for-byte:

```yaml
  featured_courses:
    - { id: sprint-1500m, label: Sprint 1500, win_condition: distance, goal_m: 1500 }
    - { id: endurance-5min, label: Endurance 5, win_condition: time, time_cap_s: 300 }
  featured_course_override: null
```

Use the heredoc-inside-`sh -c` pattern from CLAUDE.local.md. If the dev server caches config in memory, restart/touch per CLAUDE.md's note before testing.

- [ ] **Step 2: Read an existing cycle-game runtime test** (`ls tests/live/flow/fitness/ | grep cycle-game`, then read the closest match, e.g. the autostart-drive test) and note: how it reaches the cycle-game widget, its URL/fixture imports (`tests/_fixtures/runtime/urls.mjs`), and any shared open/dismiss helpers. **Reuse that harness exactly — do not invent helpers.**

- [ ] **Step 3: Write the flow test** using that harness. Assertions (adapt selectors only if the harness demands):

```javascript
// Shape — imports/navigation copied from the sibling test found in Step 2.
test('featured-course ladder: card renders and Ride It reaches staging', async ({ page }) => {
  // ...navigate to the cycle game exactly as the sibling test does...
  const card = page.getByTestId('featured-course-card');
  await expect(card).toBeVisible();               // config from Step 1 guarantees a ladder
  await expect(card.getByTestId('featured-ride')).toBeVisible();
  await card.getByTestId('featured-ride').click();
  // No rider assigned → startRace warns no_riders and stays idle, OR (if the
  // harness assigns a sim rider first, preferred) staging appears:
  await expect(page.getByTestId('cycle-game-staging')).toBeVisible({ timeout: 5000 });
});
```

Per the No Excuses Policy: if the card doesn't render, that's a real failure (config, endpoint, or route order) — debug it, don't skip. Assign a rider via the same mechanism the sibling sim tests use before clicking Ride It so the staging assertion is real.

- [ ] **Step 4: Run**

```bash
npx playwright test tests/live/flow/fitness/cycle-game-ladder.runtime.test.mjs --reporter=line
```
Expected: PASS (dev server auto-started/reused by playwright config). Capture the runner's own summary line.

- [ ] **Step 5: Commit**

```bash
git add tests/live/flow/fitness/cycle-game-ladder.runtime.test.mjs
git commit -m "test(cycle-game): live ladder flow — card renders, Ride It stages"
```

---

### Task 12: Docs

**Files:**
- Modify: `docs/reference/fitness/cycle-game.md` — add a "Weekly ladder" section: featured-course config keys, rotation rule, the two endpoints with response shapes, matching/ranking semantics (course_id OR legacy fallback; ghosts excluded; ties → earlier raceId), and the index shard location under `history/fitness/cycle-races/_index/`. Present tense, endstate style (no class names in body; directory-pointer footer per house docs style).
- Modify: `docs/superpowers/specs/2026-07-01-cycle-tt-ladder-design.md` — status line → `Implemented`.

- [ ] **Step 1: Write the doc section** (follow the file's existing heading/numbering conventions).
- [ ] **Step 2: Commit**

```bash
git add docs/reference/fitness/cycle-game.md docs/superpowers/specs/2026-07-01-cycle-tt-ladder-design.md
git commit -m "docs(cycle-game): weekly ladder reference + spec status"
```

---

## Final verification (after all tasks)

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  backend/src/2_domains/fitness/services/cycleLadder.test.mjs \
  backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.index.test.mjs \
  backend/src/1_adapters/persistence/yaml/YamlCycleRaceDatastore.test.mjs \
  backend/src/3_applications/fitness/services/CycleRaceService.test.mjs \
  backend/src/4_api/v1/routers/fitness.cycleLadder.test.mjs \
  backend/src/4_api/v1/routers/fitness.grouping.test.mjs \
  frontend/src/modules/Fitness/lib/cycleGame/ \
  frontend/src/modules/Fitness/widgets/CycleGame/ \
  --exclude '**/.claire/**'
npx playwright test tests/live/flow/fitness/cycle-game-ladder.runtime.test.mjs --reporter=line
```

All green, then exercise end-to-end on the dev server (lobby card → Ride It → race → results note) before any Docker build/deploy, per house rules.
