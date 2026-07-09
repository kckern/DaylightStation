# Piano Curriculum Metadata Pipeline — Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Piano-With-Jonny's authored curriculum metadata (real titles, `course` grouping, `style`, `skill`, `instructor`, and the season `piano.category` block) natively through the Plex adapter, sourced from an NFO-derived index the app can actually read.

**Architecture:** Path C. A host generator parses the on-disk NFOs into a compact per-show index JSON committed to the repo (bundled into the image — the app container can't read the bulk media, and Plex won't ingest the NFOs). The `PlexAdapter` loads the index (cached) and **merges it onto items by `(season, episode)`** — reliable because Plex's episode `index` is intact even though its titles/genre are broken. Merged data (corrected `title` + a namespaced `piano` object) flows out through `list`/`info`/`playable`.

**Tech Stack:** Node ESM, Vitest. Adapter at `backend/src/1_adapters/content/media/plex/`. Index committed under that dir. Commands from repo root `/opt/Code/DaylightStation`.

## Global Constraints

- **Path C, no Plex writes for episode data, no bulk-media mount.** The index is the source of truth for per-episode fields; Plex provides tree/ratingKeys/streaming only.
- **Join key `(season, episode)`** = Plex episode `item.parentIndex` : `item.index`; season = `item.index`. Show resolved via episode `grandparentRatingKey` / season `parentRatingKey`.
- **Namespace everything authored under `piano`** — never write top-level keys that collide with native Plex fields (`category`, `genre`, `label`, `title` are native). The merge overrides `title` (to fix date titles) and adds `metadata.piano`.
- **Index path:** `backend/src/1_adapters/content/media/plex/curriculum/<showRatingKey>.json` (committed; bundled in image). Generic per-show — the adapter only merges when a file exists for the item's show.
- **Categories (authored per season):** 0=reference(pinned); 1–9=lesson(sequential); 10=repertoire/tutorial, 11=repertoire/challenge, 12=repertoire/accompaniment; repertoire `facets:[difficulty,instructor,style]`.
- **`course` grouping** comes from the NFO `Course:` tag (contiguous runs), NOT the episode number.
- **style** = the NFO `<genre>` that is not `Music`/`Educational` (17 values incl. Jazz Ballads, Pop, Gospel, Ragtime, Blues…).
- No frontend changes here (that is Plan 2 — the three-lane UX). No deploy (held).
- Test: `npx vitest run <path>` from repo root.

---

### Task 1: NFO → index (pure parser + generator CLI)

**Files:**
- Create: `cli/curriculum/nfoIndex.mjs` (pure: parse + build)
- Create: `cli/curriculum/build-index.mjs` (CLI wrapper: read a season-dir tree, write `<out>.json`)
- Test: `cli/curriculum/nfoIndex.test.mjs`
- Delete: `cli/curriculum/build-index.py` (superseded by the node version)

**Interfaces:**
- Produces:
  - `parseEpisodeNfo(xml) -> { season, episode, title, plot, course, style, skill, focus, type, instructor }` (missing fields omitted; `style` excludes `Music`/`Educational`; `focus` is an array).
  - `parseSeasonNfo(xml) -> { season, title }`
  - `buildIndex({ show, seasonMeta, episodes }) -> { show, seasons, episodes }` where `episodes` is keyed `"<season>:<episode>"` and `seasons` merges counts + the authored `seasonMeta`.

- [ ] **Step 1: Write the failing test**

```js
// cli/curriculum/nfoIndex.test.mjs
import { describe, it, expect } from 'vitest';
import { parseEpisodeNfo, parseSeasonNfo, buildIndex } from './nfoIndex.mjs';

const EP = `<?xml version="1.0"?><episodedetails>
  <title>Ain’t Misbehavin’ – 1 – Intro</title><season>10</season><episode>1</episode>
  <plot>Intro. From "Ain’t Misbehavin’ – 1" by Piano With Jonny.</plot>
  <genre>Music</genre><genre>Educational</genre><genre>Jazz Ballads</genre>
  <tag>Course: Ain’t Misbehavin’ – 1</tag><tag>Skill Level: Beginner</tag>
  <tag>Focus: Songs</tag><tag>Type: Course</tag><credits>John Proulx</credits>
</episodedetails>`;

describe('parseEpisodeNfo', () => {
  it('extracts fields and picks the non-generic genre as style', () => {
    expect(parseEpisodeNfo(EP)).toEqual({
      season: 10, episode: 1,
      title: 'Ain’t Misbehavin’ – 1 – Intro',
      plot: 'Intro. From "Ain’t Misbehavin’ – 1" by Piano With Jonny.',
      course: 'Ain’t Misbehavin’ – 1', style: 'Jazz Ballads',
      skill: 'Beginner', focus: ['Songs'], type: 'Course', instructor: 'John Proulx',
    });
  });
});

describe('parseSeasonNfo', () => {
  it('reads season number + title', () => {
    expect(parseSeasonNfo('<season><seasonnumber>11</seasonnumber><title>Song - Challenges</title></season>'))
      .toEqual({ season: 11, title: 'Song - Challenges' });
  });
});

describe('buildIndex', () => {
  it('keys episodes by season:episode and merges season meta + counts', () => {
    const idx = buildIndex({
      show: 676490,
      seasonMeta: { 10: { category: 'repertoire', kind: 'tutorial', facets: ['difficulty','instructor','style'] } },
      episodes: [parseEpisodeNfo(EP)],
    });
    expect(idx.show).toBe(676490);
    expect(idx.episodes['10:1'].course).toBe('Ain’t Misbehavin’ – 1');
    expect(idx.seasons['10']).toMatchObject({ category: 'repertoire', kind: 'tutorial', episodes: 1 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run cli/curriculum/nfoIndex.test.mjs`
Expected: FAIL — cannot resolve `./nfoIndex.mjs`.

- [ ] **Step 3: Implement `cli/curriculum/nfoIndex.mjs`**

```js
// cli/curriculum/nfoIndex.mjs — pure NFO parsing + index building (no I/O).
const GENERIC = new Set(['Music', 'Educational']);

const unesc = (s) => (s == null ? s : s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"'));

const one = (xml, el) => {
  const m = xml.match(new RegExp(`<${el}>([\\s\\S]*?)</${el}>`));
  return m ? unesc(m[1].trim()) : null;
};
const tagValues = (xml, key) => {
  const re = new RegExp(`<tag>${key}:\\s*([^<]+)</tag>`, 'g');
  const out = []; let m;
  while ((m = re.exec(xml))) out.push(unesc(m[1].trim()));
  return out;
};

export function parseEpisodeNfo(xml) {
  const season = one(xml, 'season'); const episode = one(xml, 'episode');
  if (season == null || episode == null) return null;
  const genres = [...xml.matchAll(/<genre>([^<]+)<\/genre>/g)].map((m) => m[1].trim());
  const style = genres.find((g) => !GENERIC.has(g)) || null;
  const ep = {
    season: Number(season), episode: Number(episode),
    title: one(xml, 'title'), plot: one(xml, 'plot'),
    course: tagValues(xml, 'Course')[0] || null,
    style: unesc(style),
    skill: tagValues(xml, 'Skill Level')[0] || null,
    focus: tagValues(xml, 'Focus'),
    type: tagValues(xml, 'Type')[0] || null,
    instructor: one(xml, 'credits'),
  };
  // Drop empty/nullish fields (keep season/episode).
  for (const k of Object.keys(ep)) {
    if (k === 'season' || k === 'episode') continue;
    const v = ep[k];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) delete ep[k];
  }
  return ep;
}

export function parseSeasonNfo(xml) {
  const n = one(xml, 'seasonnumber');
  return { season: n == null ? null : Number(n), title: one(xml, 'title') };
}

export function buildIndex({ show, seasonMeta = {}, episodes = [] }) {
  const eps = {}; const counts = {};
  for (const ep of episodes) {
    if (!ep) continue;
    eps[`${ep.season}:${ep.episode}`] = ep;
    counts[ep.season] = (counts[ep.season] || 0) + 1;
  }
  const seasons = {};
  for (const [sn, meta] of Object.entries(seasonMeta)) {
    seasons[sn] = { ...meta, episodes: counts[sn] || 0 };
  }
  return { show, seasons, episodes: eps };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run cli/curriculum/nfoIndex.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the CLI wrapper + remove the python generator**

Create `cli/curriculum/build-index.mjs`:

```js
#!/usr/bin/env node
// Usage: node cli/curriculum/build-index.mjs <nfo-root-dir> <show-id> <out.json>
// Reads Season */*.nfo under <nfo-root-dir>, writes the merged index JSON.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { parseEpisodeNfo, parseSeasonNfo, buildIndex } from './nfoIndex.mjs';

// Authored season → category map (see spec). Adjust here if categories change.
const SEASON_META = {
  0: { title: 'Reference', category: 'reference', pinned: true },
  1: { category: 'lesson', sequential: true }, 2: { category: 'lesson', sequential: true },
  3: { category: 'lesson', sequential: true }, 4: { category: 'lesson', sequential: true },
  5: { category: 'lesson', sequential: true }, 6: { category: 'lesson', sequential: true },
  7: { category: 'lesson', sequential: true }, 8: { category: 'lesson', sequential: true },
  9: { category: 'lesson', sequential: true },
  10: { category: 'repertoire', kind: 'tutorial', facets: ['difficulty', 'instructor', 'style'] },
  11: { category: 'repertoire', kind: 'challenge', facets: ['difficulty', 'instructor', 'style'] },
  12: { category: 'repertoire', kind: 'accompaniment', facets: ['difficulty', 'instructor', 'style'] },
};

const [root, showId, out] = process.argv.slice(2);
if (!root || !showId || !out) { console.error('Usage: build-index.mjs <nfo-root> <show-id> <out.json>'); process.exit(1); }

const episodes = [];
const seasonTitles = {};
for (const dir of readdirSync(root)) {
  const p = join(root, dir);
  if (!statSync(p).isDirectory() || !/^Season /.test(dir)) continue;
  for (const f of readdirSync(p)) {
    if (!f.endsWith('.nfo')) continue;
    const xml = readFileSync(join(p, f), 'utf8');
    if (f === 'season.nfo') { const s = parseSeasonNfo(xml); if (s.season != null) seasonTitles[s.season] = s.title; continue; }
    const ep = parseEpisodeNfo(xml); if (ep) episodes.push(ep);
  }
}
// Merge scanned season titles into the authored meta.
const seasonMeta = {};
for (const [sn, meta] of Object.entries(SEASON_META)) seasonMeta[sn] = { title: seasonTitles[sn] ?? meta.title, ...meta };

const idx = buildIndex({ show: Number(showId), seasonMeta, episodes });
writeFileSync(out, JSON.stringify(idx, null, 1));
console.log(`wrote ${out}: ${Object.keys(idx.seasons).length} seasons, ${Object.keys(idx.episodes).length} episodes`);
```

Then remove the python prototype:

```bash
git rm cli/curriculum/build-index.py
```

- [ ] **Step 6: Commit**

```bash
git add cli/curriculum/nfoIndex.mjs cli/curriculum/nfoIndex.test.mjs cli/curriculum/build-index.mjs
git commit -m "feat(curriculum): NFO→index parser + generator CLI (node)"
```

---

### Task 2: Generate + commit the 676490 index

**Files:**
- Create: `backend/src/1_adapters/content/media/plex/curriculum/676490.json` (generated data artifact)

- [ ] **Step 1: Generate the index from the on-disk NFOs**

Run (host can read the media):
```bash
mkdir -p backend/src/1_adapters/content/media/plex/curriculum
node cli/curriculum/build-index.mjs "/media/kckern/Media/Lectures/Piano With Jonny" 676490 backend/src/1_adapters/content/media/plex/curriculum/676490.json
```
Expected: `wrote …/676490.json: 13 seasons, 2434 episodes`

- [ ] **Step 2: Sanity-check the artifact**

```bash
node -e "const d=require('./backend/src/1_adapters/content/media/plex/curriculum/676490.json'); console.log('seasons',Object.keys(d.seasons).length,'eps',Object.keys(d.episodes).length); console.log(d.episodes['10:1']); console.log(d.seasons['10']);"
```
Expected: 13 seasons / 2434 eps; `10:1` has `course`/`styles: ['Jazz Ballads']`/`skill`/`instructor`; season `10` has `category: 'repertoire'`, `kind: 'tutorial'`.

- [ ] **Step 3: Commit the artifact**

```bash
git add backend/src/1_adapters/content/media/plex/curriculum/676490.json
git commit -m "data(curriculum): generated Piano With Jonny (676490) metadata index"
```

---

### Task 3: `CurriculumIndex` loader + merge (pure-ish, cached)

**Files:**
- Create: `backend/src/1_adapters/content/media/plex/CurriculumIndex.mjs`
- Test: `tests/isolated/adapters/plex/CurriculumIndex.test.mjs`

**Interfaces:**
- Produces:
  - `getCurriculumIndex(showRatingKey) -> index | null` — loads `curriculum/<showRatingKey>.json` relative to this module, caches by key; returns null if none.
  - `mergeEpisode(index, { season, episode }) -> { title?, piano? } | null` — looks up `index.episodes["season:episode"]`; returns `{ title, piano: { course, styles, skill, instructor, focus, type } }`.
  - `mergeSeason(index, season) -> { title?, piano? } | null` — looks up `index.seasons[String(season)]`; returns `{ title, piano: { category, kind, facets, sequential, pinned } }`.
- `_resetCacheForTests()`.

- [ ] **Step 1: Write the failing test**

```js
// tests/isolated/adapters/plex/CurriculumIndex.test.mjs
import { describe, it, expect } from 'vitest';
import { mergeEpisode, mergeSeason } from '#adapters/content/media/plex/CurriculumIndex.mjs';

const index = {
  show: 676490,
  seasons: { '10': { title: 'Song Tutorials', category: 'repertoire', kind: 'tutorial', facets: ['difficulty','instructor','style'], episodes: 1052 },
             '1': { title: 'Pop Soloing', category: 'lesson', sequential: true } },
  episodes: { '10:1': { title: 'Ain’t Misbehavin’ – 1 – Intro', course: 'Ain’t Misbehavin’ – 1', styles: ['Jazz Ballads'], skill: 'Beginner', instructor: 'John Proulx', focus: ['Songs'], type: 'Course' } },
};

describe('mergeEpisode', () => {
  it('returns corrected title + piano fields for a known episode', () => {
    const r = mergeEpisode(index, { season: 10, episode: 1 });
    expect(r.title).toBe('Ain’t Misbehavin’ – 1 – Intro');
    expect(r.piano).toMatchObject({ course: 'Ain’t Misbehavin’ – 1', styles: ['Jazz Ballads'], skill: 'Beginner', instructor: 'John Proulx' });
  });
  it('returns null for an unknown episode', () => {
    expect(mergeEpisode(index, { season: 99, episode: 9 })).toBeNull();
  });
});

describe('mergeSeason', () => {
  it('returns the category block', () => {
    expect(mergeSeason(index, 10).piano).toMatchObject({ category: 'repertoire', kind: 'tutorial', facets: ['difficulty','instructor','style'] });
    expect(mergeSeason(index, 1).piano).toMatchObject({ category: 'lesson', sequential: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/isolated/adapters/plex/CurriculumIndex.test.mjs`
Expected: FAIL — cannot resolve the module.

> Confirm the `#adapters` import alias exists (check `package.json` `imports`); if the alias differs (e.g. `#adapters/*` → `backend/src/1_adapters/*`), use the actual one. If none maps there, import via a relative path from the test.

- [ ] **Step 3: Implement `CurriculumIndex.mjs`**

```js
// CurriculumIndex.mjs — loads a per-show curriculum index and merges it onto items.
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'curriculum');
const cache = new Map(); // showRatingKey -> index | null

export function getCurriculumIndex(showRatingKey) {
  const key = String(showRatingKey);
  if (cache.has(key)) return cache.get(key);
  const path = join(DIR, `${key}.json`);
  let index = null;
  try { if (existsSync(path)) index = JSON.parse(readFileSync(path, 'utf8')); } catch { index = null; }
  cache.set(key, index);
  return index;
}

const EP_PIANO = ['course', 'styles', 'skill', 'instructor', 'focus', 'type'];
const SEASON_PIANO = ['category', 'kind', 'facets', 'sequential', 'pinned'];
const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj[k] != null) out[k] = obj[k];
  return out;
};

export function mergeEpisode(index, { season, episode }) {
  const e = index?.episodes?.[`${season}:${episode}`];
  if (!e) return null;
  return { title: e.title ?? undefined, piano: pick(e, EP_PIANO) };
}

export function mergeSeason(index, season) {
  const s = index?.seasons?.[String(season)];
  if (!s) return null;
  return { title: s.title ?? undefined, piano: pick(s, SEASON_PIANO) };
}

export function _resetCacheForTests() { cache.clear(); }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/adapters/plex/CurriculumIndex.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/CurriculumIndex.mjs tests/isolated/adapters/plex/CurriculumIndex.test.mjs
git commit -m "feat(plex): CurriculumIndex loader + episode/season merge"
```

---

### Task 4: Wire the merge into `PlexAdapter`

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`
- Test: `tests/isolated/adapters/plex/PlexAdapter.curriculum.test.mjs`

**Interfaces:**
- Consumes: `getCurriculumIndex`, `mergeEpisode`, `mergeSeason` (Task 3).
- Produces: `_toListableItem`/`_toPlayableItem` return items whose `title` is corrected and whose `metadata.piano` carries the merged block, for items in an indexed show.

- [ ] **Step 1: Write the failing test**

```js
// tests/isolated/adapters/plex/PlexAdapter.curriculum.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';
import { _resetCacheForTests } from '#adapters/content/media/plex/CurriculumIndex.mjs';

// A real index file for 676490 must exist (Task 2). Use a season+episode known present.
function adapter() { return new PlexAdapter({ host: 'http://x', token: 't' }, { httpClient: { get: async () => ({}) } }); }

describe('PlexAdapter curriculum merge', () => {
  beforeEach(() => _resetCacheForTests());

  it('episode in an indexed show gets corrected title + metadata.piano', () => {
    const a = adapter();
    const item = a._toPlayableItem({ type: 'episode', ratingKey: '1', title: '2026-07-09',
      grandparentRatingKey: '676490', parentIndex: 10, index: 1, Media: [] });
    expect(item.title).toBe('Ain’t Misbehavin’ – 1 – Intro');
    expect(item.metadata.piano.course).toBe('Ain’t Misbehavin’ – 1');
    expect(item.metadata.piano.styles).toContain('Jazz Ballads');
  });

  it('season in an indexed show gets the category block', () => {
    const a = adapter();
    const item = a._toPlayableItem({ type: 'season', ratingKey: '677395', title: 'Song Tutorials',
      parentRatingKey: '676490', index: 10 });
    expect(item.metadata.piano.category).toBe('repertoire');
    expect(item.metadata.piano.kind).toBe('tutorial');
  });

  it('item in a non-indexed show is untouched (no piano)', () => {
    const a = adapter();
    const item = a._toPlayableItem({ type: 'episode', ratingKey: '9', title: 'Ep', grandparentRatingKey: '999999', parentIndex: 1, index: 1, Media: [] });
    expect(item.metadata.piano).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/isolated/adapters/plex/PlexAdapter.curriculum.test.mjs`
Expected: FAIL — no merge yet (`piano` undefined; title unchanged).

- [ ] **Step 3: Implement the merge**

3a. Add the import near the top of `PlexAdapter.mjs` (after the PlexClient import):

```js
import { getCurriculumIndex, mergeEpisode, mergeSeason } from './CurriculumIndex.mjs';
```

3b. Add a private helper method on the class (place it just above `_toListableItem`):

```js
  /**
   * Resolve the curriculum-index merge for a raw Plex item, if its show is indexed.
   * Returns { title?, piano } or null. Episodes join on (parentIndex,index); seasons
   * on (index); resolved to a show via grandparentRatingKey / parentRatingKey.
   * @private
   */
  #curriculumMerge(item) {
    const showKey = item.type === 'episode' ? item.grandparentRatingKey
      : item.type === 'season' ? item.parentRatingKey : null;
    if (!showKey) return null;
    const index = getCurriculumIndex(showKey);
    if (!index) return null;
    if (item.type === 'episode') return mergeEpisode(index, { season: item.parentIndex, episode: item.index });
    if (item.type === 'season') return mergeSeason(index, item.index);
    return null;
  }
```

3c. In `_toListableItem`, apply the merge before `return new ListableItem(...)`. Replace the final `return new ListableItem({ … })` with:

```js
    const merged = this.#curriculumMerge(item);
    if (merged?.piano) metadata.piano = merged.piano;
    return new ListableItem({
      id: `plex:${id}`,
      source: 'plex',
      localId: String(id),
      title: merged?.title || item.title || item.titleSort || `[${item.type || 'Untitled'}]`,
      itemType: isContainer ? 'container' : 'leaf',
      childCount: item.leafCount || item.childCount || 0,
      thumbnail,
      metadata
    });
```

3d. In `_toPlayableItem`, apply it in BOTH return paths:

- Container path — before `return new ListableItem({ … })`, add:
```js
      const mergedC = this.#curriculumMerge(item);
      if (mergedC?.piano) containerMetadata.piano = mergedC.piano;
```
and change that ListableItem's `title:` to `merged`-aware:
```js
        title: mergedC?.title || item.title || item.titleSort || `[${item.type || 'Untitled'}]`,
```

- Episode/track path — after the `const metadata = { … }` block is built (and before the PlayableItem is constructed), add:
```js
    const mergedE = this.#curriculumMerge(item);
    if (mergedE?.piano) metadata.piano = mergedE.piano;
```
and ensure the PlayableItem's `title` uses `mergedE?.title || item.title || …` (locate the `title:` field in the PlayableItem constructor at the end of `_toPlayableItem` and update it the same way).

> Read the remainder of `_toPlayableItem` (the episode `PlayableItem` construction) to place 3d's episode-path edits exactly; the `title:` field there must become `mergedE?.title || item.title || item.titleSort || '[episode]'`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/adapters/plex/PlexAdapter.curriculum.test.mjs`
Expected: PASS (3 tests). (Relies on the committed `676490.json` from Task 2.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/PlexAdapter.mjs tests/isolated/adapters/plex/PlexAdapter.curriculum.test.mjs
git commit -m "feat(plex): merge curriculum index onto seasons/episodes (title + metadata.piano)"
```

---

### Task 5: Surface `piano` (and corrected title) through the list router

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs` (the `toListItem` flatten — include `piano`)
- Test: `tests/unit/suite/api/list-toListItem.test.mjs` (extend) — or `tests/isolated/api/listPiano.test.mjs` if the suite file isn't the right home

**Interfaces:**
- Consumes: items whose `metadata.piano` is set by the adapter.
- Produces: `toListItem` output carries top-level `piano` (so `/list`, `/playable` consumers read `item.piano` natively), and the corrected `title` already flows via the item's `title`.

- [ ] **Step 1: Write the failing test**

```js
// tests/isolated/api/listPiano.test.mjs
import { describe, it, expect } from 'vitest';
import { toListItem } from '#api/v1/routers/list.mjs';

describe('toListItem piano passthrough', () => {
  it('surfaces metadata.piano to the top level', () => {
    const out = toListItem({
      id: 'plex:1', source: 'plex', title: 'X', itemType: 'leaf',
      metadata: { type: 'episode', itemIndex: 1, piano: { course: 'C', styles: ['Jazz Ballads'], category: undefined } },
    });
    expect(out.piano).toEqual({ course: 'C', style: 'Jazz Ballads' });
  });
  it('omits piano when absent', () => {
    const out = toListItem({ id: 'plex:2', source: 'plex', title: 'Y', itemType: 'leaf', metadata: { type: 'episode' } });
    expect(out.piano).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/isolated/api/listPiano.test.mjs`
Expected: FAIL — `piano` not surfaced.

- [ ] **Step 3: Implement**

Read `toListItem` in `list.mjs` (the exported function around line 64-250 that flattens `metadata`). In the metadata-flattening region, add a passthrough for `piano` alongside the other flattened fields:

```js
    if (metadata.piano !== undefined) base.piano = metadata.piano;
```

Place it where other `if (x !== undefined) base.x = x;` flattenings occur (near the `type`/`itemIndex` flattening). If `compactItem` strips unknown keys, confirm `piano` survives (it operates on the flattened `base`; adding `base.piano` before compaction is sufficient — verify `compactItem` doesn't whitelist).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/api/listPiano.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/list.mjs tests/isolated/api/listPiano.test.mjs
git commit -m "feat(api): surface metadata.piano through the list router"
```

---

### Task 6: Verify end-to-end (no deploy)

- [ ] **Step 1: Run the adapter + api curriculum suites**

Run: `npx vitest run tests/isolated/adapters/plex/ tests/isolated/api/listPiano.test.mjs cli/curriculum/nfoIndex.test.mjs`
Expected: all PASS.

- [ ] **Step 2: Backend import sanity**

Run: `node --check backend/src/1_adapters/content/media/plex/PlexAdapter.mjs && node --check backend/src/1_adapters/content/media/plex/CurriculumIndex.mjs && echo ok`
Expected: `ok`.

- [ ] **Step 3: (post-deploy, held) live check note**

After a future deploy: `curl …/api/v1/piano/courses/676490/playable?userId=kckern` — episodes should now show real `title`s (not "Episode N") and `piano: { course, style, skill, instructor }`; seasons carry `piano.category`. This is the input Plan 2's UX consumes. Deploy is HELD for KC's word.

---

## Post-implementation
- **Plan 2 (three-lane UX):** consumes `item.piano` — `partitionCourses` groups by `piano.course`; program home routes Lessons/Reference/Repertoire on `season.piano.category`; Repertoire faceted browser on `piano.style`/`skill`/`instructor`. Authored after this lands.
- **Re-generating the index** when content changes: re-run `cli/curriculum/build-index.mjs` and commit the JSON (it's bundled into the image; a deploy publishes it).

## Self-Review

**Spec coverage:** NFO→index (spec "Approach/data model") → Tasks 1–2; adapter merge surfacing `piano` + corrected title natively (spec "Adapter") → Tasks 3–5; join on `(season,episode)` → Task 3/4; categories/facets/course authored in index → Task 1 (`SEASON_META`) + generated data; enrichment (real titles fixing Plex date-titles) → Task 4. Season-name enrichment already done (pre-plan). Three-lane UX → deferred to Plan 2 (noted). No Plex writes / no mount → honored (index committed to repo).

**Placeholder scan:** no TBD/TODO; complete code in every code step. Two explicit "read to place exactly" notes (Task 4 3d episode `title`; Task 5 flatten site) are bounded, with the exact edit specified — not open-ended.

**Type consistency:** `parseEpisodeNfo`→`{season,episode,title,plot,course,style,skill,focus,type,instructor}`; `buildIndex` keys `"season:episode"`; `getCurriculumIndex`/`mergeEpisode({season,episode})`/`mergeSeason(season)` return `{title?,piano}`; adapter `#curriculumMerge` feeds those from `parentIndex`/`index`/`grandparentRatingKey`/`parentRatingKey`; router surfaces `metadata.piano`→`piano`. Consistent across tasks.
```
