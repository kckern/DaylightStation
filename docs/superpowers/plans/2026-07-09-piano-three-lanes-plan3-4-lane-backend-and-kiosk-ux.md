# Piano Three Lanes — Plan 3+4 (lane-aware backend + kiosk curriculum UX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app consume the new 9-season/3-lane curriculum index (`lane`/`group`/`part`/`song`/`treatment`/`skillChallenge`) end-to-end: backend field flow, lane-routed kiosk home, grouped lesson seasons, part-sectioned lesson lists, and a song-first Repertoire browser.

**Architecture:** The committed index `676490.json` (already regenerated for 9 seasons) flows through `CurriculumIndex` whitelists → `PlexAdapter.#curriculumMerge` → `GetPlayableUnits` lift (`item.piano`, `parents[].piano`) → pure helpers in `modes/Videos/subcourses.js` + new `repertoire.js` → `SubcourseNavigator`/`RepertoireBrowser` components. Only the whitelists block the new fields today; everything downstream is additive.

**Tech Stack:** Node ESM backend, React (react-router) kiosk frontend, vitest.

## Global Constraints

- Index season record: `{ title, lane: 'lessons'|'practice'|'repertoire', groups?: string[], facets?, sequential?, episodes }`. Index episode record adds `lane` (always), `group`, `part`, `song`, `treatment`, `skillChallenge` (optional). Verified against real `backend/src/1_adapters/content/media/plex/curriculum/676490.json` (2434 eps; field census: lane 2434, group 589, part 1436, song 1407, treatment 1515, skillChallenge 108).
- Home lane order is **Practice · Lessons · Repertoire** (matches spec tree S00 → S01-07 → S08).
- Only the **lessons** lane is counted (program ring / Continue) or gated. Practice and Repertoire are always-open, uncounted, ungated.
- **Deviation from spec prose (approved by controller):** the `videos.reference_units` config path is **kept**, because it serves a different show (The Better Piano System, `plex:676075`). For indexed shows, `lane: 'practice'` is authoritative and additive: `partitionSeasons` treats `piano.lane === 'practice'` as reference alongside the config-flag path. Do not delete `reference_units` handling in `GetPlayableUnits`/`GetCourseProgress`.
- Legacy fallback retained in the frontend: `piano.category` ('lesson'/'reference'/'repertoire') still maps into lanes so a stale deployed index can't blank the UI.
- Repertoire catalog card chips are labeled `Tutorial` / `Challenge` / `Accompaniment`; song-page action buttons are `Learn it` / `Master it` / `Comp it`. A song with exactly one treatment skips the song page and opens that treatment directly. `skillChallenge` items render in a separate "Skill Challenges" shelf, never in the song catalog.
- Multi-part courses render as **part section headers inside one lesson list** (gate spans the whole ordered list); no extra navigation level.
- Frontend tests: `cd frontend && npx vitest run src/modules/Piano/PianoKiosk/modes/Videos` (verified working). Backend tests: `npx vitest run tests/isolated/adapters/plex tests/unit/applications/piano` from repo root (verified working).
- Branch: `feat/piano-season-reorg` (continue on it). Frequent commits, one per task.

## File Structure

- Modify: `backend/src/1_adapters/content/media/plex/CurriculumIndex.mjs` — whitelist swap only.
- Modify: `tests/isolated/adapters/plex/CurriculumIndex.test.mjs`, `tests/isolated/adapters/plex/PlexAdapter.curriculum.test.mjs`, `tests/unit/applications/piano/GetPlayableUnits.parentsPiano.test.mjs` — fixtures move to lane model.
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.js` (+ its test) — `laneOf`, `groupCourses`, `partsOf`, lane-based stats; retire `categoryOf`.
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/repertoire.js` (+ test) — `partitionSongs`, `TREATMENTS`.
- Modify: `LessonList.jsx` (+ test) — optional `sections`.
- Modify: `SubcourseNavigator.jsx` (+ test), `SeasonList.jsx` (+ test) — lane routing, grouped cards, repertoire row.
- Rewrite: `RepertoireBrowser.jsx` (+ test) — song-first browser.
- Modify: `frontend/src/Apps/PianoApp.scss` — new `.psc-group*`, `.psc-song*`, `.psc-shelf*`, `.psc-part-title` styles (append near the existing `.psc-repertoire` block at ~line 2439).

---

### Task 1: Backend — lane-aware curriculum whitelists

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/CurriculumIndex.mjs:19-20`
- Test: `tests/isolated/adapters/plex/CurriculumIndex.test.mjs` (rewrite fixtures)
- Test: `tests/isolated/adapters/plex/PlexAdapter.curriculum.test.mjs` (fixture swap: `category`/`kind` → `lane`)
- Test: `tests/unit/applications/piano/GetPlayableUnits.parentsPiano.test.mjs` (fixture swap)

**Interfaces:**
- Produces: `mergeEpisode(index,{season,episode}).piano` now carries `part`, `lane`, `group`, `song`, `treatment`, `skillChallenge` when present; `mergeSeason(index, n).piano` carries `lane`, `groups` and NO LONGER `category`/`kind`. Downstream tasks (frontend) rely on `item.piano.lane/group/part/song/treatment/skillChallenge` and `season.piano.lane/groups`.

- [ ] **Step 1: Update the whitelists**

In `CurriculumIndex.mjs` replace lines 19-20:

```js
const EP_PIANO = ['course', 'part', 'lane', 'group', 'song', 'treatment', 'skillChallenge', 'styles', 'skill', 'instructor', 'focus', 'type'];
const SEASON_PIANO = ['lane', 'groups', 'facets', 'sequential', 'pinned'];
```

- [ ] **Step 2: Rewrite `tests/isolated/adapters/plex/CurriculumIndex.test.mjs` for the lane model**

Replace the whole file with:

```js
import { describe, it, expect } from 'vitest';
import { mergeEpisode, mergeSeason } from '#adapters/content/media/plex/CurriculumIndex.mjs';

// Mirrors the real 9-season 676490.json shapes post-reorg.
const index = {
  show: 676490,
  seasons: {
    '8': { title: 'Song Library', lane: 'repertoire', facets: ['difficulty', 'instructor', 'style'], episodes: 1515 },
    '1': { title: 'Soloing', lane: 'lessons', sequential: true, groups: ['Pop Soloing', '2-5-1 Soloing'] },
    '0': { title: 'Practice', lane: 'practice', groups: ['How to Practice', 'Scales'] },
  },
  episodes: {
    '8:100': { title: 'Learn the Lead Sheet', course: 'Misty', styles: ['Jazz Ballads'], skill: 'Beginner', instructor: 'John Proulx', type: 'Course', lane: 'repertoire', song: 'Misty', treatment: 'tutorial', part: 2 },
    '1:5': { title: 'Line Building', course: 'Pop Soloing with Chord Tone Targets', styles: ['Pop'], skill: 'Beginner', instructor: 'Jonny May', type: 'Workshop', lane: 'lessons', group: 'Pop Soloing' },
    '8:200': { title: 'Day 1', course: '10-Lesson Blues Challenge', styles: ['Blues'], skill: 'Intermediate', instructor: 'Jonny May', type: 'Course', lane: 'repertoire', treatment: 'challenge', skillChallenge: true },
  },
};

describe('mergeEpisode', () => {
  it('surfaces the full lane-model piano block for a repertoire episode', () => {
    const r = mergeEpisode(index, { season: 8, episode: 100 });
    expect(r.title).toBe('Learn the Lead Sheet');
    expect(r.piano).toMatchObject({ course: 'Misty', lane: 'repertoire', song: 'Misty', treatment: 'tutorial', part: 2, styles: ['Jazz Ballads'], skill: 'Beginner', instructor: 'John Proulx' });
  });
  it('surfaces lane + group for a lessons episode, omitting absent fields', () => {
    const r = mergeEpisode(index, { season: 1, episode: 5 });
    expect(r.piano).toMatchObject({ lane: 'lessons', group: 'Pop Soloing' });
    expect(r.piano.song).toBeUndefined();
    expect(r.piano.part).toBeUndefined();
  });
  it('surfaces skillChallenge', () => {
    const r = mergeEpisode(index, { season: 8, episode: 200 });
    expect(r.piano).toMatchObject({ skillChallenge: true, treatment: 'challenge' });
    expect(r.piano.song).toBeUndefined();
  });
  it('returns null for an unknown episode', () => {
    expect(mergeEpisode(index, { season: 99, episode: 9 })).toBeNull();
  });
});

describe('mergeSeason', () => {
  it('returns the lane block with groups', () => {
    expect(mergeSeason(index, 8).piano).toMatchObject({ lane: 'repertoire', facets: ['difficulty', 'instructor', 'style'] });
    expect(mergeSeason(index, 1).piano).toMatchObject({ lane: 'lessons', sequential: true, groups: ['Pop Soloing', '2-5-1 Soloing'] });
    expect(mergeSeason(index, 0).piano).toMatchObject({ lane: 'practice' });
  });
  it('does not emit legacy category/kind keys', () => {
    const p = mergeSeason(index, 8).piano;
    expect(p.category).toBeUndefined();
    expect(p.kind).toBeUndefined();
  });
});
```

- [ ] **Step 3: Update the other two fixture files**

In `tests/isolated/adapters/plex/PlexAdapter.curriculum.test.mjs`: the season fixture currently carries `category: 'repertoire', kind: 'tutorial'`. Change the fixture season to `lane: 'repertoire'` and the assertions at lines ~24-25 to:

```js
expect(item.metadata.piano.lane).toBe('repertoire');
expect(item.metadata.piano.kind).toBeUndefined();
```

(Read the file first; keep all other tests intact, adjusting any other `category`/`kind` references to `lane` the same way.)

In `tests/unit/applications/piano/GetPlayableUnits.parentsPiano.test.mjs`: the in-test index/mock builds seasons with `category`/`kind` and asserts `parents['677395'].piano.category === 'repertoire'`. Swap fixture fields to `lane: 'repertoire'` (drop `kind`) and assertions to `piano.lane === 'repertoire'`. Keep the test's structure (it exercises the parents-map enrichment path, not the whitelist itself).

- [ ] **Step 4: Run the backend tests**

Run: `npx vitest run tests/isolated/adapters/plex tests/unit/applications/piano`
Expected: all files PASS (CurriculumIndex 6 tests, PlexAdapter.curriculum, GetPlayableUnits.parentsPiano, plus any co-resident piano tests untouched).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/CurriculumIndex.mjs tests/isolated/adapters/plex/CurriculumIndex.test.mjs tests/isolated/adapters/plex/PlexAdapter.curriculum.test.mjs tests/unit/applications/piano/GetPlayableUnits.parentsPiano.test.mjs
git commit -m "feat(piano-lanes): lane-aware curriculum whitelists (lane/group/part/song/treatment)"
```

---

### Task 2: Frontend pure helpers — laneOf, groups, parts, lane-based stats

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.test.js` (extend + update)

**Interfaces:**
- Consumes: `season.piano.lane/groups` and `item.piano.group/part` from Task 1's flow.
- Produces (exact signatures, used by Tasks 4-5):
  - `laneOf(season) → 'lessons'|'practice'|'repertoire'`
  - `partitionCourses(seasonItems) → [{floor, label, group, lessons}]` (adds `group`)
  - `groupCourses(season) → [{group: string|null, courses: [...]}]`
  - `partsOf(course) → null | [{part: number|null, label: string, lessons: [...]}]`
  - `programStats(seasons)` / `continueTarget(seasons)` now filter `laneOf(s) === 'lessons'`
  - `categoryOf` is **removed** (grep confirms its only consumers are `programStats`, `continueTarget`, `SubcourseNavigator.jsx`, and tests).

- [ ] **Step 1: Write failing tests**

Append to `subcourses.test.js` (and DELETE any existing `categoryOf` describe block; update any test asserting `partitionCourses` output shape to tolerate the new `group` key — `toMatchObject` tests need no change):

```js
import { laneOf, groupCourses, partsOf } from './subcourses.js'; // merge into existing import line

describe('laneOf', () => {
  it('reads piano.lane', () => {
    expect(laneOf({ piano: { lane: 'practice' } })).toBe('practice');
    expect(laneOf({ piano: { lane: 'repertoire' } })).toBe('repertoire');
  });
  it('maps legacy category', () => {
    expect(laneOf({ piano: { category: 'lesson' } })).toBe('lessons');
    expect(laneOf({ piano: { category: 'reference' } })).toBe('practice');
    expect(laneOf({ piano: { category: 'repertoire' } })).toBe('repertoire');
  });
  it('falls back to reference flag, else lessons', () => {
    expect(laneOf({ reference: true })).toBe('practice');
    expect(laneOf({})).toBe('lessons');
  });
});

describe('partitionCourses group attachment', () => {
  it('carries the group of the first lesson', () => {
    const items = [
      { itemIndex: 1, title: 'A – x', piano: { course: 'A', group: 'Pop Soloing' } },
      { itemIndex: 2, title: 'A – y', piano: { course: 'A', group: 'Pop Soloing' } },
      { itemIndex: 3, title: 'B – x', piano: { course: 'B', group: '2-5-1 Soloing' } },
    ];
    const courses = partitionCourses(items);
    expect(courses.map((c) => c.group)).toEqual(['Pop Soloing', '2-5-1 Soloing']);
  });
});

describe('groupCourses', () => {
  const season = {
    piano: { lane: 'lessons', groups: ['Pop Soloing', '2-5-1 Soloing'] },
    courses: [
      { floor: 1, label: 'B', group: '2-5-1 Soloing', lessons: [] },
      { floor: 2, label: 'A', group: 'Pop Soloing', lessons: [] },
      { floor: 3, label: 'C', group: 'Pop Soloing', lessons: [] },
    ],
  };
  it('orders buckets by season.piano.groups', () => {
    const g = groupCourses(season);
    expect(g.map((b) => b.group)).toEqual(['Pop Soloing', '2-5-1 Soloing']);
    expect(g[0].courses.map((c) => c.label)).toEqual(['A', 'C']);
  });
  it('collapses to a single null bucket when courses carry no groups', () => {
    const s = { courses: [{ floor: 1, label: 'A', group: null, lessons: [] }] };
    expect(groupCourses(s)).toEqual([{ group: null, courses: s.courses }]);
  });
  it('appends undeclared groups after declared ones', () => {
    const s = { piano: { groups: ['X'] }, courses: [
      { floor: 1, label: 'a', group: 'Y', lessons: [] },
      { floor: 2, label: 'b', group: 'X', lessons: [] },
    ] };
    expect(groupCourses(s).map((b) => b.group)).toEqual(['X', 'Y']);
  });
});

describe('partsOf', () => {
  it('returns null for a single-part course', () => {
    expect(partsOf({ label: 'A', lessons: [{ piano: {} }, { piano: { part: 1 } }] })).toBeNull();
  });
  it('splits a multi-part course preserving lesson order', () => {
    const course = { label: 'Scales', lessons: [
      { itemIndex: 1, piano: { part: 1 } }, { itemIndex: 2, piano: { part: 1 } },
      { itemIndex: 3, piano: { part: 2 } },
    ] };
    const parts = partsOf(course);
    expect(parts.map((p) => p.label)).toEqual(['Part 1', 'Part 2']);
    expect(parts[0].lessons).toHaveLength(2);
    expect(parts[1].lessons).toHaveLength(1);
  });
});

describe('lane-based program stats', () => {
  const watched = { userWatched: true };
  const seasons = [
    { id: 's0', piano: { lane: 'practice' }, courses: [{ floor: 1, label: 'p', lessons: [{}] }] },
    { id: 's1', piano: { lane: 'lessons' }, courses: [{ floor: 1, label: 'l', lessons: [watched, {}] }] },
    { id: 's8', piano: { lane: 'repertoire' }, courses: [{ floor: 1, label: 'r', lessons: [{}] }] },
  ];
  it('programStats counts only the lessons lane', () => {
    expect(programStats(seasons).totalCourses).toBe(1);
  });
  it('continueTarget skips practice and repertoire', () => {
    const t = continueTarget(seasons);
    expect(t.seasonId).toBe('s1');
  });
});
```

Note: `lectureUserStatus` treats `userWatched: true` as watched (existing behaviour relied on by the current suite).

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/subcourses.test.js`
Expected: FAIL — `laneOf`/`groupCourses`/`partsOf` not exported.

- [ ] **Step 3: Implement in `subcourses.js`**

Replace `categoryOf` (lines 154-159) with, and update `partitionCourses`, `partitionSeasons`, `programStats`, `continueTarget`:

```js
/** Season lane: piano.lane, legacy piano.category mapped, else reference-flag → practice, else lessons. */
const LEGACY_LANE = { lesson: 'lessons', reference: 'practice', repertoire: 'repertoire' };
export function laneOf(season) {
  const lane = season?.piano?.lane;
  if (lane) return lane;
  const c = season?.piano?.category;
  if (c) return LEGACY_LANE[c] || c;
  return season?.reference ? 'practice' : 'lessons';
}
```

`partitionCourses` return line becomes:

```js
  return order.map((label, i) => ({
    floor: i + 1,
    label,
    group: groups.get(label)[0]?.piano?.group ?? null,
    lessons: groups.get(label),
  }));
```

`partitionSeasons` reference line becomes (lane-aware, config path retained):

```js
    reference: refSet.has(String(id)) || p?.piano?.lane === 'practice' || p?.piano?.category === 'reference',
```

`programStats` filter becomes `laneOf(s) === 'lessons'`; `continueTarget` filter becomes `laneOf(x) === 'lessons'`.

Add the two new helpers after `continueTarget`:

```js
/** Bucket a season's courses by intra-season group, ordered by season.piano.groups
 *  (declared first, stragglers in appearance order). Single/no-group seasons
 *  collapse to one null bucket so callers can skip headers. */
export function groupCourses(season) {
  const courses = season?.courses || [];
  const buckets = new Map();
  const seen = [];
  for (const c of courses) {
    const g = c.group || null;
    if (!buckets.has(g)) { buckets.set(g, []); seen.push(g); }
    buckets.get(g).push(c);
  }
  if (seen.length < 2) return [{ group: null, courses }];
  const declared = (season?.piano?.groups || []).filter((g) => buckets.has(g));
  const rest = seen.filter((g) => !declared.includes(g));
  return [...declared, ...rest].map((g) => ({ group: g, courses: buckets.get(g) }));
}

/** Split a course's lessons into Part sections (piano.part). Null unless the
 *  course genuinely spans ≥2 numbered parts; lesson order is preserved (parts
 *  ascend with episode number by construction). */
export function partsOf(course) {
  const lessons = course?.lessons || [];
  const parts = new Map();
  const order = [];
  for (const l of lessons) {
    const n = Number(l?.piano?.part);
    const key = Number.isFinite(n) ? n : null;
    if (!parts.has(key)) { parts.set(key, []); order.push(key); }
    parts.get(key).push(l);
  }
  if (order.filter((k) => k !== null).length < 2) return null;
  return order.map((k) => ({ part: k, label: k === null ? 'Extras' : `Part ${k}`, lessons: parts.get(k) }));
}
```

Then remove the now-unused `categoryOf` export. Do NOT touch `floorOf`/`roomOf` (dead but out of scope, noted in prior review).

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/subcourses.test.js`
Expected: PASS (existing 38 + new; if an existing test imported `categoryOf`, rewrite it against `laneOf` equivalently).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/subcourses.test.js
git commit -m "feat(piano-lanes): laneOf/groupCourses/partsOf; program stats count lessons lane"
```

---

### Task 3: Repertoire pure helpers — `repertoire.js`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/repertoire.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/repertoire.test.js`

**Interfaces:**
- Consumes: repertoire items with `item.piano.song/treatment/skillChallenge/course`.
- Produces (used by Task 5):
  - `TREATMENTS = [{key:'tutorial',chip:'Tutorial',action:'Learn it'},{key:'challenge',chip:'Challenge',action:'Master it'},{key:'accompaniment',chip:'Accompaniment',action:'Comp it'}]`
  - `partitionSongs(items) → { songs: [{title, treatments: {tutorial?:[items],challenge?:[items],accompaniment?:[items]}, count}], skillChallenges: [{title, lessons}] }` — songs sorted alphabetically (case-insensitive), skillChallenges in appearance order.
  - `availableTreatments(song) → [TREATMENTS entries present on the song, in TREATMENTS order]`

- [ ] **Step 1: Write failing tests** — create `repertoire.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { partitionSongs, availableTreatments, TREATMENTS } from './repertoire.js';

const ep = (song, treatment, extra = {}) => ({ title: `${song} ep`, piano: { song, treatment, course: song, ...extra } });

describe('partitionSongs', () => {
  it('merges treatments of one song into one entry', () => {
    const { songs } = partitionSongs([
      ep('Misty', 'tutorial'), ep('Misty', 'tutorial'),
      ep('Misty', 'challenge'), ep('Misty', 'accompaniment'),
    ]);
    expect(songs).toHaveLength(1);
    expect(songs[0].title).toBe('Misty');
    expect(songs[0].treatments.tutorial).toHaveLength(2);
    expect(songs[0].treatments.challenge).toHaveLength(1);
    expect(songs[0].treatments.accompaniment).toHaveLength(1);
    expect(songs[0].count).toBe(4);
  });
  it('sorts songs alphabetically, case-insensitive', () => {
    const { songs } = partitionSongs([ep('blue Moon', 'tutorial'), ep('Autumn Leaves', 'tutorial')]);
    expect(songs.map((s) => s.title)).toEqual(['Autumn Leaves', 'blue Moon']);
  });
  it('routes skillChallenge items to the shelf, grouped by course', () => {
    const { songs, skillChallenges } = partitionSongs([
      { title: 'Day 1', piano: { course: '10-Lesson Blues Challenge', treatment: 'challenge', skillChallenge: true } },
      { title: 'Day 2', piano: { course: '10-Lesson Blues Challenge', treatment: 'challenge', skillChallenge: true } },
      ep('Misty', 'tutorial'),
    ]);
    expect(songs).toHaveLength(1);
    expect(skillChallenges).toHaveLength(1);
    expect(skillChallenges[0].title).toBe('10-Lesson Blues Challenge');
    expect(skillChallenges[0].lessons).toHaveLength(2);
  });
  it('falls back to course/title when song is absent', () => {
    const { songs } = partitionSongs([{ title: 'Solo ep', piano: { course: 'Some Course', treatment: 'tutorial' } }]);
    expect(songs[0].title).toBe('Some Course');
  });
});

describe('availableTreatments', () => {
  it('returns present treatments in canonical order', () => {
    const { songs } = partitionSongs([ep('Misty', 'accompaniment'), ep('Misty', 'tutorial')]);
    expect(availableTreatments(songs[0]).map((t) => t.key)).toEqual(['tutorial', 'accompaniment']);
  });
  it('TREATMENTS carries the copy contract', () => {
    expect(TREATMENTS.map((t) => t.action)).toEqual(['Learn it', 'Master it', 'Comp it']);
    expect(TREATMENTS.map((t) => t.chip)).toEqual(['Tutorial', 'Challenge', 'Accompaniment']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/repertoire.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `repertoire.js`**

```js
// repertoire.js — pure helpers for the song-first Repertoire lane.
// A repertoire item carries piano.song (catalog identity), piano.treatment
// (tutorial|challenge|accompaniment) and optionally piano.skillChallenge
// (non-song challenge → Skill Challenges shelf, never the song catalog).

export const TREATMENTS = [
  { key: 'tutorial', chip: 'Tutorial', action: 'Learn it' },
  { key: 'challenge', chip: 'Challenge', action: 'Master it' },
  { key: 'accompaniment', chip: 'Accompaniment', action: 'Comp it' },
];

export function partitionSongs(items) {
  const songs = new Map();
  const shelf = new Map();
  const shelfOrder = [];
  for (const it of items || []) {
    const p = it?.piano || {};
    if (p.skillChallenge) {
      const key = p.course || it.title || 'Challenge';
      if (!shelf.has(key)) { shelf.set(key, []); shelfOrder.push(key); }
      shelf.get(key).push(it);
      continue;
    }
    const key = p.song || p.course || it.title || 'Song';
    if (!songs.has(key)) songs.set(key, { title: key, treatments: {}, count: 0 });
    const rec = songs.get(key);
    const t = p.treatment || 'tutorial';
    (rec.treatments[t] ||= []).push(it);
    rec.count += 1;
  }
  return {
    songs: [...songs.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase())),
    skillChallenges: shelfOrder.map((k) => ({ title: k, lessons: shelf.get(k) })),
  };
}

export function availableTreatments(song) {
  return TREATMENTS.filter((t) => (song?.treatments?.[t.key] || []).length > 0);
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/repertoire.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/repertoire.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/repertoire.test.js
git commit -m "feat(piano-lanes): partitionSongs/availableTreatments repertoire helpers"
```

---

### Task 4: LessonList sections + lane-routed SubcourseNavigator + SeasonList repertoire row

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/LessonList.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/SeasonList.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (append group/part styles)
- Test: `LessonList.test.jsx`, `SubcourseNavigator.test.jsx`, `SeasonList.test.jsx` (extend; update lane fixtures)

**Interfaces:**
- Consumes: `laneOf`, `groupCourses`, `partsOf` (Task 2).
- Produces: `LessonList` accepts optional `sections: [{label, lessons}]` — when given (≥2 sections), renders a header per section; the gate is still computed over the flat `lessons` prop, so locking spans parts. `SubcourseNavigator` home shows lanes titled Practice / Lessons / Repertoire in that order.

- [ ] **Step 1: Write failing tests**

Append to `LessonList.test.jsx`:

```jsx
it('renders part section headers while gating across the whole list', () => {
  const lessons = [
    { plex: 'a', title: 'One', userWatched: true, piano: { part: 1 } },
    { plex: 'b', title: 'Two', piano: { part: 1 } },
    { plex: 'c', title: 'Three', piano: { part: 2 } },
  ];
  const sections = [
    { label: 'Part 1', lessons: lessons.slice(0, 2) },
    { label: 'Part 2', lessons: lessons.slice(2) },
  ];
  render(<LessonList lessons={lessons} sections={sections} onPlay={() => {}} />);
  expect(screen.getByText('Part 1')).toBeInTheDocument();
  expect(screen.getByText('Part 2')).toBeInTheDocument();
  // gate: 'Two' is current, 'Three' (in Part 2) locked
  expect(screen.getByText('Three').closest('button')).toBeDisabled();
  expect(screen.getByText('Two').closest('button')).not.toBeDisabled();
});
```

Append to `SubcourseNavigator.test.jsx` (match the file's existing render/fixture helpers — read it first; the fixtures build `items` + `parents`; move their season piano blocks to `lane`):

```jsx
it('home shows Practice · Lessons · Repertoire lanes from piano.lane', () => {
  // parents: s0 lane practice, s1 lane lessons, s8 lane repertoire (+ items in each)
  // render and assert the three lane headings appear in DOM order
  const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
  expect(headings).toEqual(['Practice', 'Lessons', 'Repertoire']);
});

it('a grouped lessons season renders group headers around course cards', () => {
  // open the lessons season whose parents piano block carries groups: ['Pop Soloing','2-5-1 Soloing']
  // and whose items carry piano.group accordingly
  expect(screen.getByText('Pop Soloing')).toBeInTheDocument();
  expect(screen.getByText('2-5-1 Soloing')).toBeInTheDocument();
});
```

(Write these as real tests against the file's existing fixture style — the two snippets define the assertions required; the implementer builds fixtures matching the Interfaces block. Update every existing fixture in this file that uses `piano: { category: ... }` to the equivalent `piano: { lane: ... }`, keeping one legacy-category fixture to pin the fallback.)

Append to `SeasonList.test.jsx`:

```jsx
it('renders a repertoire season as a song-library row without a ring', () => {
  const seasons = [{ id: 'r1', index: 8, title: 'Song Library', reference: false, piano: { lane: 'repertoire' }, lessons: new Array(5).fill({}), courses: [] }];
  render(<SeasonList seasons={seasons} onSelect={() => {}} />);
  expect(screen.getByText('Song Library')).toBeInTheDocument();
  expect(screen.getByText(/browse by song/i)).toBeInTheDocument();
  expect(document.querySelector('.psc-ring')).toBeNull();
});
```

(If `ProgressRing`'s root class differs from `.psc-ring`, read `ProgressRing.jsx` and use its actual class.)

- [ ] **Step 2: Run to verify failures**

Run: `cd frontend && npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/LessonList.test.jsx src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.test.jsx src/modules/Piano/PianoKiosk/modes/Videos/SeasonList.test.jsx`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

**LessonList.jsx** — extract the row into a local function and support `sections`:

```jsx
export default function LessonList({ lessons, sections = null, onPlay, sequential = true, reference = false }) {
  const gate = sequential && !reference;
  const { lockedIds, currentId } = useMemo(
    () => (gate ? courseGate(lessons) : { lockedIds: new Set(), currentId: null }),
    [gate, lessons],
  );
  const row = (item) => {
    /* the existing <li> body verbatim, keyed as today */
  };
  if (Array.isArray(sections) && sections.length > 1) {
    return (
      <div className="psc-lesson-sections">
        {sections.map((sec) => (
          <section key={sec.label} className="psc-lesson-section">
            <h4 className="psc-part-title">{sec.label}</h4>
            <ul className="piano-episodes psc-lessons">{(sec.lessons || []).map(row)}</ul>
          </section>
        ))}
      </div>
    );
  }
  return <ul className="piano-episodes psc-lessons">{(lessons || []).map(row)}</ul>;
}
```

(The `row` closure reads `lockedIds`/`currentId` computed from the flat `lessons` prop, so gating spans sections. Move the existing map body into `row` verbatim.)

**SubcourseNavigator.jsx** — swap imports and lane logic:

```jsx
import { partitionSeasons, programStats, seasonStats, continueTarget, courseStats, laneOf, groupCourses, partsOf } from './subcourses.js';

const LANES = [
  { key: 'practice', title: 'Practice' },
  { key: 'lessons', title: 'Lessons' },
  { key: 'repertoire', title: 'Repertoire' },
];
```

- Home bucket filter: `seasons.filter((s) => laneOf(s) === key)`.
- Repertoire branch: `else if (laneOf(season) === 'repertoire')` (replaces `categoryOf(season) === 'repertoire'`).
- Season ring: return null for non-lessons seasons — replace the season line of the `ring` IIFE with:

```jsx
    if (season) {
      if (laneOf(season) !== 'lessons') return null;
      const st = seasonStats(season);
      return { percent: st.percent, label: `${st.percent}%`, done: st.totalCourses > 0 && st.completeCourses === st.totalCourses };
    }
```

- Course-cards pane becomes group-aware:

```jsx
  } else {
    const grouped = groupCourses(season);
    const cards = (bucket) => (
      <CourseCards season={{ ...season, courses: bucket.courses }}
        currentFloor={cont?.seasonId === season.id ? cont.floor : null}
        onSelect={(c) => setFloor(c.floor)} />
    );
    pane = grouped.length === 1 ? cards(grouped[0]) : (
      <div className="psc-groups">
        {grouped.map((b) => (
          <section key={b.group ?? '_'} className="psc-group">
            <h4 className="psc-group-title">{b.group}</h4>
            {cards(b)}
          </section>
        ))}
      </div>
    );
  }
```

- Lesson pane gets part sections:

```jsx
  } else if (activeCourse) {
    pane = <LessonList lessons={activeCourse.lessons} sections={partsOf(activeCourse)} onPlay={onPlay} reference={activeCourse.reference} />;
  }
```

**SeasonList.jsx** — insert a repertoire branch before the reference branch:

```jsx
        if ((s.piano?.lane || s.piano?.category) === 'repertoire') {
          return (
            <li key={s.id}>
              <button type="button" className="psc-row psc-row--songs" style={{ '--tint': tint }} onClick={() => onSelect(s)} title={name}>
                <span className="psc-row__tint" />
                <span className="psc-row__resmark" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                </span>
                <span className="psc-row__meta"><span className="psc-row__name">{name}</span>
                  <span className="psc-row__sub">{s.lessons.length} lessons · browse by song</span></span>
                <span className="psc-tag psc-tag--res">song library</span>
              </button>
            </li>
          );
        }
```

**PianoApp.scss** — append after the `.psc-repertoire__back` rules (~line 2453):

```scss
.psc-groups{display:flex; flex-direction:column; gap:1.1rem;}
.psc-group-title{margin:0 0 .5rem; font-family:var(--piano-mono, ui-monospace, monospace); font-size:.7rem;
  letter-spacing:.12em; text-transform:uppercase; color:var(--piano-muted);}
.psc-lesson-sections{display:flex; flex-direction:column; gap:1rem;}
.psc-part-title{margin:0 0 .45rem; font-family:var(--piano-mono, ui-monospace, monospace); font-size:.7rem;
  letter-spacing:.12em; text-transform:uppercase; color:var(--piano-muted);}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/modules/Piano/PianoKiosk/modes/Videos`
Expected: whole Videos suite PASS (update any pre-existing fixtures still using `piano.category` in this directory's tests, keeping one explicit legacy-fallback test in `subcourses.test.js`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/LessonList.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/SubcourseNavigator.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/SeasonList.jsx frontend/src/Apps/PianoApp.scss frontend/src/modules/Piano/PianoKiosk/modes/Videos/*.test.jsx
git commit -m "feat(piano-lanes): lane-routed navigator, grouped course cards, part sections, song-library row"
```

---

### Task 5: Song-first RepertoireBrowser

**Files:**
- Rewrite: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/RepertoireBrowser.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (song catalog styles)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/RepertoireBrowser.test.jsx` (rewrite)

**Interfaces:**
- Consumes: `partitionSongs`, `availableTreatments`, `TREATMENTS` (Task 3); `collectFacets`, `filterByFacets`, `partsOf` (Task 2); `LessonList` sections (Task 4).
- Produces: `<RepertoireBrowser season onPlay />` — same external contract as today (SubcourseNavigator passes `season` with `.lessons` and `onPlay`).

- [ ] **Step 1: Rewrite the test file**

Replace `RepertoireBrowser.test.jsx` with:

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import RepertoireBrowser from './RepertoireBrowser.jsx';

const ep = (id, song, treatment, extra = {}) => ({
  plex: id, itemIndex: id, title: `${song} – ${treatment} lesson`,
  piano: { song, course: song, treatment, styles: ['Jazz Ballads'], skill: 'Beginner', instructor: 'Jonny May', ...extra },
});

const season = (lessons) => ({ id: 's8', index: 8, title: 'Song Library', lessons, courses: [] });

describe('RepertoireBrowser (song-first)', () => {
  it('renders one card per song with treatment chips', () => {
    render(<RepertoireBrowser season={season([
      ep(1, 'Misty', 'tutorial'), ep(2, 'Misty', 'challenge'),
      ep(3, 'Autumn Leaves', 'tutorial'),
    ])} onPlay={() => {}} />);
    expect(screen.getByText('2 songs')).toBeInTheDocument();
    const misty = screen.getByText('Misty').closest('button');
    expect(misty).toHaveTextContent('Tutorial');
    expect(misty).toHaveTextContent('Challenge');
    expect(misty).not.toHaveTextContent('Accompaniment');
  });

  it('multi-treatment song opens a song page with action buttons', () => {
    render(<RepertoireBrowser season={season([
      ep(1, 'Misty', 'tutorial'), ep(2, 'Misty', 'challenge'),
    ])} onPlay={() => {}} />);
    fireEvent.click(screen.getByText('Misty').closest('button'));
    expect(screen.getByText('Learn it')).toBeInTheDocument();
    expect(screen.getByText('Master it')).toBeInTheDocument();
    expect(screen.queryByText('Comp it')).toBeNull();
  });

  it('single-treatment song skips straight to its lessons', () => {
    render(<RepertoireBrowser season={season([ep(1, 'Blue Moon', 'tutorial')])} onPlay={() => {}} />);
    fireEvent.click(screen.getByText('Blue Moon').closest('button'));
    expect(screen.getByText('Blue Moon – tutorial lesson')).toBeInTheDocument(); // lesson row, no song page
  });

  it('treatment lessons are ungated and playable', () => {
    const onPlay = vi.fn();
    render(<RepertoireBrowser season={season([ep(1, 'Blue Moon', 'tutorial'), ep(2, 'Blue Moon', 'tutorial')])} onPlay={onPlay} />);
    fireEvent.click(screen.getByText('Blue Moon').closest('button'));
    const rows = screen.getAllByText(/tutorial lesson/).map((el) => el.closest('button'));
    rows.forEach((r) => expect(r).not.toBeDisabled());
    fireEvent.click(rows[1]);
    expect(onPlay).toHaveBeenCalled();
  });

  it('skill challenges render in their own shelf, not the catalog', () => {
    render(<RepertoireBrowser season={season([
      ep(1, 'Misty', 'tutorial'),
      { plex: 9, itemIndex: 9, title: 'Day 1', piano: { course: '10-Lesson Blues Challenge', treatment: 'challenge', skillChallenge: true } },
    ])} onPlay={() => {}} />);
    expect(screen.getByText('Skill Challenges')).toBeInTheDocument();
    expect(screen.getByText('10-Lesson Blues Challenge')).toBeInTheDocument();
    expect(screen.getByText('1 song')).toBeInTheDocument(); // challenge not counted as a song
  });

  it('search narrows the song catalog', () => {
    render(<RepertoireBrowser season={season([
      ep(1, 'Misty', 'tutorial'), ep(2, 'Autumn Leaves', 'tutorial'),
    ])} onPlay={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'mist' } });
    expect(screen.getByText('Misty')).toBeInTheDocument();
    expect(screen.queryByText('Autumn Leaves')).toBeNull();
  });

  it('facet chips filter the catalog', () => {
    render(<RepertoireBrowser season={season([
      ep(1, 'Misty', 'tutorial'),
      ep(2, 'Rocket Man', 'tutorial', { styles: ['Pop'] }),
    ])} onPlay={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pop' }));
    expect(screen.getByText('Rocket Man')).toBeInTheDocument();
    expect(screen.queryByText('Misty')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/RepertoireBrowser.test.jsx`
Expected: FAIL against the old treatment-flat implementation.

- [ ] **Step 3: Rewrite `RepertoireBrowser.jsx`**

```jsx
import { useMemo, useState } from 'react';
import { collectFacets, filterByFacets, partsOf } from './subcourses.js';
import { partitionSongs, availableTreatments } from './repertoire.js';
import LessonList from './LessonList.jsx';

function ChipRow({ label, options, value, onToggle }) {
  if (!options || !options.length) return null;
  return (
    <div className="psc-repertoire__facet">
      <span className="psc-repertoire__facet-label">{label}</span>
      <div className="psc-repertoire__chips">
        {options.map((opt) => (
          <button type="button" key={opt} className={`psc-chip${value === opt ? ' is-on' : ''}`}
            aria-pressed={value === opt} onClick={() => onToggle(opt)}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Lessons of one treatment (or one skill challenge): ungated, part-sectioned. */
function TreatmentLessons({ lessons, onPlay }) {
  const ordered = useMemo(
    () => [...(lessons || [])].sort((a, b) => (Number(a?.itemIndex) || 0) - (Number(b?.itemIndex) || 0)),
    [lessons],
  );
  const sections = useMemo(() => partsOf({ lessons: ordered }), [ordered]);
  return <LessonList lessons={ordered} sections={sections} onPlay={onPlay} sequential={false} reference />;
}

/**
 * Song-first browser for the Repertoire lane. Level 1 is a searchable, faceted
 * song catalog (one card per piano.song, treatment chips) plus a Skill
 * Challenges shelf; level 2 a song page (Learn it / Master it / Comp it);
 * level 3 the treatment's lessons, part-sectioned and never gated. A song with
 * a single treatment opens it directly.
 */
export default function RepertoireBrowser({ season, onPlay }) {
  const items = season?.lessons || [];
  const facets = useMemo(() => collectFacets(items), [items]);
  const [selected, setSelected] = useState({ style: null, skill: null, instructor: null });
  const [query, setQuery] = useState('');
  // view: null | {song} | {song, treatment} | {challenge}
  const [view, setView] = useState(null);

  const toggle = (dim, val) => setSelected((s) => ({ ...s, [dim]: s[dim] === val ? null : val }));

  const catalog = useMemo(() => partitionSongs(filterByFacets(items, selected)), [items, selected]);
  const q = query.trim().toLowerCase();
  const songs = useMemo(
    () => (q ? catalog.songs.filter((s) => s.title.toLowerCase().includes(q)) : catalog.songs),
    [catalog, q],
  );
  const challenges = useMemo(
    () => (q ? catalog.skillChallenges.filter((c) => c.title.toLowerCase().includes(q)) : catalog.skillChallenges),
    [catalog, q],
  );

  const openSong = (song) => {
    const avail = availableTreatments(song);
    setView(avail.length === 1 ? { song, treatment: avail[0].key } : { song });
  };

  if (view?.challenge) {
    return (
      <div className="psc-repertoire">
        <button type="button" className="psc-repertoire__back" onClick={() => setView(null)}>◂ Songs</button>
        <h3 className="psc-song-head">{view.challenge.title}</h3>
        <TreatmentLessons lessons={view.challenge.lessons} onPlay={onPlay} />
      </div>
    );
  }

  if (view?.song && view.treatment) {
    const avail = availableTreatments(view.song);
    const t = avail.find((x) => x.key === view.treatment);
    return (
      <div className="psc-repertoire">
        <button type="button" className="psc-repertoire__back"
          onClick={() => setView(avail.length === 1 ? null : { song: view.song })}>
          ◂ {avail.length === 1 ? 'Songs' : view.song.title}
        </button>
        <h3 className="psc-song-head">{view.song.title} <span className="psc-song-head__t">{t?.chip}</span></h3>
        <TreatmentLessons lessons={view.song.treatments[view.treatment]} onPlay={onPlay} />
      </div>
    );
  }

  if (view?.song) {
    const avail = availableTreatments(view.song);
    return (
      <div className="psc-repertoire">
        <button type="button" className="psc-repertoire__back" onClick={() => setView(null)}>◂ Songs</button>
        <h3 className="psc-song-head">{view.song.title}</h3>
        <div className="psc-song-actions">
          {avail.map((t) => {
            const n = view.song.treatments[t.key].length;
            return (
              <button type="button" key={t.key} className={`psc-song-action psc-song-action--${t.key}`}
                onClick={() => setView({ song: view.song, treatment: t.key })}>
                <span className="psc-song-action__do">{t.action}</span>
                <span className="psc-song-action__sub">{t.chip} · {n} lesson{n === 1 ? '' : 's'}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="psc-repertoire">
      <input type="search" className="psc-repertoire__search" placeholder="Search songs…"
        value={query} onChange={(e) => setQuery(e.target.value)} />
      <ChipRow label="Style" options={facets.styles} value={selected.style} onToggle={(v) => toggle('style', v)} />
      <ChipRow label="Difficulty" options={facets.skills} value={selected.skill} onToggle={(v) => toggle('skill', v)} />
      <ChipRow label="Teacher" options={facets.instructors} value={selected.instructor} onToggle={(v) => toggle('instructor', v)} />
      {challenges.length > 0 && (
        <div className="psc-shelf">
          <h4 className="psc-shelf__title">Skill Challenges</h4>
          <div className="psc-shelf__row">
            {challenges.map((c) => (
              <button type="button" key={c.title} className="psc-shelf__card" onClick={() => setView({ challenge: c })}>
                <span className="psc-shelf__name">{c.title}</span>
                <span className="psc-shelf__sub">{c.lessons.length} lesson{c.lessons.length === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="psc-repertoire__count">{songs.length} song{songs.length === 1 ? '' : 's'}</div>
      <ul className="psc-songs">
        {songs.map((s) => (
          <li key={s.title}>
            <button type="button" className="psc-song" onClick={() => openSong(s)} title={s.title}>
              <span className="psc-song__name">{s.title}</span>
              <span className="psc-song__chips">
                {availableTreatments(s).map((t) => (
                  <span key={t.key} className={`psc-song-chip psc-song-chip--${t.key}`}>{t.chip}</span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Append song-catalog styles to `PianoApp.scss`** (after the Task 4 additions):

```scss
.psc-songs{list-style:none; margin:0; padding:0; display:grid; gap:.55rem;
  grid-template-columns:repeat(auto-fill, minmax(15rem, 1fr));}
.psc-song{width:100%; display:flex; flex-direction:column; gap:.45rem; align-items:flex-start;
  padding:.7rem .85rem; border-radius:var(--r-md); border:1px solid var(--piano-line);
  background:var(--piano-panel); cursor:pointer; text-align:left;}
.psc-song:hover,.psc-song:focus-visible{border-color:var(--piano-accent);}
.psc-song__name{font-family:var(--piano-serif, Georgia, serif); font-size:1rem; color:var(--piano-fg);}
.psc-song__chips{display:flex; gap:.3rem; flex-wrap:wrap;}
.psc-song-chip{font-family:var(--piano-mono, ui-monospace, monospace); font-size:.58rem;
  letter-spacing:.08em; text-transform:uppercase; padding:.14rem .45rem; border-radius:999px;
  border:1px solid var(--piano-line); color:var(--piano-muted);}
.psc-song-chip--tutorial{border-color:color-mix(in srgb, var(--piano-accent) 55%, transparent); color:var(--piano-accent);}
.psc-song-chip--challenge{border-color:color-mix(in srgb, #d08340 55%, transparent); color:#d08340;}
.psc-song-chip--accompaniment{border-color:color-mix(in srgb, #5f9d7a 55%, transparent); color:#5f9d7a;}
.psc-song-head{margin:0; font-family:var(--piano-serif, Georgia, serif); font-size:1.25rem; color:var(--piano-fg);}
.psc-song-head__t{font-family:var(--piano-mono, ui-monospace, monospace); font-size:.62rem;
  letter-spacing:.1em; text-transform:uppercase; color:var(--piano-muted); margin-left:.5rem;}
.psc-song-actions{display:flex; gap:.7rem; flex-wrap:wrap;}
.psc-song-action{display:flex; flex-direction:column; gap:.2rem; align-items:flex-start;
  padding:.85rem 1.1rem; border-radius:var(--r-md); border:1px solid var(--piano-line);
  background:var(--piano-panel); cursor:pointer; min-width:11rem; text-align:left;}
.psc-song-action:hover,.psc-song-action:focus-visible{border-color:var(--piano-accent);}
.psc-song-action__do{font-family:var(--piano-serif, Georgia, serif); font-size:1.05rem; color:var(--piano-fg);}
.psc-song-action__sub{font-family:var(--piano-mono, ui-monospace, monospace); font-size:.62rem;
  letter-spacing:.08em; text-transform:uppercase; color:var(--piano-muted);}
.psc-shelf{display:flex; flex-direction:column; gap:.5rem;}
.psc-shelf__title{margin:0; font-family:var(--piano-mono, ui-monospace, monospace); font-size:.7rem;
  letter-spacing:.12em; text-transform:uppercase; color:var(--piano-muted);}
.psc-shelf__row{display:flex; gap:.55rem; overflow-x:auto; padding-bottom:.25rem;}
.psc-shelf__card{flex:0 0 auto; display:flex; flex-direction:column; gap:.2rem; align-items:flex-start;
  padding:.6rem .8rem; border-radius:var(--r-md); border:1px dashed var(--piano-line);
  background:transparent; cursor:pointer; text-align:left;}
.psc-shelf__card:hover,.psc-shelf__card:focus-visible{border-color:var(--piano-accent);}
.psc-shelf__name{font-size:.85rem; color:var(--piano-fg);}
.psc-shelf__sub{font-family:var(--piano-mono, ui-monospace, monospace); font-size:.6rem;
  letter-spacing:.08em; text-transform:uppercase; color:var(--piano-muted);}
```

(If `color-mix` or any CSS var above doesn't exist in this stylesheet's vocabulary, mirror how the existing `.psc-chip`/`.psc-tag` rules color themselves instead — read the neighboring rules first and match their idiom.)

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run src/modules/Piano/PianoKiosk/modes/Videos/RepertoireBrowser.test.jsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/RepertoireBrowser.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/RepertoireBrowser.test.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano-lanes): song-first RepertoireBrowser with treatment pages + skill-challenge shelf"
```

---

### Task 6: Whole-suite sweep + build

**Files:**
- Modify: any remaining test/fixture in `frontend/src/modules/Piano/PianoKiosk/` still using `piano.category`/`categoryOf` (e.g. `Videos.subcourse.test.jsx`, `CourseCards.test.jsx`, `usePianoCoursePlayable.test.js`)

**Interfaces:** none new — this task proves the branch is coherent.

- [ ] **Step 1: Grep for stragglers**

Run: `grep -rn "categoryOf\|category: *'\(lesson\|reference\|repertoire\)'" frontend/src/modules/Piano/ | grep -v "laneOf\|LEGACY"`
Expected: only the intentional legacy-fallback test in `subcourses.test.js` (and the `laneOf` implementation). Fix anything else to the lane model.

- [ ] **Step 2: Full Videos suite**

Run: `cd frontend && npx vitest run src/modules/Piano/PianoKiosk`
Expected: PASS, 0 failures (piano-wide, not just Videos — catches PianoConfig/nav integration fixtures).

- [ ] **Step 3: Backend suites**

Run: `npx vitest run tests/isolated/adapters/plex tests/unit/applications/piano`
Expected: PASS.

- [ ] **Step 4: Production build**

Run: `cd frontend && npx vite build 2>&1 | tail -5`
Expected: build completes with no errors.

- [ ] **Step 5: Commit any sweep fixes**

```bash
git add -A frontend/src/modules/Piano
git commit -m "test(piano-lanes): migrate remaining fixtures to lane model" # only if changes exist
```
