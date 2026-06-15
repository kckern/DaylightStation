# Art Collections (Art + Immich) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ArtMode draw from named collections — classical-art collections (metadata filters / curated folders) and Immich photo collections (albums / people / search) — selectable via `GET /api/v1/art/featured?collection=<key>`.

**Architecture:** A collection is `{ source: 'art'|'immich', ...selector }`. Each source resolves its selector into a normalized candidate list `{ id, image, width, height, kind, meta, loadImage() }`; the existing ArtMode pipeline (eligibility, single/diptych classification, companion pairing, matte) runs on that list unchanged. `ArtAdapter` is refactored around this seam; the art path is preserved byte-for-byte for the default `all` collection.

**Tech Stack:** Node ESM (`.mjs`), Jimp (color/matte), js-yaml, axios (Immich bytes), Vitest.

**Test runner:** these pure/adapter specs are vitest-style. Run a single file with:
```
./node_modules/.bin/vitest run --config vitest.config.mjs <file>
```
The implementer must first confirm this runner works for `tests/unit/art/*` (it already runs `tests/unit/art/deriveMatte.test.mjs`). Backend adapter specs in this plan live under `tests/unit/art/` so they use the same vitest config.

**Phasing:** Phase A (Tasks 1-4) ships art-source collections end-to-end. Phase B (Tasks 5-7) adds the Immich source. Each task is independently committable.

---

## File Structure

- `backend/src/1_adapters/content/art/collections.mjs` (new, pure) — `parseYear`, `buildArtPredicate`, `resolveCollection`.
- `backend/src/1_adapters/content/art/sources/artSource.mjs` (new) — art-source candidate resolver (folder scan + metadata + predicate).
- `backend/src/1_adapters/content/art/sources/immichSource.mjs` (new) — Immich candidate resolver.
- `backend/src/1_adapters/content/art/ArtAdapter.mjs` (refactor) — orchestrate source → candidates → pipeline; `selectFeatured({ collection, pick })`.
- `backend/src/4_api/v1/routers/art.mjs` (modify) — read `?collection=`.
- `backend/src/app.mjs` (modify) — load `art.yml`, inject collections + Immich client/bytes into `createArtAdapter`.
- `data/household/config/art.yml` (new, in the container data volume) — starter collections.
- Tests under `tests/unit/art/`.

---

## Phase A — Art-source collections

### Task 1: `collections.mjs` — pure collection logic

**Files:**
- Create: `backend/src/1_adapters/content/art/collections.mjs`
- Test: `tests/unit/art/collections.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/unit/art/collections.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { parseYear, buildArtPredicate, resolveCollection }
  from '../../../backend/src/1_adapters/content/art/collections.mjs';

describe('parseYear', () => {
  it('extracts the first 4-digit run', () => {
    expect(parseYear('c. 1860')).toBe(1860);
    expect(parseYear('1519')).toBe(1519);
    expect(parseYear('1880-1885')).toBe(1880);
  });
  it('returns null for 0000 / missing / non-year', () => {
    expect(parseYear('0000')).toBeNull();
    expect(parseYear('')).toBeNull();
    expect(parseYear(null)).toBeNull();
    expect(parseYear('undated')).toBeNull();
  });
});

describe('buildArtPredicate', () => {
  const entry = (over = {}) => ({
    folder: 'Claude Monet - 1900 - Water Lilies',
    meta: { artist: 'Claude Monet', date: 'c. 1900', origin: 'France', medium: 'Oil on canvas', department: 'European Painting', ...over },
  });

  it('empty def matches everything', () => {
    expect(buildArtPredicate({})(entry())).toBe(true);
  });
  it('date range filters by parsed year (inclusive)', () => {
    const p = buildArtPredicate({ dateMin: 1600, dateMax: 1750 });
    expect(p(entry({ date: '1700' }))).toBe(true);
    expect(p(entry({ date: '1900' }))).toBe(false);
    expect(p(entry({ date: '0000' }))).toBe(false); // unparseable excluded from date filters
  });
  it('field match is case-insensitive substring', () => {
    expect(buildArtPredicate({ origin: 'france' })(entry())).toBe(true);
    expect(buildArtPredicate({ artist: 'monet' })(entry())).toBe(true);
    expect(buildArtPredicate({ medium: 'sculpture' })(entry())).toBe(false);
  });
  it('works restricts by exact folder name', () => {
    const p = buildArtPredicate({ works: ['Claude Monet - 1900 - Water Lilies', 'Other'] });
    expect(p(entry())).toBe(true);
    expect(p(entry({}, ))).toBe(true);
    expect(buildArtPredicate({ works: ['Nope'] })(entry())).toBe(false);
  });
  it('criteria combine with AND', () => {
    const p = buildArtPredicate({ dateMin: 1850, dateMax: 1950, origin: 'france' });
    expect(p(entry({ date: '1900', origin: 'France' }))).toBe(true);
    expect(p(entry({ date: '1900', origin: 'Italy' }))).toBe(false);
  });
});

describe('resolveCollection', () => {
  const defs = { all: {}, baroque: { dateMin: 1600, dateMax: 1750 } };
  it('returns the named def', () => {
    expect(resolveCollection(defs, 'baroque')).toEqual({ key: 'baroque', def: { dateMin: 1600, dateMax: 1750 } });
  });
  it('falls back to all for unknown / empty key', () => {
    expect(resolveCollection(defs, 'nope')).toEqual({ key: 'all', def: {} });
    expect(resolveCollection(defs, undefined)).toEqual({ key: 'all', def: {} });
  });
  it('falls back to an empty def when all is undefined', () => {
    expect(resolveCollection({}, 'x')).toEqual({ key: 'all', def: {} });
  });
});
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/collections.test.mjs` → cannot resolve module.

- [ ] **Step 3: Create `backend/src/1_adapters/content/art/collections.mjs`:**

```js
// collections.mjs — pure collection resolution for ArtMode. No DOM, no IO.

// First 4-digit run in a (messy) date string → year, else null. "0000" → null.
export function parseYear(dateStr) {
  if (dateStr == null) return null;
  const m = String(dateStr).match(/\d{4}/);
  if (!m) return null;
  const y = Number(m[0]);
  return y > 0 ? y : null;
}

const includesCI = (hay, needle) =>
  String(hay ?? '').toLowerCase().includes(String(needle).toLowerCase());

// Build a predicate over an art entry { folder, meta }. Empty def → match-all.
// Date filters exclude entries with an unparseable year. Field filters are
// case-insensitive substring matches. `works` restricts to exact folder names.
export function buildArtPredicate(def = {}) {
  const FIELDS = ['origin', 'medium', 'artist', 'department'];
  return (entry) => {
    const meta = entry?.meta || {};
    if (def.dateMin != null || def.dateMax != null) {
      const year = parseYear(meta.date);
      if (year == null) return false;
      if (def.dateMin != null && year < def.dateMin) return false;
      if (def.dateMax != null && year > def.dateMax) return false;
    }
    for (const f of FIELDS) {
      if (def[f] != null && !includesCI(meta[f], def[f])) return false;
    }
    if (Array.isArray(def.works) && def.works.length > 0) {
      if (!def.works.includes(entry.folder)) return false;
    }
    return true;
  };
}

// Resolve a collection key against a defs map, falling back to `all` (or {}).
export function resolveCollection(defs = {}, key) {
  if (key && Object.prototype.hasOwnProperty.call(defs, key)) {
    return { key, def: defs[key] || {} };
  }
  return { key: 'all', def: defs.all || {} };
}

export default { parseYear, buildArtPredicate, resolveCollection };
```

- [ ] **Step 4: Run to confirm PASS** — same command → all green.

- [ ] **Step 5: Commit**
```bash
git add backend/src/1_adapters/content/art/collections.mjs tests/unit/art/collections.test.mjs
git commit -m "feat(art): pure collection resolution (parseYear, predicate, resolve)"
```

---

### Task 2: `artSource.mjs` — normalized art candidates

**Files:**
- Create: `backend/src/1_adapters/content/art/sources/artSource.mjs`
- Test: `tests/unit/art/artSource.test.mjs`

This refactors the folder-scan / metadata / image-path logic out of `ArtAdapter` into a source resolver that returns **normalized candidates** and honors a collection def (folder scope + predicate). A candidate is:

```
{ id, image, width, height, kind, meta, loadImage }
```
- `id` — stable key (the folder name).
- `image` — display URL.
- `width`/`height` — pixels; `kind` — 'landscape'|'portrait' (ratio classification; panoramic excluded → not emitted).
- `meta` — `{ title, artist, date, origin, medium, department, credit }`.
- `loadImage()` — async → a Jimp image (for matte/color), read from the local file.

- [ ] **Step 1: Write the failing test** — create `tests/unit/art/artSource.test.mjs`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createArtSource } from '../../../backend/src/1_adapters/content/art/sources/artSource.mjs';

let base;
const write = async (rel, content) => {
  const p = path.join(base, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
};

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'artsrc-'));
  // classic pool
  await write('art/classic/Monet - 1900 - Lilies/lilies.jpg', 'x');
  await write('art/classic/Monet - 1900 - Lilies/metadata.yaml',
    'title: Lilies\nartist: Claude Monet\ndate: c. 1900\norigin: France\nwidth: 1600\nheight: 1000\n'); // landscape
  await write('art/classic/Rembrandt - 1640 - Portrait/p.jpg', 'x');
  await write('art/classic/Rembrandt - 1640 - Portrait/metadata.yaml',
    'title: Portrait\nartist: Rembrandt\ndate: 1640\norigin: Netherlands\nwidth: 800\nheight: 1200\n'); // portrait
  await write('art/classic/Wide - 1900 - Pano/pano.jpg', 'x');
  await write('art/classic/Wide - 1900 - Pano/metadata.yaml',
    'title: Pano\ndate: 1900\nwidth: 4000\nheight: 1000\n'); // 4:1 panoramic → excluded
  // curated themed folder
  await write('art/themed/americana/Flag - 1950 - Stars/flag.jpg', 'x');
  await write('art/themed/americana/Flag - 1950 - Stars/metadata.yaml',
    'title: Stars\ndate: 1950\nwidth: 1600\nheight: 1000\n');
});
afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });

describe('createArtSource.resolveCandidates', () => {
  const src = () => createArtSource({ imgBasePath: base });

  it('all → whole classic pool, excludes panoramic, classifies kind', async () => {
    const c = await src().resolveCandidates({});
    const ids = c.map((x) => x.id).sort();
    expect(ids).toEqual(['Monet - 1900 - Lilies', 'Rembrandt - 1640 - Portrait']);
    expect(c.find((x) => x.id.startsWith('Monet')).kind).toBe('landscape');
    expect(c.find((x) => x.id.startsWith('Rembrandt')).kind).toBe('portrait');
  });

  it('builds a media image URL', async () => {
    const [m] = (await src().resolveCandidates({})).filter((x) => x.id.startsWith('Monet'));
    expect(m.image).toBe('/media/img/art/classic/Monet%20-%201900%20-%20Lilies/lilies.jpg');
    expect(m.meta.artist).toBe('Claude Monet');
  });

  it('date filter scopes the pool', async () => {
    const c = await src().resolveCandidates({ dateMin: 1600, dateMax: 1700 });
    expect(c.map((x) => x.id)).toEqual(['Rembrandt - 1640 - Portrait']);
  });

  it('folder selector scopes to a curated subdir', async () => {
    const c = await src().resolveCandidates({ folder: 'themed/americana' });
    expect(c.map((x) => x.id)).toEqual(['Flag - 1950 - Stars']);
    expect(c[0].image).toBe('/media/img/art/themed/americana/Flag%20-%201950%20-%20Stars/flag.jpg');
  });

  it('exposes loadImage as a function on each candidate', async () => {
    const c = await src().resolveCandidates({});
    expect(typeof c[0].loadImage).toBe('function');
  });
});
```

(Decoding a real image through `loadImage` is exercised end-to-end in the ArtAdapter test via generated `Jimp` images; here we only assert the candidate contract.)

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artSource.test.mjs` → cannot resolve module.

- [ ] **Step 3: Create `backend/src/1_adapters/content/art/sources/artSource.mjs`:**

```js
// artSource.mjs — resolves an `art` collection def into normalized candidates.
// Scans media/img/art/<scope>/<work>/, reads metadata.yaml, classifies aspect,
// applies the collection predicate. Each candidate exposes loadImage() → Jimp.
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Jimp } from 'jimp';
import { buildArtPredicate } from '../collections.mjs';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MIN_RATIO = 4 / 3;
const MAX_RATIO = 16 / 9;
const toInt = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

// Encode each path segment but keep the slashes between them.
const encodeSegments = (rel) => rel.split('/').map(encodeURIComponent).join('/');

export function createArtSource({ imgBasePath, logger = console }) {
  async function readMeta(dir) {
    try {
      const raw = await fs.readFile(path.join(dir, 'metadata.yaml'), 'utf-8');
      const p = yaml.load(raw) || {};
      return {
        title: p.title ?? null, artist: p.artist ?? null,
        date: p.date != null ? String(p.date) : null,
        origin: p.origin ?? null, medium: p.medium ?? null,
        department: p.department ?? null, credit: p.credit ?? null,
        width: toInt(p.width), height: toInt(p.height),
      };
    } catch (err) {
      logger.warn?.('art.metadata.missing', { dir, error: err.message });
      return null;
    }
  }

  async function findImageFile(dir) {
    const files = await fs.readdir(dir);
    return files.find(
      (f) => !f.startsWith('.') && IMAGE_EXTS.includes(path.extname(f).toLowerCase())
    ) || null;
  }

  async function resolveCandidates(def = {}) {
    const scope = def.folder ? `art/${def.folder}` : 'art/classic';
    const scopeDir = path.join(imgBasePath, scope);
    const predicate = buildArtPredicate(def);

    let entries;
    try {
      entries = await fs.readdir(scopeDir, { withFileTypes: true });
    } catch (err) {
      logger.warn?.('art.scope.unreadable', { scope, error: err.message });
      return [];
    }
    const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const out = [];
    for (const folder of folders) {
      const dir = path.join(scopeDir, folder);
      const meta = await readMeta(dir);
      if (!meta || !meta.width || !meta.height) continue;
      const ratio = meta.width / meta.height;
      if (ratio > MAX_RATIO) continue;                       // panoramic excluded
      const entry = { folder, meta };
      if (!predicate(entry)) continue;
      const imageFile = await findImageFile(dir);
      if (!imageFile) { logger.warn?.('art.image.missing', { folder }); continue; }
      const kind = ratio >= MIN_RATIO ? 'landscape' : 'portrait';
      const localPath = path.join(dir, imageFile);
      out.push({
        id: folder,
        image: `/media/img/${encodeSegments(`${scope}/${folder}/${imageFile}`)}`,
        width: meta.width, height: meta.height, kind,
        meta: {
          title: meta.title, artist: meta.artist, date: meta.date,
          origin: meta.origin, medium: meta.medium,
          department: meta.department, credit: meta.credit,
        },
        loadImage: () => Jimp.read(localPath),
      });
    }
    logger.info?.('art.source.resolved', { scope, count: out.length });
    return out;
  }

  return { resolveCandidates };
}

export default createArtSource;
```

- [ ] **Step 4: Run to confirm PASS** — same command → green.

- [ ] **Step 5: Commit**
```bash
git add backend/src/1_adapters/content/art/sources/artSource.mjs tests/unit/art/artSource.test.mjs
git commit -m "feat(art): art source resolver (normalized candidates + collection scope)"
```

---

### Task 3: Refactor `ArtAdapter` onto the candidate pipeline (art only)

**Files:**
- Modify: `backend/src/1_adapters/content/art/ArtAdapter.mjs`
- Test: `tests/unit/art/ArtAdapter.test.mjs`

`ArtAdapter` keeps its selection pipeline (pick → classify → companion → matte) but now operates on **candidates** from a source resolver, and accepts `selectFeatured({ collection, pick })`. The default `all` collection reproduces today's behavior. Matte/color analysis runs on `candidate.loadImage()` and is cached by candidate `id`.

- [ ] **Step 1: Write the failing test** — create `tests/unit/art/ArtAdapter.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { Jimp } from 'jimp';
import { createArtAdapter } from '../../../backend/src/1_adapters/content/art/ArtAdapter.mjs';

// A solid-color Jimp image for deterministic matte/color.
const solid = (w, h, hex) => new Jimp({ width: w, height: h, color: hex });

const cand = (id, kind, over = {}) => ({
  id, kind,
  image: `/media/img/${id}.jpg`,
  width: kind === 'landscape' ? 1600 : 800,
  height: kind === 'landscape' ? 1000 : 1200,
  meta: { title: id, artist: 'A', credit: 'C' },
  loadImage: async () => solid(8, 8, 0x3344ffff),
  ...over,
});

// Fake source whose resolveCandidates returns a fixed list per collection key.
const fakeSource = (byDef) => ({
  resolveCandidates: async (def) => byDef(def),
});

describe('ArtAdapter.selectFeatured', () => {
  it('landscape primary → single panel with matte', async () => {
    const adapter = createArtAdapter({
      collections: { all: {} },
      artSource: fakeSource(() => [cand('land', 'landscape')]),
    });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(r.panels).toHaveLength(1);
    expect(r.panels[0].image).toBe('/media/img/land.jpg');
    expect(r.matte).toBeTruthy();
  });

  it('portrait primary + companion → diptych', async () => {
    const adapter = createArtAdapter({
      collections: { all: {} },
      artSource: fakeSource(() => [cand('p1', 'portrait'), cand('p2', 'portrait')]),
    });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('diptych');
    expect(r.panels.map((p) => p.image)).toEqual(['/media/img/p1.jpg', '/media/img/p2.jpg']);
  });

  it('unknown collection falls back to all', async () => {
    const calls = [];
    const adapter = createArtAdapter({
      collections: { all: {} },
      artSource: fakeSource((def) => { calls.push(def); return [cand('land', 'landscape')]; }),
    });
    const r = await adapter.selectFeatured({ collection: 'nope', pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(calls[0]).toEqual({});           // resolved to all → def {}
  });

  it('empty collection result falls back to the all pool', async () => {
    const adapter = createArtAdapter({
      collections: { all: {}, empty: { dateMin: 9999 } },
      artSource: fakeSource((def) => (def.dateMin === 9999 ? [] : [cand('land', 'landscape')])),
    });
    const r = await adapter.selectFeatured({ collection: 'empty', pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(r.panels[0].image).toBe('/media/img/land.jpg');
  });
});
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/ArtAdapter.test.mjs` → fails (signature/behavior mismatch).

- [ ] **Step 3: Replace `backend/src/1_adapters/content/art/ArtAdapter.mjs` with:**

```js
/**
 * ArtAdapter — selects artwork(s) for ArtMode from a named collection.
 *
 * A collection resolves (via a source resolver: art | immich) to normalized
 * candidates { id, image, width, height, kind, meta, loadImage }. Eligibility
 * and classification are done by the source (kind set; panoramic excluded).
 * A landscape primary shows singly; a portrait primary pairs with a companion
 * (tiered: same artist+credit → artist → credit → any) into a diptych with a
 * shared matte. Per-candidate color is cached by id for the process.
 *
 * Returns { mode: 'single'|'diptych', matte, panels: [{ image, meta, color }] }.
 */
import { deriveMatte, rgbToHsv } from '../../../2_domains/art/deriveMatte.mjs';

const randomPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const meanRGB = (a, b) => [0, 1, 2].map((i) => Math.round((a[i] + b[i]) / 2));

export function createArtAdapter({ imgBasePath, logger = console, collections = {}, artSource, immichSource = null } = {}) {
  // Lazily build the default art source from imgBasePath when one isn't injected
  // (tests inject a fake; production injects the real source — see app.mjs).
  let _artSource = artSource || null;
  const colorCache = new Map();   // candidate id → { avg, color }

  async function getArtSource() {
    if (_artSource) return _artSource;
    const { createArtSource } = await import('./sources/artSource.mjs');
    _artSource = createArtSource({ imgBasePath, logger });
    return _artSource;
  }

  async function sourceFor(def) {
    if (def.source === 'immich') {
      if (!immichSource) { logger.warn?.('art.immich.unavailable'); return null; }
      return immichSource;
    }
    return getArtSource();
  }

  async function analyze(candidate) {
    const hit = colorCache.get(candidate.id);
    if (hit) return hit;
    let result = { avg: null, color: null };
    try {
      const img = await candidate.loadImage();
      img.resize({ w: 32, h: 32 });
      const d = img.bitmap.data;
      let r = 0, g = 0, b = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const avg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
      const [h, s, v] = rgbToHsv(avg);
      result = {
        avg,
        color: {
          average: '#' + avg.map((c) => c.toString(16).padStart(2, '0')).join(''),
          hue: Math.round(h * 360),
          saturation: Math.round(s * 1000) / 1000,
          value: Math.round(v * 1000) / 1000,
        },
      };
    } catch (err) {
      logger.warn?.('art.color.failed', { id: candidate.id, error: err.message });
    }
    colorCache.set(candidate.id, result);
    return result;
  }

  function pickCompanion(primary, portraits, pick) {
    const pool = portraits.filter((p) => p.id !== primary.id);
    if (pool.length === 0) return null;
    const a = primary.meta?.artist;
    const c = primary.meta?.credit;
    const tiers = [
      pool.filter((p) => a && c && p.meta?.artist === a && p.meta?.credit === c),
      pool.filter((p) => a && p.meta?.artist === a),
      pool.filter((p) => c && p.meta?.credit === c),
      pool,
    ];
    for (const tier of tiers) if (tier.length) return pick(tier);
    return null;
  }

  function matteFromAvgs(avgs) {
    const present = avgs.filter(Boolean);
    if (present.length === 0) return null;
    const avg = present.length === 1 ? present[0] : meanRGB(present[0], present[1]);
    return deriveMatte(avg);
  }

  const panelOut = (cand, analysis) => ({ image: cand.image, meta: cand.meta, color: analysis.color });

  async function candidatesFor(collection) {
    const { resolveCollection } = await import('./collections.mjs');
    const { def } = resolveCollection(collections, collection);
    const src = await sourceFor(def);
    let cands = src ? await src.resolveCandidates(def) : [];
    if ((!cands || cands.length === 0)) {
      // Fall back to the full art pool so the screensaver never blanks.
      logger.warn?.('art.collection.empty', { collection });
      const art = await getArtSource();
      cands = await art.resolveCandidates({});
    }
    return cands;
  }

  async function selectFeatured({ collection, pick = randomPick } = {}) {
    const cands = await candidatesFor(collection);
    if (!cands.length) throw new Error('No artwork available');

    const chosen = pick(cands);
    const a1 = await analyze(chosen);

    if (chosen.kind === 'landscape') {
      return { mode: 'single', matte: matteFromAvgs([a1.avg]), panels: [panelOut(chosen, a1)] };
    }
    const portraits = cands.filter((c) => c.kind === 'portrait');
    const companion = pickCompanion(chosen, portraits, pick);
    if (!companion) {
      return { mode: 'single', matte: matteFromAvgs([a1.avg]), panels: [panelOut(chosen, a1)] };
    }
    const a2 = await analyze(companion);
    return {
      mode: 'diptych',
      matte: matteFromAvgs([a1.avg, a2.avg]),
      panels: [panelOut(chosen, a1), panelOut(companion, a2)],
    };
  }

  return { selectFeatured };
}

export default createArtAdapter;
```

- [ ] **Step 4: Run to confirm PASS** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/ArtAdapter.test.mjs` → green.

- [ ] **Step 5: Commit**
```bash
git add backend/src/1_adapters/content/art/ArtAdapter.mjs tests/unit/art/ArtAdapter.test.mjs
git commit -m "refactor(art): ArtAdapter onto source/candidate pipeline + collection select"
```

---

### Task 4: Router `?collection=`, config load, starter `art.yml`

**Files:**
- Modify: `backend/src/4_api/v1/routers/art.mjs`
- Modify: `backend/src/app.mjs`
- Create (data volume): `data/household/config/art.yml`
- Test: `tests/unit/art/artRouter.test.mjs`

- [ ] **Step 1: Read the current router** to find the `/featured` handler and the `selectFeatured` call:

Run: `sed -n '1,60p' backend/src/4_api/v1/routers/art.mjs`

- [ ] **Step 2: Write the failing test** — create `tests/unit/art/artRouter.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest';
import { createArtRouter } from '../../../backend/src/4_api/v1/routers/art.mjs';

// Minimal express-like harness: capture the GET /featured handler and invoke it.
function mountFeatured(router) {
  // express routers expose a stack; find the /featured GET layer.
  const layer = router.stack.find((l) => l.route?.path === '/featured' && l.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const res = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

describe('art router /featured', () => {
  it('passes ?collection= to selectFeatured', async () => {
    const selectFeatured = vi.fn(async () => ({ mode: 'single', matte: {}, panels: [] }));
    const router = createArtRouter({ artAdapter: { selectFeatured }, logger: { debug() {}, warn() {} } });
    const handler = mountFeatured(router);
    await handler({ query: { collection: 'baroque' } }, res(), () => {});
    expect(selectFeatured).toHaveBeenCalledWith({ collection: 'baroque' });
  });

  it('omits collection when absent', async () => {
    const selectFeatured = vi.fn(async () => ({ mode: 'single', matte: {}, panels: [] }));
    const router = createArtRouter({ artAdapter: { selectFeatured }, logger: { debug() {}, warn() {} } });
    const handler = mountFeatured(router);
    await handler({ query: {} }, res(), () => {});
    expect(selectFeatured).toHaveBeenCalledWith({ collection: undefined });
  });
});
```

- [ ] **Step 3: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artRouter.test.mjs`. If the test cannot find the handler because the router shape differs, adjust `mountFeatured` to match the real router (read it in Step 1) — but keep the two behavioral assertions.

- [ ] **Step 4: Modify the `/featured` handler** in `backend/src/4_api/v1/routers/art.mjs` to read the query param and pass it through. The call becomes:

```js
const result = await artAdapter.selectFeatured({ collection: req.query.collection });
```

(Keep the existing try/catch, logging, and response shape. Only the `selectFeatured()` call gains the `{ collection }` argument.)

- [ ] **Step 5: Run to confirm PASS** — same command → green.

- [ ] **Step 6: Wire config + collections in `app.mjs`.** At the `createArtAdapter` call (around line 1214), load `art.yml` collections and pass them in:

```js
  // Art collections (data/household/config/art.yml → households[hid].apps.art)
  const artConfig = configService.getHouseholdAppConfig(null, 'art') || {};
  v1Routers.art = createArtRouter({
    artAdapter: createArtAdapter({
      imgBasePath,
      collections: artConfig.collections || {},
      logger: rootLogger.child({ module: 'art-adapter' })
    }),
    logger: rootLogger.child({ module: 'art-api' })
  });
```

(`configService.getHouseholdAppConfig(null, 'art')` reads `art.yml` from the household config dir — the same accessor used for `ambient.yml`. See `reference_household_config_accessor`.)

- [ ] **Step 7: Create the starter config** in the container data volume (heredoc inside `sh -c`, NOT sed):

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/art.yml << 'YAML'
# ArtMode collections — named, source-aware image pools.
collections:
  all: {}                                       # whole classic pool (default)
  renaissance:   { dateMin: 1400, dateMax: 1600 }
  baroque:       { dateMin: 1600, dateMax: 1750 }
  rococo:        { dateMin: 1700, dateMax: 1780 }
  romantic:      { dateMin: 1780, dateMax: 1850 }
  realism:       { dateMin: 1840, dateMax: 1880 }
  impressionism: { dateMin: 1860, dateMax: 1900 }
  modern:        { dateMin: 1880, dateMax: 1945 }
YAML"
sudo docker exec daylight-station node -e "const y=require('js-yaml');console.log(Object.keys(y.load(require('fs').readFileSync('data/household/config/art.yml','utf8')).collections))"
```
Expected: prints the collection keys (validates the YAML parses).

- [ ] **Step 8: Commit** (code only — `art.yml` lives in the data volume, not the repo):
```bash
git add backend/src/4_api/v1/routers/art.mjs backend/src/app.mjs tests/unit/art/artRouter.test.mjs
git commit -m "feat(art): /featured?collection= + load art.yml collections"
```

---

## Phase B — Immich source

### Task 5: `immichSource.mjs` — normalized Immich candidates

**Files:**
- Create: `backend/src/1_adapters/content/art/sources/immichSource.mjs`
- Test: `tests/unit/art/immichSource.test.mjs`

The Immich source resolves an album/person/search selector into the same normalized
candidate shape. It depends on an injected `client` (the existing `ImmichClient`) and a
`fetchImageBytes(assetId) → Promise<Buffer>` (preview JPEG bytes for matte). Image
dimensions come from `exifInfo.exifImageWidth/Height` (fallback `asset.width/height`);
videos are dropped; assets missing dimensions are dropped.

- [ ] **Step 1: Write the failing test** — create `tests/unit/art/immichSource.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest';
import { createImmichSource } from '../../../backend/src/1_adapters/content/art/sources/immichSource.mjs';

const asset = (over = {}) => ({
  id: over.id || 'a1',
  type: over.type || 'IMAGE',
  exifInfo: { exifImageWidth: 1600, exifImageHeight: 1000, dateTimeOriginal: '2019-08-15T10:00:00Z', city: 'Lisbon', country: 'Portugal', ...(over.exifInfo || {}) },
  people: over.people || [],
  ...over,
});

const makeClient = () => ({
  getAlbums: vi.fn(async () => [{ id: 'alb1', albumName: 'Family Favorites' }]),
  getAlbum: vi.fn(async (id) => ({ id, assets: [asset({ id: 'a1' }), asset({ id: 'v1', type: 'VIDEO' })] })),
  getPeople: vi.fn(async () => [{ id: 'per1', name: 'Felix' }]),
  getPersonAssets: vi.fn(async () => [asset({ id: 'a2' })]),
  smartSearch: vi.fn(async () => [asset({ id: 'a3' })]),
});

const proxyPath = '/api/v1/proxy/immich';

describe('createImmichSource.resolveCandidates', () => {
  it('album by name → IMAGE candidates only, normalized', async () => {
    const client = makeClient();
    const fetchImageBytes = vi.fn(async () => Buffer.from('x'));
    const src = createImmichSource({ client, fetchImageBytes, proxyPath });
    const c = await src.resolveCandidates({ source: 'immich', album: 'Family Favorites' });
    expect(c).toHaveLength(1);                       // VIDEO dropped
    expect(c[0].id).toBe('immich:a1');
    expect(c[0].width).toBe(1600);
    expect(c[0].height).toBe(1000);
    expect(c[0].kind).toBe('landscape');
    expect(c[0].image).toBe('/api/v1/proxy/immich/assets/a1/thumbnail?size=preview');
    expect(c[0].meta.title).toBe('Lisbon');         // city
    expect(c[0].meta.artist).toContain('2019');     // formatted date
  });

  it('person selector resolves a name to id and fetches assets', async () => {
    const client = makeClient();
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath });
    const c = await src.resolveCandidates({ source: 'immich', person: 'Felix' });
    expect(client.getPersonAssets).toHaveBeenCalledWith('per1');
    expect(c[0].id).toBe('immich:a2');
  });

  it('search selector uses smartSearch', async () => {
    const client = makeClient();
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath });
    const c = await src.resolveCandidates({ source: 'immich', search: 'sunset' });
    expect(client.smartSearch).toHaveBeenCalledWith('sunset');
    expect(c[0].id).toBe('immich:a3');
  });

  it('drops assets without dimensions', async () => {
    const client = makeClient();
    client.getAlbum = vi.fn(async () => ({ assets: [{ id: 'nodim', type: 'IMAGE', exifInfo: {} }] }));
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath });
    const c = await src.resolveCandidates({ source: 'immich', album: 'alb1' });
    expect(c).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/immichSource.test.mjs`.

- [ ] **Step 3: Create `backend/src/1_adapters/content/art/sources/immichSource.mjs`:**

```js
// immichSource.mjs — resolves an `immich` collection def into normalized candidates.
// Selectors: album (name|id), person (name|id), search (smart). IMAGE assets only.
// Dimensions from exifInfo (fallback asset.width/height); matte from preview bytes.
import { Jimp } from 'jimp';

const MAX_RATIO = 16 / 9;
const MIN_RATIO = 4 / 3;

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export function createImmichSource({ client, fetchImageBytes, proxyPath, logger = console }) {
  async function resolveAssets(def) {
    if (def.album) {
      let albumId = def.album;
      // resolve a name → id
      const albums = await client.getAlbums();
      const match = (albums || []).find((a) => a.id === def.album || a.albumName === def.album);
      if (match) albumId = match.id;
      const album = await client.getAlbum(albumId);
      return album?.assets || [];
    }
    if (def.person) {
      let personId = def.person;
      const people = await client.getPeople({ withStatistics: false });
      const match = (people || []).find((p) => p.id === def.person || p.name === def.person);
      if (match) personId = match.id;
      return (await client.getPersonAssets(personId)) || [];
    }
    if (def.search) {
      return (await client.smartSearch(def.search)) || [];
    }
    logger.warn?.('art.immich.no-selector', { def });
    return [];
  }

  function toCandidate(asset) {
    if (asset.type === 'VIDEO') return null;
    const ex = asset.exifInfo || {};
    const width = ex.exifImageWidth || asset.width || null;
    const height = ex.exifImageHeight || asset.height || null;
    if (!width || !height) return null;
    const ratio = width / height;
    if (ratio > MAX_RATIO) return null;                 // panoramic excluded
    const kind = ratio >= MIN_RATIO ? 'landscape' : 'portrait';
    const date = ex.dateTimeOriginal || asset.localDateTime || asset.fileCreatedAt || null;
    const people = (asset.people || []).map((p) => p.name).filter(Boolean);
    const place = ex.city || ex.country || null;
    const formattedDate = fmtDate(date);
    const subtitle = [formattedDate, people.join(', ') || null].filter(Boolean).join(' · ') || null;
    return {
      id: `immich:${asset.id}`,
      image: `${proxyPath}/assets/${asset.id}/thumbnail?size=preview`,
      width, height, kind,
      meta: { title: place, artist: subtitle, date: formattedDate },
      loadImage: async () => Jimp.read(await fetchImageBytes(asset.id)),
    };
  }

  async function resolveCandidates(def = {}) {
    let assets;
    try {
      assets = await resolveAssets(def);
    } catch (err) {
      logger.warn?.('art.immich.resolve-failed', { error: err.message });
      return [];
    }
    const out = [];
    for (const a of assets) {
      const c = toCandidate(a);
      if (c) out.push(c);
    }
    logger.info?.('art.immich.resolved', { count: out.length });
    return out;
  }

  return { resolveCandidates };
}

export default createImmichSource;
```

- [ ] **Step 4: Run to confirm PASS** — same command → green.

- [ ] **Step 5: Commit**
```bash
git add backend/src/1_adapters/content/art/sources/immichSource.mjs tests/unit/art/immichSource.test.mjs
git commit -m "feat(art): immich source resolver (album/person/search → candidates)"
```

---

### Task 6: Wire the Immich source into `ArtAdapter` + `app.mjs`

**Files:**
- Modify: `backend/src/app.mjs`
- Test: extend `tests/unit/art/ArtAdapter.test.mjs`

`ArtAdapter` already routes `def.source === 'immich'` to an injected `immichSource` (Task 3). This task adds the integration test and the production wiring.

- [ ] **Step 1: Add the failing test** to `tests/unit/art/ArtAdapter.test.mjs` (new `it` in the existing describe):

```js
  it('immich-sourced collection uses the immich source', async () => {
    const immichSource = {
      resolveCandidates: async () => [{
        id: 'immich:x', kind: 'landscape', image: '/p/x?size=preview',
        width: 1600, height: 1000, meta: { title: 'Lisbon', artist: 'August 2019' },
        loadImage: async () => new Jimp({ width: 4, height: 4, color: 0x112233ff }),
      }],
    };
    const adapter = createArtAdapter({
      collections: { all: {}, fam: { source: 'immich', album: 'Family' } },
      artSource: { resolveCandidates: async () => [] },     // art empty
      immichSource,
    });
    const r = await adapter.selectFeatured({ collection: 'fam', pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(r.panels[0].image).toBe('/p/x?size=preview');
    expect(r.panels[0].meta.title).toBe('Lisbon');
  });
```

- [ ] **Step 2: Run to confirm it PASSES already** (the Task 3 adapter already supports this) — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/ArtAdapter.test.mjs`. If it fails, fix `ArtAdapter.sourceFor`/`candidatesFor` so an `immich` def routes to `immichSource` and only falls back to art when immich returns empty.

- [ ] **Step 3: Wire production Immich into `app.mjs`.** Where `immichConfig` is defined (around line 442: `{ host, apiKey }`), build an `ImmichClient` + a preview-bytes fetcher and pass an `immichSource` into `createArtAdapter`. Replace the art-router block from Task 4 with:

```js
  // Art collections + optional Immich source for ArtMode.
  const artConfig = configService.getHouseholdAppConfig(null, 'art') || {};
  let artImmichSource = null;
  if (immichConfig) {
    const { ImmichClient } = await import('#adapters/content/gallery/immich/ImmichClient.mjs');
    const { createImmichSource } = await import('./1_adapters/content/art/sources/immichSource.mjs');
    const artImmichClient = new ImmichClient(immichConfig, { httpClient: axios });
    const fetchImageBytes = async (assetId) => {
      const r = await axios.get(
        `${immichConfig.host.replace(/\/$/, '')}/api/assets/${assetId}/thumbnail?size=preview`,
        { headers: { 'x-api-key': immichConfig.apiKey }, responseType: 'arraybuffer' }
      );
      return Buffer.from(r.data);
    };
    artImmichSource = createImmichSource({
      client: artImmichClient,
      fetchImageBytes,
      proxyPath: '/api/v1/proxy/immich',
      logger: rootLogger.child({ module: 'art-immich' }),
    });
  }
  v1Routers.art = createArtRouter({
    artAdapter: createArtAdapter({
      imgBasePath,
      collections: artConfig.collections || {},
      immichSource: artImmichSource,
      logger: rootLogger.child({ module: 'art-adapter' })
    }),
    logger: rootLogger.child({ module: 'art-api' })
  });
```

Verify `axios` is already imported in `app.mjs` (search for `import axios`); the weekly-review Immich wiring at ~line 2367 uses `axios` as the httpClient, so it is available. Confirm the Immich proxy base path by checking how the gallery ImmichAdapter's `proxyPath` is configured (search `proxyPath` in app.mjs / the gallery manifest) and use that exact value instead of the literal if it differs.

- [ ] **Step 4: Run the adapter tests** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/ArtAdapter.test.mjs` → green.

- [ ] **Step 5: Commit**
```bash
git add backend/src/app.mjs tests/unit/art/ArtAdapter.test.mjs
git commit -m "feat(art): wire Immich source into ArtAdapter (album/person/search collections)"
```

---

### Task 7: Full-suite verification + live smoke

**Files:** none (verification only)

- [ ] **Step 1: Run all art unit specs together**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/unit/art/collections.test.mjs \
  tests/unit/art/artSource.test.mjs \
  tests/unit/art/immichSource.test.mjs \
  tests/unit/art/ArtAdapter.test.mjs \
  tests/unit/art/artRouter.test.mjs \
  tests/unit/art/deriveMatte.test.mjs
```
Expected: all green.

- [ ] **Step 2: Live smoke (after deploy)** — confirm collection selection over HTTP:
```bash
curl -s "http://localhost:3111/api/v1/art/featured" | python3 -c "import sys,json;d=json.load(sys.stdin);print('default:', d['mode'], d['panels'][0]['meta'].get('title'))"
curl -s "http://localhost:3111/api/v1/art/featured?collection=baroque" | python3 -c "import sys,json;d=json.load(sys.stdin);print('baroque:', d['mode'], d['panels'][0]['meta'].get('title'), d['panels'][0]['meta'].get('date'))"
curl -s "http://localhost:3111/api/v1/art/featured?collection=nope" | python3 -c "import sys,json;d=json.load(sys.stdin);print('fallback ok:', d['mode'])"
```
Expected: default + baroque return works (baroque dates within 1600–1750); unknown falls back without error. (An Immich collection can be smoke-tested once one is added to `art.yml`.)

(Deploy is the operator's call; this plan ends at green tests + the smoke commands above.)

---

## Notes for the implementer

- Run art specs with `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`. Confirm it works first against the existing `tests/unit/art/deriveMatte.test.mjs`.
- The `all` collection must reproduce today's behavior — the art source scanning `art/classic` with an empty predicate is exactly the old pool.
- Jimp v1 API: `new Jimp({ width, height, color })`, `Jimp.read(pathOrBuffer)`, `img.resize({ w, h })`, `img.bitmap.data` (RGBA). Matches the pre-refactor ArtAdapter.
- Do NOT change `deriveMatte.mjs` or the frontend — sub-project 1 is backend-only; the frontend already renders whatever `meta.title`/`meta.artist` it receives.
- `art.yml` lives in the container data volume (not git); create it via `sudo docker exec daylight-station sh -c "cat > ... << 'YAML' ... YAML"` (heredoc, never `sed`).
