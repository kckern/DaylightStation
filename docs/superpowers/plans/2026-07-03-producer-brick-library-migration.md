# Producer Brick-Library Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-point the Piano Producer's loop library off the deleted `media/midi/loops/index.yml` and onto the new self-indexing MusicXML "brick" tree (3,231 files in C, no baked tempo), served through a cached backend manifest endpoint.

**Architecture:** A backend endpoint walks the five brick folders, parses each MusicXML file's `<miscellaneous>` metadata + `<part>` notes, bakes a per-beat harmonic timeline (reusing the existing `harmonicTimeline` → `consonance`/`melodyFit` engine, with `rootOverride: 0` because every brick is in C), and returns a cached JSON manifest. `useLoopLibrary` fetches that manifest instead of a YAML index; individual bricks are parsed lazily on audition via a shared, dependency-free MusicXML parser. The compatibility engine and `libraryRanking` are already grid-based — they only need the `timeline` field present on each entry, so no matcher is ported. The browse UI's facet vocabulary changes from `mood`/`sources` to `genre`/`emotion`/`tags`/`quality`.

**Tech Stack:** Node/Express backend, React frontend (Vite), `vitest` for all tests, existing `shared/music/` theory core (`harmonicTimeline.mjs`, `consonance.mjs`, `melodyFit.mjs`, `layerMatch.mjs`).

## Global Constraints

- **Bricks are canonical-C, tempo-free.** Never read a per-key variant; never treat `bpm` as a constraint (display hint only). The transpose control (`draft.meta.keyShift`) and the tempo slider (`draft.meta.bpm`) own key and tempo at scheduling time.
- **Do not parse filenames at runtime.** The MusicXML `<miscellaneous>` block is the metadata source of truth; the filename (Roman/note-name + Braille) is a label only.
- **The browser must not fetch all 3,231 files nor parse MusicXML for the index.** The index comes from the backend manifest (one fetch). Parsing a *single* brick on audition (the lazy-notes path) is expected and fine.
- **Note shape is fixed** across the whole pipeline: `{ ticks, durationTicks, midi }` plus a sibling `ppq`. This is what `harmonicTimeline`, `loopScheduler.loopToEvents`, and the existing `useLoopLibrary.loadNotes` consumers expect. Do not change it.
- **Timeline entry keys are FLAT** on each manifest entry: `timeline` (the `slots` array), `timelineRoot`, `specificity` — matching `libraryRanking.timelineOf()` (`frontend/src/modules/Piano/PianoKiosk/producer/libraryRanking.js:38-41`). Do not nest them.
- **Test command** for every task: `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`. Read the summary line `ℹ pass N` / `ℹ fail N` for the real result (a `0`-exit from a pipe is not proof — grep the pass/fail line).
- Commit after every task. Never commit automatically beyond the task boundary; never deploy as part of this plan.

---

## File Structure

**New files:**
- `shared/music/musicXmlToNotes.mjs` — pure, DOM-free MusicXML → `{ppq, timeSig, notes}` parser + `readBrickMeta` metadata reader. Shared by backend builder and frontend lazy loader.
- `shared/music/musicXmlToNotes.test.mjs` — parser unit tests.
- `backend/src/3_applications/piano/loopManifest.mjs` — walks the brick tree, builds enriched manifest entries, mtime-caches.
- `backend/src/3_applications/piano/loopManifest.test.mjs` — builder + cache unit tests.

**Modified files:**
- `backend/src/4_api/v1/routers/piano.mjs` — add `GET /loop-manifest`.
- `frontend/src/modules/Piano/PianoKiosk/useLoopLibrary.js` — fetch manifest; parse MusicXML in `loadNotes`.
- `shared/music/loopQuery.mjs` — facets/filter over `genre`/`emotion`/`tags`/`quality`.
- `shared/music/layerMatch.mjs` — add `groove` role; rank on `genre`/`emotion` overlap.
- `frontend/src/modules/Piano/PianoKiosk/producer/LibraryBrowser.jsx` — facet chips + predicate over the new fields; default `quality=best`.
- `media/midi/prefabs/stacks/*.yml`, `media/midi/prefabs/songs/*.yml` (in the data volume) — re-point refs to real brick paths.

Unchanged (already grid-based — verified): `shared/music/harmonicTimeline.mjs`, `consonance.mjs`, `melodyFit.mjs`, `producer/libraryRanking.js`, `producer/prefabHydrate.js`, `producer/usePrefabs.js`.

---

### Task 1: Shared MusicXML parser (`musicXmlToNotes` + `readBrickMeta`)

**Files:**
- Create: `shared/music/musicXmlToNotes.mjs`
- Test: `shared/music/musicXmlToNotes.test.mjs`

**Interfaces:**
- Produces: `musicXmlToNotes(xml: string) → { ppq: number, timeSig: [number, number], notes: Array<{ticks:number, durationTicks:number, midi:number}> }` and `readBrickMeta(xml: string) → Record<string,string>` (flat map of `<miscellaneous-field>` name→value).
- Consumes: nothing (pure, no imports).

Notes: the brick format is machine-generated and highly regular (score-partwise, one `<part>`, flat `<note>` elements, `<divisions>` in measure 1's `<attributes>`). A targeted element scan is deterministic here — this is intentionally NOT a general MusicXML parser. It must run identically in Node and the browser, so **no DOMParser and no dependencies** — string/regex only. Ties (`<tie type="start"/>`…`stop`) are merged into one sustained note to avoid re-articulation. `<chord/>` notes share the previous non-chord note's start and do not advance the cursor. `<rest>` advances the cursor without emitting a note.

- [ ] **Step 1: Write the failing test**

```javascript
// shared/music/musicXmlToNotes.test.mjs
import { describe, it, expect } from 'vitest';
import { musicXmlToNotes, readBrickMeta } from './musicXmlToNotes.mjs';

const wrap = (measures) => `<?xml version="1.0"?><score-partwise><part id="P1">${measures}</part></score-partwise>`;
const attrs = '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';

describe('musicXmlToNotes', () => {
  it('reads divisions as ppq and time signature', () => {
    const out = musicXmlToNotes(wrap(`<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>`));
    expect(out.ppq).toBe(4);
    expect(out.timeSig).toEqual([4, 4]);
  });

  it('maps C4 to midi 60 and applies alter for sharps', () => {
    const out = musicXmlToNotes(wrap(`<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note><note><pitch><step>C</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration></note></measure>`));
    expect(out.notes[0]).toEqual({ ticks: 0, durationTicks: 4, midi: 60 });
    expect(out.notes[1].midi).toBe(61);
  });

  it('gives chord notes the same start tick and does not advance the cursor', () => {
    const out = musicXmlToNotes(wrap(`<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration></note></measure>`));
    expect(out.notes.map((n) => n.ticks)).toEqual([0, 0, 4]); // C & E stacked at 0, G at 4
  });

  it('advances the cursor past a rest without emitting a note', () => {
    const out = musicXmlToNotes(wrap(`<measure number="1">${attrs}<note><rest/><duration>4</duration></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note></measure>`));
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0].ticks).toBe(4);
  });

  it('merges a tie start→stop into one sustained note', () => {
    const out = musicXmlToNotes(wrap(`<measure number="1">${attrs}<note><pitch><step>E</step><octave>4</octave></pitch><tie type="start"/><duration>2</duration></note><note><rest/><duration>2</duration></note></measure><measure number="2"><note><pitch><step>E</step><octave>4</octave></pitch><tie type="stop"/><duration>1</duration></note></measure>`));
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0].ticks).toBe(0);
    expect(out.notes[0].durationTicks).toBe(17); // 0 → measure2 (start 16) + 1
  });

  it('offsets each measure by one bar length', () => {
    const out = musicXmlToNotes(wrap(`<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration></note></measure><measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note></measure>`));
    expect(out.notes[1].ticks).toBe(16); // bar length = divisions(4) * beats(4)
  });

  it('returns an empty note list for empty/garbage input', () => {
    expect(musicXmlToNotes('').notes).toEqual([]);
    expect(musicXmlToNotes(null).notes).toEqual([]);
  });
});

describe('readBrickMeta', () => {
  it('flattens miscellaneous fields to a name→value map', () => {
    const xml = '<miscellaneous><miscellaneous-field name="type">melody</miscellaneous-field><miscellaneous-field name="tags">lofi,jazz</miscellaneous-field><miscellaneous-field name="artist"></miscellaneous-field></miscellaneous>';
    const meta = readBrickMeta(xml);
    expect(meta.type).toBe('melody');
    expect(meta.tags).toBe('lofi,jazz');
    expect(meta.artist).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs shared/music/musicXmlToNotes.test.mjs`
Expected: FAIL — `Failed to resolve import "./musicXmlToNotes.mjs"` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

```javascript
// shared/music/musicXmlToNotes.mjs
// Pure, DOM-free MusicXML → note-list parser for loop bricks. Runs identically
// in Node (manifest builder) and the browser (lazy audition load). The brick
// format is machine-generated and highly regular, so a targeted element scan is
// deterministic — this is NOT a general MusicXML parser.
//
// Output note shape matches useLoopLibrary.loadNotes / harmonicTimeline /
// loopScheduler: { ppq, timeSig:[beats,beatType], notes:[{ticks,durationTicks,midi}] }.

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Absolute MIDI number from a <pitch> block (C4 → 60). */
function pitchToMidi(step, octave, alter) {
  return (octave + 1) * 12 + LETTER_PC[step] + alter;
}

/** First integer value of <tag>…</tag> in a block, or null. */
function firstInt(block, tag) {
  const m = block.match(new RegExp(`<${tag}>(-?\\d+)</${tag}>`));
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Parse a loop brick's MusicXML into a flat, tempo-free note list in ticks.
 * @param {string} xml raw MusicXML text
 * @returns {{ppq:number, timeSig:[number,number], notes:Array<{ticks:number,durationTicks:number,midi:number}>}}
 */
export function musicXmlToNotes(xml) {
  if (typeof xml !== 'string' || xml.length === 0) {
    return { ppq: 4, timeSig: [4, 4], notes: [] };
  }
  const divisions = firstInt(xml, 'divisions') || 4; // ticks per quarter
  const beats = firstInt(xml, 'beats') || 4;
  const beatType = firstInt(xml, 'beat-type') || 4;
  const barTicks = divisions * (4 / beatType) * beats;

  const notes = [];
  const openTies = new Map(); // midi → index in `notes` of an open tied note

  const measureRe = /<measure\b[^>]*>([\s\S]*?)<\/measure>/g;
  let measureStart = 0;
  let mm;
  while ((mm = measureRe.exec(xml)) !== null) {
    const body = mm[1];
    let cursor = 0;
    let prevStart = 0; // start tick of the last non-chord note (for <chord/>)

    const elemRe = /<(note|backup|forward)\b[^>]*>([\s\S]*?)<\/\1>/g;
    let em;
    while ((em = elemRe.exec(body)) !== null) {
      const tag = em[1];
      const block = em[2];
      const duration = firstInt(block, 'duration') || 0;

      if (tag === 'backup') { cursor -= duration; continue; }
      if (tag === 'forward') { cursor += duration; continue; }

      const isChord = /<chord\s*\/>/.test(block);
      const isRest = /<rest\s*\/?>/.test(block);
      const start = isChord ? prevStart : cursor;

      if (!isRest) {
        const stepM = block.match(/<step>([A-G])<\/step>/);
        const octM = block.match(/<octave>(-?\d+)<\/octave>/);
        if (stepM && octM) {
          const alter = firstInt(block, 'alter') || 0;
          const midi = pitchToMidi(stepM[1], parseInt(octM[1], 10), alter);
          const tieStop = /<tie type="stop"\s*\/>/.test(block);
          const tieStart = /<tie type="start"\s*\/>/.test(block);
          if (tieStop && openTies.has(midi)) {
            const idx = openTies.get(midi);
            notes[idx].durationTicks = (measureStart + start + duration) - notes[idx].ticks;
            if (!tieStart) openTies.delete(midi);
          } else {
            notes.push({ ticks: measureStart + start, durationTicks: duration, midi });
            if (tieStart) openTies.set(midi, notes.length - 1);
          }
        }
      }
      if (!isChord) { prevStart = start; cursor += duration; }
    }
    measureStart += barTicks;
  }
  return { ppq: divisions, timeSig: [beats, beatType], notes };
}

/** Flatten a brick's <miscellaneous-field> elements into a name→value map. */
export function readBrickMeta(xml) {
  const meta = {};
  if (typeof xml !== 'string') return meta;
  const re = /<miscellaneous-field name="([^"]+)">([\s\S]*?)<\/miscellaneous-field>/g;
  let m;
  while ((m = re.exec(xml)) !== null) meta[m[1]] = m[2];
  return meta;
}

export default { musicXmlToNotes, readBrickMeta };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs shared/music/musicXmlToNotes.test.mjs`
Expected: PASS — summary line shows `ℹ fail 0` and all `musicXmlToNotes` / `readBrickMeta` specs passing.

- [ ] **Step 5: Commit**

```bash
git add shared/music/musicXmlToNotes.mjs shared/music/musicXmlToNotes.test.mjs
git commit -m "feat(piano): shared DOM-free MusicXML brick parser + meta reader"
```

---

### Task 2: Backend manifest builder (`loopManifest`)

**Files:**
- Create: `backend/src/3_applications/piano/loopManifest.mjs`
- Test: `backend/src/3_applications/piano/loopManifest.test.mjs`

**Interfaces:**
- Consumes: `musicXmlToNotes`, `readBrickMeta` (Task 1); `harmonicTimeline` (`shared/music/harmonicTimeline.mjs`); `listFiles`, `readFile`, `getStats` (`#system/utils/FileIO.mjs`).
- Produces:
  - `buildBrickEntry(relPath: string, xml: string) → entry` — pure. Entry shape: `{ path, slug, type, title, genre:string[], emotion:string[], tags:string[], quality, artist, bpm:number|null, reverb, roman:string[], timeline?:number[][], timelineRoot?:number, specificity?:string, needsReview?:boolean, needsReviewReason?:string }`.
  - `buildManifest(midiDir: string) → entry[]` — walks the five folders.
  - `getManifest(midiDir: string, opts?:{refresh?:boolean}) → entry[]` — mtime-cached wrapper.
  - `manifestSignature(midiDir: string) → string` — folder-mtime cache key.

Notes: `path` is the relative id (`chords/xxx.musicxml`) used by prefab refs and the lazy streamer. Grooves/percussion get no timeline (`libraryRanking` treats them as always-stackable). Harmonic types run `harmonicTimeline(notes, ppq, { rootOverride: 0, timeSig })` — root is forced to 0 because bricks are in C, so slots are already key-conformed for `consonance.stackable`. A parse-empty or engine-throw entry is flagged `needsReview` (excluded from the guardrailed set downstream) but still listed.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/3_applications/piano/loopManifest.test.mjs
import { describe, it, expect } from 'vitest';
import { buildBrickEntry } from './loopManifest.mjs';

const misc = (fields) => `<miscellaneous>${Object.entries(fields).map(([k, v]) => `<miscellaneous-field name="${k}">${v}</miscellaneous-field>`).join('')}</miscellaneous>`;
const attrs = '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const cMajorTriad = `<measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration></note><note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration></note></measure>`;

describe('buildBrickEntry', () => {
  it('splits comma metadata into arrays and coerces bpm', () => {
    const xml = `<x>${misc({ type: 'melody', title: 'Lofi', genre: 'lofi,jazz', emotion: '', tags: 'lofi,jazz', quality: 'best', artist: '', bpm: '160', 'source-slug': 'lofi-1', 'derived-signature': '' })}${cMajorTriad}</x>`;
    const e = buildBrickEntry('melodies/lofi-1.musicxml', xml);
    expect(e.path).toBe('melodies/lofi-1.musicxml');
    expect(e.slug).toBe('lofi-1');
    expect(e.type).toBe('melody');
    expect(e.genre).toEqual(['lofi', 'jazz']);
    expect(e.emotion).toEqual([]);
    expect(e.quality).toBe('best');
    expect(e.bpm).toBe(160);
  });

  it('bakes a root-0 harmonic timeline for harmonic types', () => {
    const xml = `<x>${misc({ type: 'chord-progression', 'source-slug': 'triad', 'derived-signature': 'I' })}${cMajorTriad}</x>`;
    const e = buildBrickEntry('chords/triad.musicxml', xml);
    expect(e.timelineRoot).toBe(0);
    expect(Array.isArray(e.timeline)).toBe(true);
    expect(e.timeline[0]).toEqual([0, 4, 7]); // C major triad, root-relative to C
    expect(e.roman).toEqual(['I']);
    expect(e.needsReview).toBeUndefined();
  });

  it('skips timeline for grooves', () => {
    const xml = `<x>${misc({ type: 'groove', 'source-slug': 'four-on-floor' })}</x>`;
    const e = buildBrickEntry('percussion/four-on-floor.musicxml', xml);
    expect(e.type).toBe('groove');
    expect(e.timeline).toBeUndefined();
    expect(e.needsReview).toBeUndefined();
  });

  it('flags a harmonic brick with no notes as needsReview', () => {
    const xml = `<x>${misc({ type: 'chord-progression', 'source-slug': 'empty' })}<part id="P1"></part></x>`;
    const e = buildBrickEntry('chords/empty.musicxml', xml);
    expect(e.needsReview).toBe(true);
    expect(e.needsReviewReason).toBe('parse-fail');
    expect(e.timeline).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/piano/loopManifest.test.mjs`
Expected: FAIL — `Failed to resolve import "./loopManifest.mjs"`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/piano/loopManifest.mjs
// Walk the five brick folders under media/midi, parse each MusicXML brick's
// metadata + notes, bake a root-0 harmonic timeline (bricks are canonical-C),
// and cache the result by folder mtime. Consumed by the /loop-manifest endpoint
// and, downstream, by useLoopLibrary → libraryRanking (grid-based gate).

import path from 'path';
import { listFiles, readFile, getStats } from '#system/utils/FileIO.mjs';
import { musicXmlToNotes, readBrickMeta } from '../../../../shared/music/musicXmlToNotes.mjs';
import { harmonicTimeline } from '../../../../shared/music/harmonicTimeline.mjs';

const TYPE_FOLDERS = ['chords', 'basslines', 'melodies', 'ideas', 'percussion'];
const SKIP_HARMONY = new Set(['groove', 'percussion']);

const csv = (s) => (typeof s === 'string' && s.trim()
  ? s.split(',').map((x) => x.trim()).filter(Boolean)
  : []);

/** Build one manifest entry from a brick's relative path + raw XML. Pure. */
export function buildBrickEntry(relPath, xml) {
  const meta = readBrickMeta(xml);
  const type = meta.type || 'idea';
  const entry = {
    path: relPath,
    slug: meta['source-slug'] || meta['canonical-name'] || relPath,
    type,
    title: meta.title || '',
    genre: csv(meta.genre),
    emotion: csv(meta.emotion),
    tags: csv(meta.tags),
    quality: meta.quality || '',
    artist: meta.artist || '',
    bpm: meta.bpm ? Number(meta.bpm) : null,
    reverb: meta.reverb || '',
    roman: meta['derived-signature'] ? meta['derived-signature'].split('-').filter(Boolean) : [],
  };
  if (SKIP_HARMONY.has(type)) return entry; // grooves have no harmonic content
  try {
    const { ppq, notes, timeSig } = musicXmlToNotes(xml);
    if (!notes.length) {
      entry.needsReview = true;
      entry.needsReviewReason = 'parse-fail';
      return entry;
    }
    const tl = harmonicTimeline(notes, ppq, { rootOverride: 0, timeSig });
    entry.timeline = tl.slots;
    entry.timelineRoot = tl.root; // always 0 (canonical C)
    entry.specificity = tl.specificity;
  } catch (err) {
    entry.needsReview = true;
    entry.needsReviewReason = `engine-throw: ${err.message}`;
  }
  return entry;
}

/** Walk the five type folders under midiDir → array of manifest entries. */
export function buildManifest(midiDir) {
  const bricks = [];
  for (const folder of TYPE_FOLDERS) {
    const dir = path.join(midiDir, folder);
    for (const file of listFiles(dir)) {
      if (!file.endsWith('.musicxml')) continue;
      const xml = readFile(path.join(dir, file));
      if (xml == null) continue;
      bricks.push(buildBrickEntry(`${folder}/${file}`, xml));
    }
  }
  return bricks;
}

/** Folder-mtime signature — invalidates the cache when bricks are (re)generated. */
export function manifestSignature(midiDir) {
  return TYPE_FOLDERS.map((f) => {
    const st = getStats(path.join(midiDir, f));
    return `${f}:${st ? st.mtimeMs : 0}`;
  }).join('|');
}

let _cache = null; // { sig, bricks }

/** mtime-cached manifest. Pass { refresh: true } to force a rebuild. */
export function getManifest(midiDir, { refresh = false } = {}) {
  const sig = manifestSignature(midiDir);
  if (!refresh && _cache && _cache.sig === sig) return _cache.bricks;
  const bricks = buildManifest(midiDir);
  _cache = { sig, bricks };
  return bricks;
}

export default { buildBrickEntry, buildManifest, getManifest, manifestSignature };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/3_applications/piano/loopManifest.test.mjs`
Expected: PASS — `ℹ fail 0`, all four `buildBrickEntry` specs green (note the `[0,4,7]` timeline assertion confirms the grid engine is wired end-to-end).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/piano/loopManifest.mjs backend/src/3_applications/piano/loopManifest.test.mjs
git commit -m "feat(piano): backend loop-manifest builder over MusicXML bricks"
```

---

### Task 3: `GET /loop-manifest` endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/piano.mjs` (add import near line 1-16; add route inside `createPianoRouter`, after the `/users` route ~line 71)
- Test: `backend/src/4_api/v1/routers/piano.loop-manifest.test.mjs`

**Interfaces:**
- Consumes: `getManifest` (Task 2); `configService.getMediaDir()` (already available in `createPianoRouter`).
- Produces: `GET /api/v1/piano/loop-manifest[?refresh=true]` → `{ bricks: entry[], count: number }`.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/4_api/v1/routers/piano.loop-manifest.test.mjs
import { describe, it, expect } from 'vitest';
import express from 'express';
import { createPianoRouter } from './piano.mjs';

// Minimal configService stub: getMediaDir points at a dir with no brick folders,
// so getManifest returns []. We only assert the route contract + shape here.
function makeApp(mediaDir) {
  const configService = {
    getMediaDir: () => mediaDir,
    getUserProfile: () => null,
    getUserDir: () => '/tmp/none',
    getHouseholdPath: (p) => `/tmp/${p}`,
    hydrateUsers: () => [],
  };
  const app = express();
  app.use('/api/v1/piano', createPianoRouter({ configService }));
  return app;
}

describe('GET /api/v1/piano/loop-manifest', () => {
  it('returns { bricks, count } (empty when no brick folders exist)', async () => {
    const app = makeApp('/tmp/does-not-exist-brick-root');
    const { default: request } = await import('supertest');
    const res = await request(app).get('/api/v1/piano/loop-manifest');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.bricks)).toBe(true);
    expect(res.body.count).toBe(res.body.bricks.length);
  });
});
```

(If `supertest` is not resolvable in this repo, replace the request block with a direct handler call: locate the layer via `createPianoRouter(...).stack.find((l) => l.route?.path === '/loop-manifest')` and invoke `layer.route.stack[0].handle(req, res)` with `req = { query: {} }` and a mock `res` capturing `.json`. Confirm which is available with `ls node_modules/supertest` before writing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/piano.loop-manifest.test.mjs`
Expected: FAIL — 404 (route not registered) or `res.body.bricks` undefined.

- [ ] **Step 3: Write minimal implementation**

Add the import alongside the other `#applications` imports at the top of `backend/src/4_api/v1/routers/piano.mjs`:

```javascript
import { getManifest } from '#applications/piano/loopManifest.mjs';
```

Inside `createPianoRouter({ configService, ... })`, after the `router.get('/users', …)` block, add:

```javascript
  // Loop-library manifest: walk the five MusicXML brick folders, bake per-beat
  // harmonic timelines (root-0, canonical-C), cache by folder mtime. This is the
  // ONE index fetch useLoopLibrary makes; individual bricks stream + parse lazily.
  router.get('/loop-manifest', (req, res) => {
    try {
      const midiDir = path.join(configService.getMediaDir(), 'midi');
      const bricks = getManifest(midiDir, { refresh: req.query.refresh === 'true' });
      res.json({ bricks, count: bricks.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/piano.loop-manifest.test.mjs`
Expected: PASS — `ℹ fail 0`, status 200 with a `bricks` array + matching `count`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/piano.mjs backend/src/4_api/v1/routers/piano.loop-manifest.test.mjs
git commit -m "feat(piano): GET /loop-manifest endpoint (mtime-cached brick walk)"
```

---

### Task 4: Re-point `useLoopLibrary` to the manifest + lazy MusicXML notes

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/useLoopLibrary.js` (full rewrite of the fetch effect + `loadNotes`; keep `query`/`facets`/`rankFor` exports and return shape identical)
- Test: `frontend/src/modules/Piano/PianoKiosk/useLoopLibrary.test.js`

**Interfaces:**
- Consumes: `GET /api/v1/piano/loop-manifest` → `{ bricks }`; `/api/v1/local/stream/midi/<path>` for a raw `.musicxml`; `musicXmlToNotes` (Task 1); `queryLoops`, `facets` (`@shared-music/loopQuery.mjs` — updated in Task 5); `rankLayerCandidates` (`@shared-music/layerMatch.mjs`).
- Produces: unchanged hook surface — `{ loops, loading, error, query, facets, rankFor, loadNotes }`. `loadNotes(entry) → { ppq, notes } | null`.

Note: the brick `path` can contain non-ASCII (Braille) characters, so the stream URL must be `encodeURI`'d.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/Piano/PianoKiosk/useLoopLibrary.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLoopLibrary } from './useLoopLibrary.js';

const attrs = '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const brickXml = `<x><measure number="1">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></x>`;

describe('useLoopLibrary', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      if (url.includes('/loop-manifest')) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ bricks: [{ path: 'chords/a.musicxml', type: 'chord-progression', tags: ['lofi'] }] })), json: () => Promise.resolve({ bricks: [{ path: 'chords/a.musicxml', type: 'chord-progression', tags: ['lofi'] }] }) });
      }
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), text: () => Promise.resolve(brickXml) });
    });
  });

  it('loads the manifest bricks as loops', async () => {
    const { result } = renderHook(() => useLoopLibrary());
    await waitFor(() => expect(result.current.loops).not.toBeNull());
    expect(result.current.loops).toHaveLength(1);
    expect(result.current.loops[0].path).toBe('chords/a.musicxml');
  });

  it('loadNotes fetches the .musicxml and parses it', async () => {
    const { result } = renderHook(() => useLoopLibrary());
    await waitFor(() => expect(result.current.loops).not.toBeNull());
    const parsed = await result.current.loadNotes({ path: 'chords/a.musicxml' });
    expect(parsed.ppq).toBe(4);
    expect(parsed.notes[0].midi).toBe(60);
    // second call is served from cache (no extra note fetch)
    const before = global.fetch.mock.calls.length;
    await result.current.loadNotes({ path: 'chords/a.musicxml' });
    expect(global.fetch.mock.calls.length).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/useLoopLibrary.test.js`
Expected: FAIL — the hook still fetches `midi/loops/index.yml` and parses YAML, so `loops` is `[]`/error and `loadNotes` returns MIDI-parsed `null`.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `frontend/src/modules/Piano/PianoKiosk/useLoopLibrary.js` with:

```javascript
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { musicXmlToNotes } from '@shared-music/musicXmlToNotes.mjs';
import { queryLoops, facets } from '@shared-music/loopQuery.mjs';
import { rankLayerCandidates } from '@shared-music/layerMatch.mjs';

/**
 * useLoopLibrary — loads the backend loop-manifest (one fetch, cached for the
 * session) and exposes query / facet / layer-ranking helpers plus lazy note
 * loading. The manifest is the queryable layer; a brick's notes are parsed from
 * its MusicXML on demand (tiny file, parsed in-browser) and memoized, so
 * browsing is cheap and only auditioned/active bricks pay the parse cost.
 */

const MANIFEST_URL = '/api/v1/piano/loop-manifest';
const streamUrl = (rel) => `/api/v1/local/stream/${encodeURI(rel)}`;

let _logger;
const logger = () => {
  if (!_logger) _logger = getLogger().child({ component: 'piano-loop-library' });
  return _logger;
};

export function useLoopLibrary() {
  const [loops, setLoops] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const notesCache = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t0 = performance.now();
        const res = await fetch(MANIFEST_URL);
        const data = await res.json();
        const bricks = Array.isArray(data?.bricks) ? data.bricks : [];
        if (cancelled) return;
        setLoops(bricks);
        logger().info('loop-library.loaded', { count: bricks.length, ms: Math.round(performance.now() - t0) });
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        logger().error('loop-library.load-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const query = useCallback((filters) => queryLoops(loops || [], filters), [loops]);
  const libraryFacets = useMemo(() => facets(loops || []), [loops]);
  const rankFor = useCallback((base, opts) => rankLayerCandidates(base, loops || [], opts), [loops]);

  /** Fetch + parse a brick's MusicXML into { ppq, notes:[{ticks,durationTicks,midi}] }. Cached. */
  const loadNotes = useCallback(async (entry) => {
    if (notesCache.current.has(entry.path)) return notesCache.current.get(entry.path);
    try {
      const xml = await (await fetch(streamUrl(`midi/${entry.path}`))).text();
      const { ppq, notes } = musicXmlToNotes(xml);
      const result = { ppq, notes };
      notesCache.current.set(entry.path, result);
      logger().debug('loop-library.notes-loaded', { path: entry.path, notes: notes.length });
      return result;
    } catch (err) {
      logger().warn('loop-library.notes-failed', { path: entry.path, error: err.message });
      return null;
    }
  }, []);

  return {
    loops,
    loading: loops === null && !error,
    error,
    query,
    facets: libraryFacets,
    rankFor,
    loadNotes,
  };
}

export default useLoopLibrary;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/useLoopLibrary.test.js`
Expected: PASS — `ℹ fail 0`; manifest bricks appear as `loops`, `loadNotes` returns `{ ppq: 4, notes:[{midi:60,…}] }` and caches.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/useLoopLibrary.js frontend/src/modules/Piano/PianoKiosk/useLoopLibrary.test.js
git commit -m "feat(piano): useLoopLibrary reads backend manifest + lazy MusicXML notes"
```

---

### Task 5: Facets & filtering over `genre`/`emotion`/`tags`/`quality`

**Files:**
- Modify: `shared/music/loopQuery.mjs` (rewrite `queryLoops` + `facets`)
- Test: `shared/music/loopQuery.test.mjs` (add cases; the file exists — read it first and append, do not delete existing exports that other suites rely on unless they reference removed fields)

**Interfaces:**
- Consumes: `roleOf` (`./layerMatch.mjs`).
- Produces:
  - `queryLoops(loops, { role?, genre?, emotion?, quality?, text? }) → loops[]` (AND semantics; array fields matched by membership).
  - `facets(loops) → { roles: Record<string,number>, genres: Record<string,number>, emotions: Record<string,number>, qualities: Record<string,number> }`.

- [ ] **Step 1: Write the failing test**

```javascript
// append to shared/music/loopQuery.test.mjs (import stays the same)
import { describe, it, expect } from 'vitest';
import { queryLoops, facets } from './loopQuery.mjs';

const SAMPLE = [
  { path: 'chords/a.musicxml', type: 'chord-progression', genre: ['lofi'], emotion: ['dreamy'], tags: ['lofi', 'dreamy'], quality: 'best', title: 'A', slug: 'a', artist: '' },
  { path: 'melodies/b.musicxml', type: 'melody', genre: ['house'], emotion: [], tags: ['house'], quality: '', title: 'B', slug: 'b', artist: 'Niko' },
  { path: 'percussion/c.musicxml', type: 'groove', genre: [], emotion: [], tags: [], quality: '', title: '', slug: 'four-on-floor', artist: '' },
];

describe('queryLoops (brick fields)', () => {
  it('filters by role, genre, emotion, quality (AND)', () => {
    expect(queryLoops(SAMPLE, { role: 'chords' }).map((l) => l.slug)).toEqual(['a']);
    expect(queryLoops(SAMPLE, { genre: 'house' }).map((l) => l.slug)).toEqual(['b']);
    expect(queryLoops(SAMPLE, { emotion: 'dreamy' }).map((l) => l.slug)).toEqual(['a']);
    expect(queryLoops(SAMPLE, { quality: 'best' }).map((l) => l.slug)).toEqual(['a']);
    expect(queryLoops(SAMPLE, { genre: 'lofi', quality: 'best' }).map((l) => l.slug)).toEqual(['a']);
  });
  it('free-text searches title/slug/artist/tags', () => {
    expect(queryLoops(SAMPLE, { text: 'niko' }).map((l) => l.slug)).toEqual(['b']);
    expect(queryLoops(SAMPLE, { text: 'dreamy' }).map((l) => l.slug)).toEqual(['a']);
  });
});

describe('facets (brick fields)', () => {
  it('counts roles, genres, emotions, qualities', () => {
    const f = facets(SAMPLE);
    expect(f.roles).toMatchObject({ chords: 1, melody: 1, groove: 1 });
    expect(f.genres).toMatchObject({ lofi: 1, house: 1 });
    expect(f.emotions).toMatchObject({ dreamy: 1 });
    expect(f.qualities).toMatchObject({ best: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs shared/music/loopQuery.test.mjs`
Expected: FAIL — current `queryLoops` reads `mood`/`sources`/`descriptor`/`chords`; new field filters return wrong sets and `facets` has no `genres`.

- [ ] **Step 3: Write minimal implementation**

Replace `shared/music/loopQuery.mjs` with:

```javascript
// loopQuery — pure filtering + faceting over the loop manifest (brick entries).
// Powers the browse surface in Producer/Playalong. No DOM.

import { roleOf } from './layerMatch.mjs';

const has = (arr, v) => Array.isArray(arr) && arr.some((x) => String(x).toLowerCase() === String(v).toLowerCase());

/**
 * Filter bricks by any combination of role / genre / emotion / quality / free
 * text (AND). Array fields (genre/emotion/tags) match by membership.
 * @param {object[]} loops manifest entries
 * @param {{role?:string, genre?:string, emotion?:string, quality?:string, text?:string}} filters
 */
export function queryLoops(loops, filters = {}) {
  const { role, genre, emotion, quality, text } = filters;
  const needle = text ? text.toLowerCase() : null;
  return loops.filter((l) => {
    if (role && roleOf(l) !== role) return false;
    if (genre && !has(l.genre, genre)) return false;
    if (emotion && !has(l.emotion, emotion)) return false;
    if (quality && (l.quality || '').toLowerCase() !== quality.toLowerCase()) return false;
    if (needle) {
      const hay = [l.title, l.slug, l.artist, ...(l.tags || [])].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/** Count bricks by role / genre / emotion / quality for building filter chips. */
export function facets(loops) {
  const roles = {}; const genres = {}; const emotions = {}; const qualities = {};
  const bump = (obj, key) => { if (key) obj[key] = (obj[key] || 0) + 1; };
  for (const l of loops) {
    bump(roles, roleOf(l));
    for (const g of l.genre || []) bump(genres, g);
    for (const e of l.emotion || []) bump(emotions, e);
    bump(qualities, l.quality);
  }
  return { roles, genres, emotions, qualities };
}

export default { queryLoops, facets };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs shared/music/loopQuery.test.mjs`
Expected: PASS — `ℹ fail 0`. (If pre-existing cases in this file assert on `mood`/`sources`, update them to the new fields — those old fields no longer exist on any entry.)

- [ ] **Step 5: Commit**

```bash
git add shared/music/loopQuery.mjs shared/music/loopQuery.test.mjs
git commit -m "feat(piano): loopQuery facets/filter over genre/emotion/tags/quality"
```

---

### Task 6: `layerMatch` — groove role + tag-overlap ranking

**Files:**
- Modify: `shared/music/layerMatch.mjs` (`ROLE_BY_TYPE`, `compatibilityScore`, `reasonsFor`)
- Test: `shared/music/layerMatch.test.mjs` (read first; append cases, update any that assert on `mood`/`sources`)

**Interfaces:**
- Produces (unchanged signatures): `roleOf(entry) → string` (now maps `groove` too), `compatibilityScore(base, cand) → number`, `rankLayerCandidates(base, candidates, opts) → {entry,score,reasons,stackable}[]`.

Note: `mood` (string) and `sources` (array) no longer exist on entries. Rank on `emotion` overlap (replacing `mood`) and `genre` overlap (replacing `sources`). `modeOf` still reads `entry.roman[0]` — harmonic bricks carry a `roman` array from `derived-signature`; melodic bricks have `roman: []`, so `modeOf` returns `null` and the mode bonus no-ops (correct — no false mode claim).

- [ ] **Step 1: Write the failing test**

```javascript
// append to shared/music/layerMatch.test.mjs
import { describe, it, expect } from 'vitest';
import { roleOf, compatibilityScore, rankLayerCandidates } from './layerMatch.mjs';

describe('layerMatch (brick fields)', () => {
  it('maps groove type to the groove role', () => {
    expect(roleOf({ type: 'groove' })).toBe('groove');
    expect(roleOf({ type: 'chord-progression' })).toBe('chords');
    expect(roleOf({ type: 'bassline' })).toBe('bass');
  });

  it('rewards shared emotion and genre, and complementary roles', () => {
    const base = { type: 'chord-progression', roman: ['I', 'V'], emotion: ['dreamy'], genre: ['lofi'] };
    const shares = { type: 'melody', roman: [], emotion: ['dreamy'], genre: ['lofi'] };
    const differs = { type: 'melody', roman: [], emotion: ['dark'], genre: ['edm'] };
    expect(compatibilityScore(base, shares)).toBeGreaterThan(compatibilityScore(base, differs));
  });

  it('ranks candidates best-first and excludes the base itself', () => {
    const base = { path: 'chords/x.musicxml', type: 'chord-progression', roman: ['I'], emotion: ['dreamy'], genre: ['lofi'] };
    const cands = [base, { path: 'melodies/y.musicxml', type: 'melody', roman: [], emotion: ['dreamy'], genre: ['lofi'] }];
    const ranked = rankLayerCandidates(base, cands);
    expect(ranked.map((r) => r.entry.path)).toEqual(['melodies/y.musicxml']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs shared/music/layerMatch.test.mjs`
Expected: FAIL — `roleOf({type:'groove'})` returns `'other'`; scoring reads absent `mood`/`sources`, so the shared-vs-differs assertion fails.

- [ ] **Step 3: Write minimal implementation**

Apply these edits to `shared/music/layerMatch.mjs`:

Add `groove` to the role map:

```javascript
const ROLE_BY_TYPE = {
  'chord-progression': 'chords',
  melody: 'melody',
  bassline: 'bass',
  idea: 'idea',
  groove: 'groove',
};
```

Add an overlap helper (below `modeOf`):

```javascript
/** Do two array fields share at least one (case-insensitive) member? */
function overlaps(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const set = new Set(a.map((x) => String(x).toLowerCase()));
  return b.some((x) => set.has(String(x).toLowerCase()));
}
```

Rewrite `compatibilityScore` to score `emotion`/`genre` overlap in place of `mood`/`sources` (keep `sameSignature`, `complement`, `sameRole`, `mode`, `sameArtist`, `bpm`):

```javascript
const WEIGHTS = { sameSignature: 10, complement: 3, sameRole: -3, emotion: 2, mode: 1, genre: 1, sameArtist: 2, bpmMax: 1 };

export function compatibilityScore(base, cand) {
  let score = 0;
  const bSig = signatureKey(base.roman);
  const cSig = signatureKey(cand.roman);
  if (bSig && cSig && bSig === cSig) score += WEIGHTS.sameSignature;
  score += roleOf(cand) === roleOf(base) ? WEIGHTS.sameRole : WEIGHTS.complement;
  if (overlaps(base.emotion, cand.emotion)) score += WEIGHTS.emotion;
  const bm = modeOf(base); const cm = modeOf(cand);
  if (bm && cm && bm === cm) score += WEIGHTS.mode;
  if (overlaps(base.genre, cand.genre)) score += WEIGHTS.genre;
  if (base.artist && cand.artist && base.artist === cand.artist) score += WEIGHTS.sameArtist;
  if (base.bpm && cand.bpm) {
    const closeness = 1 - Math.min(Math.abs(base.bpm - cand.bpm), 40) / 40;
    score += closeness * WEIGHTS.bpmMax;
  }
  return score;
}
```

Update `reasonsFor` to match (replace the `mood`/`sources` lines):

```javascript
function reasonsFor(base, cand) {
  const reasons = [];
  const bSig = signatureKey(base.roman);
  const cSig = signatureKey(cand.roman);
  if (bSig && cSig && bSig === cSig) reasons.push('same progression');
  if (roleOf(cand) !== roleOf(base)) reasons.push(`adds ${roleOf(cand)}`);
  if (overlaps(base.emotion, cand.emotion)) reasons.push('same mood');
  if (base.artist && cand.artist === base.artist) reasons.push('same artist');
  else if (overlaps(base.genre, cand.genre)) reasons.push('same genre');
  if (base.bpm && cand.bpm && Math.abs(base.bpm - cand.bpm) <= 8) reasons.push('tempo match');
  return reasons;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs shared/music/layerMatch.test.mjs`
Expected: PASS — `ℹ fail 0`. Update any pre-existing case in this file that asserted `mood`/`sources` reasons to the new `same mood`/`same genre` strings.

- [ ] **Step 5: Commit**

```bash
git add shared/music/layerMatch.mjs shared/music/layerMatch.test.mjs
git commit -m "feat(piano): layerMatch groove role + emotion/genre-overlap ranking"
```

---

### Task 7: LibraryBrowser facet chips + predicate over new fields

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/producer/LibraryBrowser.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/producer/LibraryBrowser.test.jsx` (read first — it renders the browser; update mood assertions to genre/quality)

**Interfaces:**
- Consumes: `lib.facets` now shaped `{ roles, genres, emotions, qualities }` (Task 5); entries carry `genre`/`emotion`/`tags`/`quality` arrays+string (Task 2).
- Produces: browse UI whose facet state is `genre` (was `mood`) + a `quality` toggle defaulting to `best`; the client-side predicate filters on the new fields; the per-card tag renders `entry.quality` and the first `entry.tags`.

Note: LibraryBrowser currently (`:297`) holds `const [mood, setMood] = useState(null)`, builds `moodChips` from `lib.facets.moods` (`:376-379`), filters `entry.mood` (`:361`), and renders `entry.mood` as a card tag (`:264`). Rename the facet dimension to `genre`, source chips from `lib.facets.genres`, and add a `quality` default. Keep `kind` (role) and `feel` (groove) facets as-is; `roleOf` from layerMatch already handles `groove`.

- [ ] **Step 1: Write the failing test**

```javascript
// add to LibraryBrowser.test.jsx — a genre-facet render + filter case.
// (Read the existing file for its render helper/mock lib shape and reuse it;
// the snippet below shows the assertions the task must satisfy.)
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// ...reuse the file's existing imports + renderBrowser(lib) helper...

const LIB = {
  loops: [
    { path: 'chords/a.musicxml', type: 'chord-progression', title: 'Dreamy Bed', slug: 'a', genre: ['lofi'], emotion: ['dreamy'], tags: ['lofi'], quality: 'best', artist: '' },
    { path: 'melodies/b.musicxml', type: 'melody', title: 'House Lead', slug: 'b', genre: ['house'], emotion: [], tags: ['house'], quality: '', artist: '' },
  ],
  facets: { roles: { chords: 1, melody: 1 }, genres: { lofi: 1, house: 1 }, emotions: { dreamy: 1 }, qualities: { best: 1 } },
  loadNotes: async () => ({ ppq: 4, notes: [] }),
};

describe('LibraryBrowser genre facet', () => {
  it('renders genre chips from facets.genres and filters on click', () => {
    renderBrowser(LIB); // existing helper
    const lofi = screen.getByRole('button', { name: /lofi/i });
    fireEvent.click(lofi);
    expect(screen.getByText('Dreamy Bed')).toBeInTheDocument();
    expect(screen.queryByText('House Lead')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/producer/LibraryBrowser.test.jsx`
Expected: FAIL — no `lofi` genre chip is rendered (component still reads `facets.moods`).

- [ ] **Step 3: Write minimal implementation**

In `LibraryBrowser.jsx`:

1. Rename the facet state (`:297`): `const [genre, setGenre] = useState(null);` and `const [genresExpanded, setGenresExpanded] = useState(false);` (was `mood`/`moodsExpanded`).
2. Filter predicate (`:361`): replace `if (mood && (entry.mood || '') !== mood) return false;` with:
   ```javascript
   if (genre && !(entry.genre || []).map((g) => g.toLowerCase()).includes(genre.toLowerCase())) return false;
   ```
3. Search haystack (`:364`): replace the `entry.mood`/`entry.descriptor`/`entry.chords` members with the new fields:
   ```javascript
   const hay = [entry.title, entry.slug, entry.artist, ...(entry.tags || [])].filter(Boolean).join(' ').toLowerCase();
   ```
4. Chip data (`:376-379`): source from genres:
   ```javascript
   const genreChips = useMemo(() => {
     const counts = Object.entries(lib.facets?.genres || {}).sort((a, b) => b[1] - a[1]);
     const names = counts.map(([g]) => g);
     return { top: names.slice(0, 8), rest: names.slice(8) };
   }, [lib.facets]);
   ```
5. Chip rendering block (`:487-505`): render `genreChips` with `setGenre`, `aria-label="genre"`, `is-on` when `genre === g`, and the expand toggle using `genresExpanded`.
6. Card tag (`:264`): replace `{entry.mood && <span className="piano-loop__tag">{entry.mood}</span>}` with:
   ```javascript
   {entry.quality === 'best' && <span className="piano-loop__tag">best</span>}
   {(entry.tags?.[0]) && <span className="piano-loop__tag">{entry.tags[0]}</span>}
   ```
7. Update the dependency arrays that referenced `mood`/`feel`/`text` (`:370`, `:387-389`) to use `genre` in place of `mood`.
8. (Default-to-best) initialize the browse view to the curated set: `const [quality, setQuality] = useState('best');` and add `if (quality && (entry.quality || '') !== quality) return false;` to the predicate, plus a single toggle chip ("All / Best") that sets `quality` to `null` / `'best'`. Wire `quality` into the same predicate `useMemo` dependency array.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/producer/LibraryBrowser.test.jsx`
Expected: PASS — `ℹ fail 0`; the `lofi` chip filters to the lofi brick. Fix any pre-existing `mood` assertions in the suite to the genre/quality equivalents.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/producer/LibraryBrowser.jsx frontend/src/modules/Piano/PianoKiosk/producer/LibraryBrowser.test.jsx
git commit -m "feat(piano): LibraryBrowser genre/quality facets over brick fields"
```

---

### Task 8: Re-author the legacy prefabs against real brick paths

**Files:**
- Modify (in the data volume, via `sudo docker exec`): `media/midi/prefabs/stacks/{pop-1-5-6-4,lofi-groove-bed,bass-drums-pocket}.yml`, `media/midi/prefabs/songs/{sunset-drive,slow-bloom}.yml`
- Test: `frontend/src/modules/Piano/PianoKiosk/producer/prefabHydrate.brickpaths.test.js` (a resolution test against a real-shaped manifest, so the plan verifies "no unresolved refs" without a live server)

**Interfaces:**
- Consumes: `resolvePrefabStack`, `resolvePrefabSong` (`producer/prefabHydrate.js` — unchanged). A ref resolves when its `path` matches a manifest entry's `path` (`resolveEntry` prefers `path`, falls back to `slug`).
- Produces: prefab YAMLs whose every layer ref uses a real brick `path` (e.g. `chords/…​.musicxml`, `basslines/…​.musicxml`, `percussion/…​.musicxml`), so `unresolved` is empty after hydration.

Procedure to pick real paths (run against the data volume, read-only): the `claude` user can read the brick folders directly on `kckern-server`:
```bash
BASE=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/midi
ls "$BASE/basslines" | head            # pick a simple root line
ls "$BASE/percussion"                  # grooves: four-on-floor.musicxml, halftime-backbeat.musicxml, brush-swing.musicxml
ls "$BASE/chords" | grep -iE 'IV.*V' | head   # pick a pop-ish bed
```
Choose one bed (chords), one root line (basslines), and one groove (percussion) per stack; a real, verified example for `bass-drums-pocket` uses `basslines/I⠃-III⠃-II⠏-I⠃-V⠃-II⠏.musicxml` + `percussion/four-on-floor.musicxml`.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/Piano/PianoKiosk/producer/prefabHydrate.brickpaths.test.js
import { describe, it, expect } from 'vitest';
import { resolvePrefabStack } from './prefabHydrate.js';

// The manifest paths the re-authored prefab MUST reference (real bricks).
const MANIFEST = [
  { path: 'basslines/I⠃-III⠃-II⠏-I⠃-V⠃-II⠏.musicxml', type: 'bassline', slug: 'bass-1' },
  { path: 'percussion/four-on-floor.musicxml', type: 'groove', slug: 'four-on-floor' },
];

// This mirrors the YAML the task writes to media/midi/prefabs/stacks/bass-drums-pocket.yml.
const BASS_DRUMS_POCKET = {
  id: 'bass-drums-pocket',
  title: 'Bass + drums pocket',
  layers: [
    { path: 'basslines/I⠃-III⠃-II⠏-I⠃-V⠃-II⠏.musicxml', role: 'bass' },
    { path: 'percussion/four-on-floor.musicxml', role: 'groove' },
  ],
};

describe('bass-drums-pocket prefab resolves against real brick paths', () => {
  it('produces two layers and no unresolved refs', () => {
    const out = resolvePrefabStack(BASS_DRUMS_POCKET, MANIFEST);
    expect(out.unresolved).toEqual([]);
    expect(out.layers).toHaveLength(2);
    expect(out.layers.find((l) => l.role === 'groove').channel).toBe(9); // grooves pinned to DRUM_CHANNEL
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/producer/prefabHydrate.brickpaths.test.js`
Expected: initially PASS for the in-file payload (it already uses real paths) — this test's job is to LOCK the YAML shape. Before writing the YAML, confirm the referenced paths exist on disk (`ls "$BASE/basslines/I⠃-III⠃-II⠏-I⠃-V⠃-II⠏.musicxml"`). If a chosen path does not exist, the test's `MANIFEST` and payload must be corrected to a path that does — treat a missing file as the failing condition.

- [ ] **Step 3: Write the prefab YAML (data volume)**

For each of the five prefabs, write the file with real brick paths. Example for the stack above (repeat the pattern for the other four, choosing appropriate bricks per the procedure; songs use `sections[].layers[]` + `arrangement[]` per `resolvePrefabSong`):

```bash
sudo docker exec daylight-station sh -c "cat > data/../media/midi/prefabs/stacks/bass-drums-pocket.yml << 'EOF'
id: bass-drums-pocket
title: Bass + drums pocket
author: curated
kind: stack
layers:
  - path: 'basslines/I⠃-III⠃-II⠏-I⠃-V⠃-II⠏.musicxml'
    role: bass
  - path: 'percussion/four-on-floor.musicxml'
    role: groove
EOF"
```

(Confirm the container's media mount path first with `sudo docker exec daylight-station sh -c 'ls media/midi/prefabs/stacks'`; adjust the redirect target to the actual in-container media path. After writing, `chown` is not needed for reads, but if the app must write them later, `sudo docker exec daylight-station chown node:node <file>`.)

Also update the prefab manifest `media/midi/prefabs/index.yml` only if `layerCount`/`sectionCount` counts changed.

- [ ] **Step 4: Verify resolution + lock the shape test**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/producer/prefabHydrate.brickpaths.test.js`
Expected: PASS — `unresolved: []`, two layers, groove on channel 9. Add one analogous `describe` block per re-authored prefab (song prefabs assert `resolvePrefabSong(...).unresolved` is `[]` and `draft.sections` non-empty).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/producer/prefabHydrate.brickpaths.test.js
git commit -m "feat(piano): re-author prefabs onto real brick paths + resolution lock test"
```

(The YAML lives in the data volume, not the repo — note in the commit body that the five prefab files were written to `media/midi/prefabs/{stacks,songs}/` on the host.)

---

## Post-Implementation Verification

After all tasks, run the full producer + shared-music suites and drive the app:

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  shared/music/musicXmlToNotes.test.mjs \
  shared/music/loopQuery.test.mjs \
  shared/music/layerMatch.test.mjs \
  backend/src/3_applications/piano/loopManifest.test.mjs \
  backend/src/4_api/v1/routers/piano.loop-manifest.test.mjs \
  frontend/src/modules/Piano/PianoKiosk/useLoopLibrary.test.js \
  frontend/src/modules/Piano/PianoKiosk/producer/LibraryBrowser.test.jsx \
  frontend/src/modules/Piano/PianoKiosk/producer/prefabHydrate.test.js \
  frontend/src/modules/Piano/PianoKiosk/modes/Producer/Producer.test.jsx
```

Then exercise the live endpoint before any deploy:
```bash
curl -s http://localhost:3111/api/v1/piano/loop-manifest | head -c 400
curl -s "http://localhost:3111/api/v1/piano/loop-manifest" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('count',j.count,'sample',JSON.stringify(j.bricks[0]))})"
```
Expected: `count` ≈ 3231, and a sample brick carrying `path`, `type`, `tags`, `quality`, and (for a chord/melody/idea/bassline) a `timeline` array.
```

Per CLAUDE.local.md: do NOT deploy while a fitness session or a playing Player is live, and hard-reload the garage/piano kiosk after deploying frontend changes.
```

---

## Self-Review Notes

- **Spec coverage:** manifest source (Tasks 2-3), lazy notes (Tasks 1, 4), grid-based compatibility (already wired — Task 2 supplies the `timeline` it needs; Task 6 adds the `groove` role gap), field renames genre/emotion/tags/quality (Tasks 5, 7), key/tempo as Producer controls (Global Constraints; Producer already owns them — no code change), prefab re-authoring (Task 8). All README "Consuming from Producer" bullets map to a task.
- **Type consistency:** entry field names (`timeline`/`timelineRoot`/`specificity`/`needsReview`) match `libraryRanking.timelineOf`; note shape `{ticks,durationTicks,midi}`+`ppq` is uniform from parser → builder → scheduler; `roleOf` returns `groove` consistently in Tasks 5/6/7.
- **Known follow-ups (out of scope):** the `derived-roman` analyzer's debatable tail (README caveats) is inherited as-is; the `_workspace/loops-midi` and `loop-enrich.cli.mjs` (old `.mid` pipeline) are now dead and can be retired in a cleanup pass.
```
