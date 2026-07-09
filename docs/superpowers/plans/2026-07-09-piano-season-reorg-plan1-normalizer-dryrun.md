# Piano Season Reorg — Plan 1: Normalizer Dry Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure planning module + dry-run CLI that computes the full old→new normalization for every `Piano With Jonny` episode and emits a reviewable manifest — writing nothing to the NAS.

**Architecture:** A pure, I/O-free module `cli/curriculum/normalizePlan.mjs` holds all classification logic (base/part split, lane, new season+group, song/treatment, title cleanup, renumbering). A thin CLI `cli/curriculum/normalize.mjs` reads the NFO/filename inputs, calls the pure module, and writes a manifest + summaries + song-merge list to a report file. This mirrors the existing `nfoIndex.mjs` (pure) / `build-index.mjs` (I/O) split. **This plan writes ZERO changes to the media files** — it only produces the review artifact that gates Plan 2.

**Tech Stack:** Node ESM (`.mjs`), vitest. No new dependencies.

## Global Constraints

- Target show: `Piano With Jonny`, Plex `676490`, NFO root `/media/kckern/Media/Lectures/Piano With Jonny`. Old season dirs named `Season NN - <name>/`; episode files `Piano With Jonny - S<nn>E<nn> - <title>.{mp4,nfo}`; sidecar `season.nfo` per dir.
- Episode count MUST be conserved: exactly 2,434 episodes in, 2,434 in the plan.
- Final tree (new season number → name → lane): `0 Practice [practice]`, `1 Soloing [lessons]`, `2 Improvisation [lessons]`, `3 Chord Voicings [lessons]`, `4 Chord Theory & Color [lessons]`, `5 Lead Sheet Application [lessons]`, `6 Comping & Rhythm [lessons]`, `7 Intros, Endings & Fills [lessons]`, `8 Song Library [repertoire]`.
- Lane values are the literal strings `lessons` | `practice` | `repertoire`.
- Treatment values are the literal strings `tutorial` | `challenge` | `accompaniment`.
- A course is a "numbered part" when its `Course:` tag ends with ` – N` or ` N` (integer). Strip it → base; the integer → `part`.
- Repertoire song identity comes from the `Course:` tag, NEVER from a title substring (the "Ear Training … – Silent Night" landmine).
- This plan produces NO writes to `/media/kckern/Media`; the CLI's only output is the report file under the scratchpad.
- Pure module has zero imports from `fs`/`path`/`process`.

---

### Task 1: `baseCourseAndPart` — split trailing part number

**Files:**
- Create: `cli/curriculum/normalizePlan.mjs`
- Test: `cli/curriculum/normalizePlan.test.mjs`

**Interfaces:**
- Produces: `baseCourseAndPart(course: string) => { base: string, part: number|null }`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { baseCourseAndPart } from './normalizePlan.mjs';

describe('baseCourseAndPart', () => {
  it('strips a trailing en-dash part number', () => {
    expect(baseCourseAndPart('Silent Night – Rhumba 1')).toEqual({ base: 'Silent Night – Rhumba', part: 1 });
    expect(baseCourseAndPart('Jazz Swing Rhythm Essentials – 2')).toEqual({ base: 'Jazz Swing Rhythm Essentials', part: 2 });
  });
  it('strips a trailing bare part number', () => {
    expect(baseCourseAndPart('Epic Minor Chords 2')).toEqual({ base: 'Epic Minor Chords', part: 2 });
  });
  it('leaves single-part courses untouched', () => {
    expect(baseCourseAndPart('Altered Dominant Rootless Voicings')).toEqual({ base: 'Altered Dominant Rootless Voicings', part: null });
  });
  it('does not strip a number that is part of the name', () => {
    expect(baseCourseAndPart('5 Jazz Comping Approaches 1')).toEqual({ base: '5 Jazz Comping Approaches', part: 1 });
    expect(baseCourseAndPart('2-5-1 Soloing with Bebop Scales')).toEqual({ base: '2-5-1 Soloing with Bebop Scales', part: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/curriculum/normalizePlan.test.mjs -t baseCourseAndPart`
Expected: FAIL — `baseCourseAndPart is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// cli/curriculum/normalizePlan.mjs — pure normalization planning (no I/O).

// A "part" is a trailing integer after an optional en/em/hyphen dash separator,
// OR a bare trailing integer preceded by a space. "2-5-1" and leading "5 Jazz…"
// are safe because we only strip a SPACE-separated trailing integer.
export function baseCourseAndPart(course) {
  const s = String(course || '').trim();
  const dash = s.match(/^(.*\S)\s+[–—-]\s+(\d+)$/);   // "Name – 2"
  if (dash) return { base: dash[1].trim(), part: Number(dash[2]) };
  const bare = s.match(/^(.*\S)\s+(\d+)$/);            // "Name 2"
  if (bare) return { base: bare[1].trim(), part: Number(bare[2]) };
  return { base: s, part: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/curriculum/normalizePlan.test.mjs -t baseCourseAndPart`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/curriculum/normalizePlan.mjs cli/curriculum/normalizePlan.test.mjs
git commit -m "feat(piano-reorg): baseCourseAndPart part-number split"
```

---

### Task 2: `classify` — lane, new season, group, treatment

**Files:**
- Modify: `cli/curriculum/normalizePlan.mjs`
- Test: `cli/curriculum/normalizePlan.test.mjs`

**Interfaces:**
- Consumes: `baseCourseAndPart`
- Produces: `classify(oldSeason: number, base: string) => { lane, newSeason, seasonName, group: string|null, treatment: string|null }`

- [ ] **Step 1: Write the failing test**

```js
import { classify } from './normalizePlan.mjs';

describe('classify', () => {
  it('routes practice sources into new season 0 with topic groups', () => {
    expect(classify(0, 'Practice Essentials Course')).toMatchObject({ lane: 'practice', newSeason: 0, seasonName: 'Practice', group: 'How to Practice' });
    expect(classify(5, 'The Major Blues Scale (Gospel Scale)')).toMatchObject({ lane: 'practice', newSeason: 0, group: 'Scales' });
    expect(classify(9, 'Two-Hand Coordination Exercises')).toMatchObject({ lane: 'practice', newSeason: 0, group: 'Two-Hand Coordination' });
    expect(classify(9, 'Dominant 7th Chord Exercises')).toMatchObject({ lane: 'practice', newSeason: 0, group: 'Chord & Voicing Exercises' });
  });
  it('splits old Season 08 by strand: essentials→Lessons(6), exercises→Practice(0)', () => {
    expect(classify(8, 'Jazz Swing Rhythm Essentials')).toMatchObject({ lane: 'lessons', newSeason: 6, seasonName: 'Comping & Rhythm', group: 'Rhythm Essentials' });
    expect(classify(8, 'Bossa Nova – Rhythm Exercises')).toMatchObject({ lane: 'practice', newSeason: 0, group: 'Rhythm Exercises' });
  });
  it('combines old S01+S02 into Soloing with per-source groups', () => {
    expect(classify(1, 'Pop Soloing With Chord Tone Targets')).toMatchObject({ newSeason: 1, seasonName: 'Soloing', group: 'Pop Soloing' });
    expect(classify(2, '2-5-1 Soloing with Bebop Scales')).toMatchObject({ newSeason: 1, seasonName: 'Soloing', group: '2-5-1 Soloing' });
  });
  it('splits old Season 04 into Voicings / Theory / Lead Sheets', () => {
    expect(classify(4, 'Major Drop 2 Voicings')).toMatchObject({ newSeason: 3, seasonName: 'Chord Voicings', group: 'Drop 2 Voicings' });
    expect(classify(4, 'Dominant Quartal Voicings')).toMatchObject({ newSeason: 3, group: 'Quartal Voicings' });
    expect(classify(4, 'Minor Block Chords')).toMatchObject({ newSeason: 3, group: 'Block Chords' });
    expect(classify(4, 'Major Chord Rootless Voicings')).toMatchObject({ newSeason: 3, group: 'Rootless Voicings' });
    expect(classify(4, 'Piano Chord Extensions')).toMatchObject({ newSeason: 4, seasonName: 'Chord Theory & Color', group: null });
    expect(classify(4, 'Passing Chords & Reharmonization')).toMatchObject({ newSeason: 4, group: null });
    expect(classify(4, 'Play Piano Lead Sheets With Block Chords')).toMatchObject({ newSeason: 5, seasonName: 'Lead Sheet Application', group: null });
  });
  it('maps remaining lessons seasons and repertoire treatments', () => {
    expect(classify(3, 'Scales for Improv on 7th Chords')).toMatchObject({ lane: 'lessons', newSeason: 2, seasonName: 'Improvisation' });
    expect(classify(6, 'Jazzy Blues Comping')).toMatchObject({ newSeason: 6, seasonName: 'Comping & Rhythm', group: 'Comping' });
    expect(classify(7, 'Soloing Over a Turnaround')).toMatchObject({ newSeason: 7, seasonName: 'Intros, Endings & Fills' });
    expect(classify(10, 'Autumn Leaves')).toMatchObject({ lane: 'repertoire', newSeason: 8, seasonName: 'Song Library', treatment: 'tutorial' });
    expect(classify(11, 'Autumn Leaves – Challenge')).toMatchObject({ lane: 'repertoire', newSeason: 8, treatment: 'challenge' });
    expect(classify(12, 'Jazz Swing Accompaniment')).toMatchObject({ lane: 'repertoire', newSeason: 8, treatment: 'accompaniment' });
  });
  it('keeps an in-lesson exercise inside its Lessons season (S07 exception)', () => {
    expect(classify(7, 'Major Turnaround Exercises With 7th Chords')).toMatchObject({ lane: 'lessons', newSeason: 7 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/curriculum/normalizePlan.test.mjs -t classify`
Expected: FAIL — `classify is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `cli/curriculum/normalizePlan.mjs`:

```js
const isExercise = (base) => /exercise/i.test(base);

function voicingGroup(base) {
  if (/Rootless/i.test(base)) return 'Rootless Voicings';
  if (/Drop 2/i.test(base)) return 'Drop 2 Voicings';
  if (/Quartal/i.test(base)) return 'Quartal Voicings';
  return 'Block Chords';                       // matched /Block Chords/ by caller
}

// oldSeason + base (part already stripped) → target placement.
export function classify(oldSeason, base) {
  const s = Number(oldSeason);
  // ---- Practice (new season 0) ----
  if (s === 0) return { lane: 'practice', newSeason: 0, seasonName: 'Practice', group: 'How to Practice', treatment: null };
  if (s === 5) return { lane: 'practice', newSeason: 0, seasonName: 'Practice', group: 'Scales', treatment: null };
  if (s === 9) {
    const group = /two-hand|coordination/i.test(base) ? 'Two-Hand Coordination' : 'Chord & Voicing Exercises';
    return { lane: 'practice', newSeason: 0, seasonName: 'Practice', group, treatment: null };
  }
  if (s === 8) {
    if (isExercise(base)) return { lane: 'practice', newSeason: 0, seasonName: 'Practice', group: 'Rhythm Exercises', treatment: null };
    return { lane: 'lessons', newSeason: 6, seasonName: 'Comping & Rhythm', group: 'Rhythm Essentials', treatment: null };
  }
  // ---- Lessons ----
  if (s === 1) return { lane: 'lessons', newSeason: 1, seasonName: 'Soloing', group: 'Pop Soloing', treatment: null };
  if (s === 2) return { lane: 'lessons', newSeason: 1, seasonName: 'Soloing', group: '2-5-1 Soloing', treatment: null };
  if (s === 3) return { lane: 'lessons', newSeason: 2, seasonName: 'Improvisation', group: null, treatment: null };
  if (s === 4) {
    if (/Play Piano Lead Sheets/i.test(base)) return { lane: 'lessons', newSeason: 5, seasonName: 'Lead Sheet Application', group: null, treatment: null };
    if (/Rootless|Drop 2|Quartal|Block Chords/i.test(base)) return { lane: 'lessons', newSeason: 3, seasonName: 'Chord Voicings', group: voicingGroup(base), treatment: null };
    return { lane: 'lessons', newSeason: 4, seasonName: 'Chord Theory & Color', group: null, treatment: null };
  }
  if (s === 6) return { lane: 'lessons', newSeason: 6, seasonName: 'Comping & Rhythm', group: 'Comping', treatment: null };
  if (s === 7) return { lane: 'lessons', newSeason: 7, seasonName: 'Intros, Endings & Fills', group: null, treatment: null };
  // ---- Repertoire (new season 8) ----
  if (s === 10) return { lane: 'repertoire', newSeason: 8, seasonName: 'Song Library', group: null, treatment: 'tutorial' };
  if (s === 11) return { lane: 'repertoire', newSeason: 8, seasonName: 'Song Library', group: null, treatment: 'challenge' };
  if (s === 12) return { lane: 'repertoire', newSeason: 8, seasonName: 'Song Library', group: null, treatment: 'accompaniment' };
  throw new Error(`classify: unmapped old season ${oldSeason}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/curriculum/normalizePlan.test.mjs -t classify`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/curriculum/normalizePlan.mjs cli/curriculum/normalizePlan.test.mjs
git commit -m "feat(piano-reorg): classify lane/new-season/group/treatment"
```

---

### Task 3: `songFields` — song key/display, skill-challenge flag

**Files:**
- Modify: `cli/curriculum/normalizePlan.mjs`
- Test: `cli/curriculum/normalizePlan.test.mjs`

**Interfaces:**
- Produces: `songFields(base: string, styles: string[]) => { song: string|null, songKey: string|null, skillChallenge: boolean }`
  - `song`: display name (null when skillChallenge). `songKey`: normalized merge key (null when skillChallenge). `skillChallenge`: true for non-song challenges.

**Note:** `songFields` is best-effort; the dry-run song-merge list (Task 5) is the human review that corrects its edges. It is only meaningful for repertoire base names.

- [ ] **Step 1: Write the failing test**

```js
import { songFields } from './normalizePlan.mjs';

describe('songFields', () => {
  it('merges punctuation/casing/treatment variants to one key', () => {
    const a = songFields('Fly Me To The Moon', []);
    const b = songFields('Fly Me to the Moon – Challenge', []);
    const c = songFields('Fly Me To The Moon – Challenge', []);
    expect(a.songKey).toBe(b.songKey);
    expect(b.songKey).toBe(c.songKey);
    expect(a.song).toBe('Fly Me To The Moon');   // display from the first/tutorial form
    expect(a.skillChallenge).toBe(false);
  });
  it('strips a trailing style token that matches the episode styles', () => {
    const jb = songFields('Silent Night – Jazz Ballad', ['Jazz Ballads']);
    const rh = songFields('Silent Night – Rhumba', ['Latin']);
    expect(jb.songKey).toBe('silent night');
    expect(rh.songKey).toBe('silent night');
  });
  it('flags non-song challenges as skillChallenge with null song', () => {
    for (const n of ['Blues Improvisation Challenge', 'The 10-Lesson Blues Challenge', 'The Halloween Progression Challenge', 'Jazz Ballad Soloing Challenge']) {
      const r = songFields(n, []);
      expect(r.skillChallenge).toBe(true);
      expect(r.song).toBeNull();
      expect(r.songKey).toBeNull();
    }
  });
  it('does NOT treat a technique course with an example song as that song', () => {
    // "Ear Training With Holiday Songs 1" is a technique course, not a Silent Night song.
    const r = songFields('Ear Training With Holiday Songs', []);
    expect(r.songKey).toBe('ear training with holiday songs');
    expect(r.skillChallenge).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/curriculum/normalizePlan.test.mjs -t songFields`
Expected: FAIL — `songFields is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `cli/curriculum/normalizePlan.mjs`:

```js
// Non-song challenge markers: a challenge whose base is a skill/progression, not a song title.
const SKILL_CHALLENGE = /\b(improvisation|soloing|progression|\d+-lesson|smooth jazz|bossa nova soloing)\b/i;

// Style tokens sometimes suffixed onto a repertoire course name.
const STYLE_SUFFIX = /\s*[–—-]\s*(Jazz Ballad|Jazz Swing|Jazz Waltz|Bossa Nova|Rhumba|Bolero|Stride|Slow Gospel Blues|Slow Blues|Gospel|Blues|Funk|Latin|Pop|Cocktail Jazz|Swing|Ballad|Waltz)\s*$/i;

function stripRole(base) {
  let c = String(base || '');
  c = c.replace(/\s*[–—-]?\s*(Challenge|Accompaniment Patterns?|Accompaniment)\s*$/i, '').trim();
  return c;
}

export function songFields(base, styles = []) {
  const raw = String(base || '');
  if (SKILL_CHALLENGE.test(raw)) return { song: null, songKey: null, skillChallenge: true };
  let display = stripRole(raw);
  // strip a trailing style token (either a known style or one present in this ep's styles)
  const styleAlt = (styles || []).map((s) => s.replace(/s$/i, '')).filter(Boolean);
  const dynamic = styleAlt.length ? new RegExp(`\\s*[–—-]\\s*(${styleAlt.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})s?\\s*$`, 'i') : null;
  display = display.replace(STYLE_SUFFIX, '').trim();
  if (dynamic) display = display.replace(dynamic, '').trim();
  const songKey = display.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
  return { song: display || null, songKey: songKey || null, skillChallenge: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/curriculum/normalizePlan.test.mjs -t songFields`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/curriculum/normalizePlan.mjs cli/curriculum/normalizePlan.test.mjs
git commit -m "feat(piano-reorg): songFields normalization + skill-challenge flag"
```

---

### Task 4: `cleanTitle` — strip redundant course prefix from episode title

**Files:**
- Modify: `cli/curriculum/normalizePlan.mjs`
- Test: `cli/curriculum/normalizePlan.test.mjs`

**Interfaces:**
- Produces: `cleanTitle(title: string, course: string) => string` — removes a leading `<course> – ` (or `<course> N – `) prefix from the episode title, leaving the distinctive lesson name. Returns the whole title unchanged when no prefix matches.

- [ ] **Step 1: Write the failing test**

```js
import { cleanTitle } from './normalizePlan.mjs';

describe('cleanTitle', () => {
  it('strips the "Course N – " prefix', () => {
    expect(cleanTitle('Silent Night – Rhumba 1 – Rhumba Groove Exercise', 'Silent Night – Rhumba 1'))
      .toBe('Rhumba Groove Exercise');
    expect(cleanTitle('Soloing Over a Turnaround 2 – Stride, Walking Bass', 'Soloing Over a Turnaround 2'))
      .toBe('Stride, Walking Bass');
  });
  it('leaves a title without the course prefix unchanged', () => {
    expect(cleanTitle('How to Practice', 'Practice Essentials Course')).toBe('How to Practice');
  });
  it('never returns empty (falls back to full title)', () => {
    expect(cleanTitle('Jazzy Blues Comping', 'Jazzy Blues Comping')).toBe('Jazzy Blues Comping');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/curriculum/normalizePlan.test.mjs -t cleanTitle`
Expected: FAIL — `cleanTitle is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `cli/curriculum/normalizePlan.mjs`:

```js
export function cleanTitle(title, course) {
  const t = String(title || '').trim();
  const c = String(course || '').trim();
  if (!c) return t;
  const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // match "<course>" optionally followed by " N", then a dash separator
  const re = new RegExp(`^${esc}(?:\\s+\\d+)?\\s*[–—-]\\s*`, 'i');
  const stripped = t.replace(re, '').trim();
  return stripped || t;   // never empty
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/curriculum/normalizePlan.test.mjs -t cleanTitle`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/curriculum/normalizePlan.mjs cli/curriculum/normalizePlan.test.mjs
git commit -m "feat(piano-reorg): cleanTitle strips redundant course prefix"
```

---

### Task 5: `buildNormalizationPlan` — assemble, renumber, summarize

**Files:**
- Modify: `cli/curriculum/normalizePlan.mjs`
- Test: `cli/curriculum/normalizePlan.test.mjs`

**Interfaces:**
- Consumes: `baseCourseAndPart`, `classify`, `songFields`, `cleanTitle`
- Produces: `buildNormalizationPlan(records: Record[]) => Plan`
  - `Record = { file, oldSeason, oldEpisode, course, styles: string[], title, wistia }`
  - `Plan = { episodes: PlanEpisode[], seasons: SeasonSummary[], songMerge: SongMergeRow[] }`
  - `PlanEpisode = { ...record, base, part, lane, newSeason, seasonName, group, song, songKey, treatment, skillChallenge, newTitle, newEpisode, newDir, newBasename }`
  - `SeasonSummary = { newSeason, seasonName, lane, count, groups: {name, count}[] }`
  - `SongMergeRow = { songKey, song, courses: string[], treatments: string[], count }`
  - Renumber rule: within each `newSeason`, sort by `(oldSeason, oldEpisode)` and assign `newEpisode` = 1..N. `newDir` = `Season <NN> - <seasonName>` (NN zero-padded to 2). `newBasename` = `Piano With Jonny - S<NN>E<EE> - <sanitized newTitle>` (no extension; `/`→`-`).

- [ ] **Step 1: Write the failing test**

```js
import { buildNormalizationPlan } from './normalizePlan.mjs';

const rec = (o) => ({ file: 'x.nfo', styles: [], wistia: 'w'+Math.abs(o.oldEpisode), ...o });

describe('buildNormalizationPlan', () => {
  it('renumbers each new season 1..N by (oldSeason, oldEpisode) and conserves count', () => {
    const recs = [
      rec({ oldSeason: 2, oldEpisode: 5, course: '2-5-1 Soloing with Bebop Scales', title: '2-5-1 Soloing with Bebop Scales – A' }),
      rec({ oldSeason: 1, oldEpisode: 9, course: 'Pop Soloing', title: 'Pop Soloing – Intro' }),
      rec({ oldSeason: 1, oldEpisode: 3, course: 'Pop Soloing', title: 'Pop Soloing – Setup' }),
    ];
    const plan = buildNormalizationPlan(recs);
    expect(plan.episodes.length).toBe(3);
    const soloing = plan.episodes.filter((e) => e.newSeason === 1).sort((a, b) => a.newEpisode - b.newEpisode);
    // old S1E3, S1E9, then S2E5 → new E1,E2,E3
    expect(soloing.map((e) => [e.oldSeason, e.oldEpisode, e.newEpisode]))
      .toEqual([[1, 3, 1], [1, 9, 2], [2, 5, 3]]);
    expect(soloing[0].newDir).toBe('Season 01 - Soloing');
    expect(soloing[0].newBasename).toBe('Piano With Jonny - S01E01 - Setup');
  });
  it('collapses multi-part courses under one base with part numbers', () => {
    const recs = [
      rec({ oldSeason: 7, oldEpisode: 56, course: 'Soloing Over a Turnaround 2', title: 'Soloing Over a Turnaround 2 – Stride' }),
      rec({ oldSeason: 7, oldEpisode: 34, course: 'Soloing Over a Turnaround 1', title: 'Soloing Over a Turnaround 1 – Progression' }),
    ];
    const plan = buildNormalizationPlan(recs);
    const bases = plan.episodes.map((e) => ({ base: e.base, part: e.part, title: e.newTitle }));
    expect(bases).toContainEqual({ base: 'Soloing Over a Turnaround', part: 1, title: 'Progression' });
    expect(bases).toContainEqual({ base: 'Soloing Over a Turnaround', part: 2, title: 'Stride' });
  });
  it('emits a song-merge row joining treatment variants', () => {
    const recs = [
      rec({ oldSeason: 10, oldEpisode: 1, course: 'Fly Me To The Moon', title: 'Fly Me To The Moon – A' }),
      rec({ oldSeason: 11, oldEpisode: 2, course: 'Fly Me to the Moon – Challenge', title: 'Fly Me to the Moon – Challenge – B' }),
      rec({ oldSeason: 12, oldEpisode: 3, course: 'Fly Me To The Moon Accompaniment', title: 'Fly Me To The Moon Accompaniment – C' }),
    ];
    const plan = buildNormalizationPlan(recs);
    const row = plan.songMerge.find((r) => r.songKey === 'fly me to the moon');
    expect(row).toBeTruthy();
    expect(row.treatments.sort()).toEqual(['accompaniment', 'challenge', 'tutorial']);
    expect(row.count).toBe(3);
  });
  it('summarizes seasons with per-group counts', () => {
    const recs = [
      rec({ oldSeason: 4, oldEpisode: 1, course: 'Major Drop 2 Voicings', title: 'Major Drop 2 Voicings – A' }),
      rec({ oldSeason: 4, oldEpisode: 2, course: 'Minor Block Chords', title: 'Minor Block Chords – A' }),
    ];
    const plan = buildNormalizationPlan(recs);
    const s3 = plan.seasons.find((s) => s.newSeason === 3);
    expect(s3).toMatchObject({ seasonName: 'Chord Voicings', lane: 'lessons', count: 2 });
    expect(s3.groups.map((g) => g.name).sort()).toEqual(['Block Chords', 'Drop 2 Voicings']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/curriculum/normalizePlan.test.mjs -t buildNormalizationPlan`
Expected: FAIL — `buildNormalizationPlan is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `cli/curriculum/normalizePlan.mjs`:

```js
const pad2 = (n) => String(n).padStart(2, '0');
const sanitize = (s) => String(s).replace(/\//g, '-').trim();

export function buildNormalizationPlan(records) {
  const episodes = (records || []).map((r) => {
    const { base, part } = baseCourseAndPart(r.course);
    const cls = classify(r.oldSeason, base);
    const sf = cls.lane === 'repertoire' ? songFields(base, r.styles) : { song: null, songKey: null, skillChallenge: false };
    const newTitle = cleanTitle(r.title, r.course);
    return {
      ...r, base, part, ...cls,
      song: sf.song, songKey: sf.songKey, skillChallenge: sf.skillChallenge,
      newTitle,
    };
  });

  // Renumber within each new season by (oldSeason, oldEpisode).
  const bySeason = new Map();
  for (const e of episodes) {
    if (!bySeason.has(e.newSeason)) bySeason.set(e.newSeason, []);
    bySeason.get(e.newSeason).push(e);
  }
  for (const [, list] of bySeason) {
    list.sort((a, b) => (a.oldSeason - b.oldSeason) || (a.oldEpisode - b.oldEpisode));
    list.forEach((e, i) => {
      e.newEpisode = i + 1;
      e.newDir = `Season ${pad2(e.newSeason)} - ${e.seasonName}`;
      e.newBasename = `Piano With Jonny - S${pad2(e.newSeason)}E${pad2(e.newEpisode)} - ${sanitize(e.newTitle)}`;
    });
  }

  // Season summaries (ordered by newSeason).
  const seasons = [...bySeason.keys()].sort((a, b) => a - b).map((sn) => {
    const list = bySeason.get(sn);
    const groups = new Map();
    for (const e of list) { const g = e.group || '—'; groups.set(g, (groups.get(g) || 0) + 1); }
    return {
      newSeason: sn, seasonName: list[0].seasonName, lane: list[0].lane, count: list.length,
      groups: [...groups.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  // Song-merge rows (repertoire only, non-skill).
  const merge = new Map();
  for (const e of episodes) {
    if (e.lane !== 'repertoire' || e.skillChallenge || !e.songKey) continue;
    if (!merge.has(e.songKey)) merge.set(e.songKey, { songKey: e.songKey, song: e.song, courses: new Set(), treatments: new Set(), count: 0 });
    const row = merge.get(e.songKey);
    row.courses.add(e.course); row.treatments.add(e.treatment); row.count += 1;
  }
  const songMerge = [...merge.values()]
    .map((r) => ({ songKey: r.songKey, song: r.song, courses: [...r.courses], treatments: [...r.treatments], count: r.count }))
    .sort((a, b) => a.song.localeCompare(b.song));

  return { episodes, seasons, songMerge };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/curriculum/normalizePlan.test.mjs -t buildNormalizationPlan`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole pure suite + commit**

Run: `npx vitest run cli/curriculum/normalizePlan.test.mjs`
Expected: PASS (all ~22 assertions across the 5 describe blocks).

```bash
git add cli/curriculum/normalizePlan.mjs cli/curriculum/normalizePlan.test.mjs
git commit -m "feat(piano-reorg): buildNormalizationPlan renumber + summaries + song-merge"
```

---

### Task 6: `normalize.mjs` dry-run CLI — read NFOs, emit manifest

**Files:**
- Create: `cli/curriculum/normalize.mjs`

**Interfaces:**
- Consumes: `buildNormalizationPlan` from `./normalizePlan.mjs`
- CLI: `node cli/curriculum/normalize.mjs <nfo-root> <report-out>` — dry run only (this plan). Reads every `Season */*.nfo` (skipping `season.nfo`), builds records `{ file, oldSeason, oldEpisode, course, styles, title, wistia }`, runs the plan, writes a human-readable report + a machine-readable `<report-out>.json`.

- [ ] **Step 1: Write the CLI**

```js
#!/usr/bin/env node
// Usage: node cli/curriculum/normalize.mjs <nfo-root> <report-out>
// DRY RUN ONLY (Plan 1): reads NFOs, writes a normalization manifest. No media writes.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { buildNormalizationPlan } from './normalizePlan.mjs';

const unesc = (s) => (s == null ? s : s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
const one = (xml, el) => { const m = xml.match(new RegExp(`<${el}>([\\s\\S]*?)</${el}>`)); return m ? unesc(m[1].trim()) : null; };
const GENERIC = new Set(['Music', 'Educational']);

const [root, reportOut] = process.argv.slice(2);
if (!root || !reportOut) { console.error('Usage: normalize.mjs <nfo-root> <report-out>'); process.exit(1); }

const records = [];
for (const dir of readdirSync(root)) {
  const p = join(root, dir);
  if (!statSync(p).isDirectory() || !/^Season /.test(dir)) continue;
  const oldSeasonMatch = dir.match(/^Season (\d+)/);
  const oldSeason = oldSeasonMatch ? Number(oldSeasonMatch[1]) : null;
  for (const f of readdirSync(p)) {
    if (!f.endsWith('.nfo') || f === 'season.nfo') continue;
    const xml = readFileSync(join(p, f), 'utf8');
    const genres = [...xml.matchAll(/<genre>([^<]+)<\/genre>/g)].map((m) => unesc(m[1].trim()));
    const wistiaM = xml.match(/<uniqueid[^>]*type="wistia"[^>]*>([^<]+)<\/uniqueid>/);
    records.push({
      file: join(dir, f),
      oldSeason: oldSeason ?? Number(one(xml, 'season')),
      oldEpisode: Number(one(xml, 'episode')),
      course: (xml.match(/<tag>Course:\s*([^<]+)<\/tag>/) || [, null])[1]?.trim() ? unesc(xml.match(/<tag>Course:\s*([^<]+)<\/tag>/)[1].trim()) : null,
      styles: genres.filter((g) => !GENERIC.has(g)),
      title: one(xml, 'title'),
      wistia: wistiaM ? wistiaM[1].trim() : null,
    });
  }
}

const plan = buildNormalizationPlan(records);

// ---- machine-readable ----
writeFileSync(`${reportOut}.json`, JSON.stringify(plan, null, 1));

// ---- human-readable manifest ----
const L = [];
L.push(`# Normalization dry run — ${plan.episodes.length} episodes\n`);
L.push('## Season summary');
for (const s of plan.seasons) {
  L.push(`- S${String(s.newSeason).padStart(2, '0')} ${s.seasonName} [${s.lane}] — ${s.count} eps`);
  for (const g of s.groups) if (g.name !== '—') L.push(`    · ${g.name} (${g.count})`);
}
L.push(`\n## Song-merge list (${plan.songMerge.length} songs) — REVIEW THESE`);
for (const r of plan.songMerge) {
  L.push(`- ${r.song}  [${r.treatments.sort().join(', ')}]  ×${r.count}`);
  if (r.courses.length > 1) L.push(`    variants: ${r.courses.join(' | ')}`);
}
L.push('\n## File moves');
for (const e of plan.episodes.sort((a, b) => (a.newSeason - b.newSeason) || (a.newEpisode - b.newEpisode))) {
  L.push(`  ${e.file}  →  ${e.newDir}/${e.newBasename}.{mp4,nfo}`);
}
writeFileSync(reportOut, L.join('\n'));

// ---- console guardrails ----
console.log(`episodes: ${plan.episodes.length} (expect 2434)`);
console.log(`seasons:  ${plan.seasons.map((s) => `${s.newSeason}:${s.count}`).join('  ')}`);
console.log(`songs:    ${plan.songMerge.length}`);
const skill = plan.episodes.filter((e) => e.skillChallenge).length;
console.log(`skillChallenge eps: ${skill}`);
const noCourse = plan.episodes.filter((e) => !e.course).length;
if (noCourse) console.warn(`WARN: ${noCourse} episodes have no Course tag`);
console.log(`wrote ${reportOut} and ${reportOut}.json`);
```

- [ ] **Step 2: Run the dry run against the real NAS**

Run:
```bash
node cli/curriculum/normalize.mjs "/media/kckern/Media/Lectures/Piano With Jonny" \
  "/tmp/claude-1001/-opt-Code-DaylightStation--claude-worktrees-meet-requirements/5530fc0c-2ba9-4d04-8b35-d9ed2cec2784/scratchpad/normalize-dryrun.md"
```
Expected console: `episodes: 2434 (expect 2434)`, nine `seasons:` entries `0:… 1:… … 8:…` summing to 2434, `songs:` roughly 130–140, no `WARN` about missing Course tags. (If episodes ≠ 2434 or a WARN appears, STOP — the parser or a season dir is off; fix before proceeding.)

- [ ] **Step 3: Sanity-check the manifest by eye**

Run: `sed -n '1,60p' "<scratchpad>/normalize-dryrun.md"`
Confirm: season counts match the spec histogram (S00≈155, S01≈133, S02≈155, S03≈220, S04≈74, S05≈40, S06≈81, S07≈61, S08≈1515); the song-merge list shows *Fly Me to the Moon* as ONE row with `[accompaniment, challenge, tutorial]`; no obvious mis-merge (e.g. an "Ear Training…" course collapsed into a standard).

- [ ] **Step 4: Commit the CLI (not the report)**

```bash
git add cli/curriculum/normalize.mjs
git commit -m "feat(piano-reorg): normalize.mjs dry-run manifest CLI"
```

- [ ] **Step 5: Produce the review artifact for the human gate**

The dry-run report at `<scratchpad>/normalize-dryrun.md` is the deliverable. Surface its Season summary + Song-merge list to the human. **Plan 2 (apply) does not start until a human confirms the song-merge list and season counts.**

---

## Self-Review

**Spec coverage:** classification rules → Tasks 2–3; base/part → Task 1; title cleanup → Task 4; renumber + summaries + song-merge → Task 5; dry-run manifest + no-media-writes + review gate → Task 6. The Silent-Night landmine is asserted in Task 3. Count-conservation guardrail is in Task 6 Step 2. Apply/migrate/backend/frontend are explicitly out of this plan (Plans 2–4).

**Placeholder scan:** none — every step carries real code or a real command.

**Type consistency:** `baseCourseAndPart→{base,part}`, `classify→{lane,newSeason,seasonName,group,treatment}`, `songFields→{song,songKey,skillChallenge}`, `cleanTitle→string`, `buildNormalizationPlan→{episodes,seasons,songMerge}` — consistent across Tasks 1–6 and the CLI.

**Known best-effort:** `songFields` style/skill heuristics will have edges; Task 6 Step 3 + Step 5 make the song-merge list a human review gate that corrects them before any write. If review finds systematic misses, refine `SKILL_CHALLENGE`/`STYLE_SUFFIX` and re-run the dry run (no media touched).
