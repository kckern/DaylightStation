# Art Admin Library (keyboard-first curation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `/admin/content/art` Library: a keyboard-first tool to cycle the classic art library and tag / flag / hide / re-anchor / edit each work, with edits feeding back into what ArtMode shows.

**Architecture:** Per-work `metadata.yaml` gains hand-curation fields (`tags`, `exclude`, `hidden`, `flagged`); a pure `isMember()` merge layers them over the existing date/category rules so collection membership = rule ∪ tags − exclusions − hidden/flagged. A new `/api/v1/admin/art` router lists works and PATCHes metadata. A React Library (loupe + grid) drives everything from the keyboard with auto-save.

**Tech Stack:** Node/Express 5 (backend, ESM `.mjs`), js-yaml, Jimp; React + Mantine + react-router (frontend); **vitest** for all new tests (+ supertest for the router); the structured logging framework.

**Design spec:** `docs/superpowers/specs/2026-06-22-art-admin-library-design.md`

**Conventions discovered (use these exactly):**
- Run a backend/pure vitest file: `./node_modules/.bin/vitest run --config vitest.config.mjs <path>`
- Run a frontend vitest file: same command (the config wires the frontend env + jsdom).
- New backend logic tests live under `tests/unit/art/` (that dir is vitest; mirrors `tests/unit/art/collections.test.mjs`). API router tests live under `tests/isolated/api/` (vitest + supertest; mirrors `tests/isolated/api/device-route-mounted.test.mjs`). **Do not** put vitest specs under `tests/unit/adapters/art/` — that dir is jest.
- Frontend tests are co-located `*.test.js[x]`, `import { describe, it, expect, vi } from 'vitest'`.
- API calls from the frontend use `DaylightAPI(path, body, method)` from `frontend/src/lib/api.mjs` (supports `'PATCH'`).
- Logging: `getLogger().child({ component })`; never raw `console.*`.

---

## File Structure

**Backend — create:**
- `backend/src/1_adapters/content/art/workMetadata.mjs` — pure helpers: `isValidAnchor`, `mergeWorkMetadata`, `filterWorks`.
- `backend/src/4_api/v1/routers/admin/art.mjs` — `createAdminArtRouter` (GET `/works`, PATCH `/works/*`).

**Backend — modify:**
- `backend/src/1_adapters/content/art/collections.mjs` — add + export `isMember`.
- `backend/src/1_adapters/content/art/sources/artSource.mjs` — read new meta fields; apply `isMember` in `resolveCandidates(def, key)`; add `listWorks({ folder })`.
- `backend/src/1_adapters/content/art/ArtAdapter.mjs` — thread the collection `key` into `resolveCandidates`.
- `backend/src/4_api/v1/routers/admin/index.mjs` — mount the art router.

**Frontend — create (`frontend/src/modules/Admin/Art/`):**
- `keymap.js` — pure key→action mapping (`keyToAction`, `anchorForNumpad`).
- `useArtCuration.js` — data + mutation hook (load list, optimistic PATCH, undo stack, auto-advance).
- `Loupe.jsx` — single focused-work view (preview + anchor compass overlay + metadata panel).
- `GridView.jsx` — thumbnail grid with a cursor.
- `ArtLibrary.jsx` — page: filters, keyboard handling, loupe⇄grid toggle.
- `index.js` — exports.
- `Art.scss` — styles.

**Frontend — modify:**
- `frontend/src/modules/Admin/AdminNav.jsx` — add the **Art** nav item.
- `frontend/src/Apps/AdminApp.jsx` — import + route `content/art`.

**Config (live data volume, not the repo):**
- `data/household/config/art.yml` — add optional `quickTags:` list (read by the frontend through the existing config API).

---

## Phase A — Backend membership model (pure logic)

### Task 1: `isMember` hybrid membership merge

**Files:**
- Modify: `backend/src/1_adapters/content/art/collections.mjs`
- Test: `tests/unit/art/membership.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/membership.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { isMember } from '../../../backend/src/1_adapters/content/art/collections.mjs';

// entry shape the predicate sees: { folder, meta }
const entry = (meta) => ({ folder: 'W', meta });

describe('isMember (hybrid membership)', () => {
  const impressionism = { dateMin: 1860, dateMax: 1900 };

  it('includes a work that matches the date rule', () => {
    expect(isMember('impressionism', impressionism, entry({ date: '1875' }))).toBe(true);
  });

  it('excludes a work outside the date rule', () => {
    expect(isMember('impressionism', impressionism, entry({ date: '1500' }))).toBe(false);
  });

  it('includes a rule-miss that is hand-tagged with the collection name', () => {
    expect(isMember('impressionism', impressionism,
      entry({ date: '1500', tags: ['impressionism'] }))).toBe(true);
  });

  it('hidden works are never members, even if tagged', () => {
    expect(isMember('impressionism', impressionism,
      entry({ date: '1875', hidden: true }))).toBe(false);
    expect(isMember('impressionism', impressionism,
      entry({ date: '1500', tags: ['impressionism'], hidden: true }))).toBe(false);
  });

  it('flagged works are never members', () => {
    expect(isMember('impressionism', impressionism, entry({ date: '1875', flagged: true }))).toBe(false);
  });

  it('exclude pulls a rule-matched work out of that one collection', () => {
    expect(isMember('impressionism', impressionism,
      entry({ date: '1875', exclude: ['impressionism'] }))).toBe(false);
    // still a member of a different collection it matches
    expect(isMember('realism', { dateMin: 1840, dateMax: 1880 },
      entry({ date: '1875', exclude: ['impressionism'] }))).toBe(true);
  });

  it('exclude beats a hand-tag for the same collection', () => {
    expect(isMember('impressionism', impressionism,
      entry({ date: '1500', tags: ['impressionism'], exclude: ['impressionism'] }))).toBe(false);
  });

  it('the catch-all key still drops hidden/flagged', () => {
    expect(isMember('all', {}, entry({ date: '1875' }))).toBe(true);
    expect(isMember('all', {}, entry({ date: '1875', hidden: true }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/membership.test.mjs`
Expected: FAIL — `isMember is not a function` (not exported yet).

- [ ] **Step 3: Implement `isMember`**

In `backend/src/1_adapters/content/art/collections.mjs`, after `buildArtPredicate` and before `resolveCollection`, add:

```javascript
// Hybrid membership (ArtMode "Model C"): a work belongs to collection `key` if the
// rule matches OR it's hand-tagged with the collection name — but hidden/flagged
// works are never shown, and an explicit `exclude` (or hide/flag) overrides a match.
// Pure; the single source of truth for "is this work in this collection?".
export function isMember(key, def = {}, entry) {
  const meta = entry?.meta || {};
  if (meta.hidden === true) return false;
  if (meta.flagged === true) return false;
  if (Array.isArray(meta.exclude) && meta.exclude.includes(key)) return false;
  if (Array.isArray(meta.tags) && meta.tags.includes(key)) return true;
  return buildArtPredicate(def)(entry);
}
```

Then add `isMember` to the default export object at the bottom:

```javascript
export default { parseYear, buildArtPredicate, isMember, resolveCollection };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/membership.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/art/collections.mjs tests/unit/art/membership.test.mjs
git commit -m "feat(art): hybrid isMember merge (rules + tags - exclusions/hidden/flagged)"
```

---

### Task 2: Surface curation fields in artSource + apply membership + `listWorks`

**Files:**
- Modify: `backend/src/1_adapters/content/art/sources/artSource.mjs`
- Test: `tests/unit/art/artSource.membership.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/artSource.membership.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Jimp } from 'jimp';
import { createArtSource } from '../../../backend/src/1_adapters/content/art/sources/artSource.mjs';

const noop = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} };
let tmp, imgBasePath;

// Landscape work (16x12 → ratio 1.33, not panoramic) so it survives the scan.
async function writeWork(folder, metaLines) {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  await new Jimp({ width: 16, height: 12, color: 0x808080ff }).write(path.join(dir, 'art.png'));
  fs.writeFileSync(path.join(dir, 'metadata.yaml'),
    `title: ${folder}\nwidth: 16\nheight: 12\n${metaLines}`);
}

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artsrc-')); imgBasePath = path.join(tmp, 'img'); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('artSource membership + listWorks', () => {
  it('resolveCandidates(def, key) drops hidden works', async () => {
    await writeWork('visible', "date: '1875'\n");
    await writeWork('gone', "date: '1875'\nhidden: true\n");
    const src = createArtSource({ imgBasePath, logger: noop });
    const cands = await src.resolveCandidates({ dateMin: 1860, dateMax: 1900 }, 'impressionism');
    expect(cands.map((c) => c.id).sort()).toEqual(['visible']);
  });

  it('resolveCandidates includes a rule-miss tagged with the collection name', async () => {
    await writeWork('odd', "date: '1500'\ntags:\n  - impressionism\n");
    const src = createArtSource({ imgBasePath, logger: noop });
    const cands = await src.resolveCandidates({ dateMin: 1860, dateMax: 1900 }, 'impressionism');
    expect(cands.map((c) => c.id)).toContain('odd');
    expect(cands[0].meta.tags).toEqual(['impressionism']);
  });

  it('listWorks returns ALL works incl. hidden/flagged with curation fields', async () => {
    await writeWork('a', "date: '1875'\n");
    await writeWork('b', "date: '1875'\nhidden: true\nflagged: true\ntags:\n  - baroque\ncrop_anchor: top\n");
    const src = createArtSource({ imgBasePath, logger: noop });
    const works = await src.listWorks();
    const byId = Object.fromEntries(works.map((w) => [w.id, w]));
    expect(Object.keys(byId).sort()).toEqual(['a', 'b']);
    expect(byId.b.meta).toMatchObject({ hidden: true, flagged: true, tags: ['baroque'], crop_anchor: 'top' });
    expect(byId.a.meta).toMatchObject({ hidden: false, flagged: false, tags: [], exclude: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artSource.membership.test.mjs`
Expected: FAIL — `listWorks is not a function` / hidden work still present.

- [ ] **Step 3: Implement the changes**

In `artSource.mjs`:

**(a)** Add the import of `isMember` (line 8 currently imports `buildArtPredicate`):

```javascript
import { buildArtPredicate, isMember } from '../collections.mjs';
```

**(b)** In `readMeta`, extend the returned object with the curation fields (normalize arrays/bools):

```javascript
      const p = yaml.load(raw) || {};
      const arr = (v) => (Array.isArray(v) ? v : (v == null ? [] : [v]));
      return {
        title: p.title ?? null, artist: p.artist ?? null,
        date: p.date != null ? String(p.date) : null,
        origin: p.origin ?? null, medium: p.medium ?? null,
        department: p.department ?? null, credit: p.credit ?? null,
        category: p.category ?? null, display: p.display ?? null,
        crop_anchor: p.crop_anchor ?? null,
        // Hand-curation (ArtMode admin). tags/exclude are collection-name lists.
        tags: arr(p.tags), exclude: arr(p.exclude),
        hidden: p.hidden === true, flagged: p.flagged === true,
        width: toInt(p.width), height: toInt(p.height),
      };
```

**(c)** Add a shared meta projection helper near the top of `createArtSource` (after `scanCache`):

```javascript
  // Project a scanned entry's meta for output (screensaver + admin share this).
  const projectMeta = (meta) => ({
    title: meta.title, artist: meta.artist, date: meta.date,
    origin: meta.origin, medium: meta.medium,
    department: meta.department, credit: meta.credit,
    category: meta.category ?? null, display: meta.display ?? null,
    section: meta.section ?? null, crop_anchor: meta.crop_anchor ?? null,
    tags: meta.tags ?? [], exclude: meta.exclude ?? [],
    hidden: meta.hidden === true, flagged: meta.flagged === true,
    width: meta.width, height: meta.height,
  });
```

**(d)** Replace the body of `resolveCandidates` to take a `key` and use `isMember` + `projectMeta`:

```javascript
  async function resolveCandidates(def = {}, key = 'all') {
    const scope = def.folder ? `art/${def.folder}` : 'art/classic';
    const scopeDir = path.join(imgBasePath, scope);

    const scanned = await scanScope(scope, scopeDir);
    const out = [];
    for (const e of scanned) {
      if (!isMember(key, def, { folder: e.folder, meta: e.meta })) continue;
      out.push({
        id: e.folder, image: e.image,
        width: e.meta.width, height: e.meta.height, kind: e.kind,
        meta: projectMeta(e.meta),
        loadImage: () => Jimp.read(e.localPath),
      });
    }
    logger.info?.('art.source.resolved', { scope, key, count: out.length });
    return out;
  }
```

**(e)** Add `listWorks` (no membership/predicate — admin sees everything) and export it:

```javascript
  // Admin listing: every work in a scope with full curation meta, regardless of
  // rules/hidden/flagged. No loadImage (admin needs only id/image/meta).
  async function listWorks({ folder } = {}) {
    const scope = folder ? `art/${folder}` : 'art/classic';
    const scanned = await scanScope(scope, path.join(imgBasePath, scope));
    return scanned.map((e) => ({ id: e.folder, image: e.image, meta: projectMeta(e.meta) }));
  }

  return { resolveCandidates, listWorks };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artSource.membership.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/art/sources/artSource.mjs tests/unit/art/artSource.membership.test.mjs
git commit -m "feat(art): artSource reads curation fields, applies isMember, adds listWorks"
```

---

### Task 3: Thread the collection key through ArtAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/art/ArtAdapter.mjs` (function `candidatesFor`, ~lines 114-133)
- Test: `tests/unit/art/artAdapter.membership.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/artAdapter.membership.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Jimp } from 'jimp';
import { createArtAdapter } from '../../../backend/src/1_adapters/content/art/ArtAdapter.mjs';

const noop = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} };
let tmp, imgBasePath;

async function writeWork(folder, metaLines) {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  await new Jimp({ width: 16, height: 12, color: 0x808080ff }).write(path.join(dir, 'art.png'));
  fs.writeFileSync(path.join(dir, 'metadata.yaml'), `title: ${folder}\nwidth: 16\nheight: 12\n${metaLines}`);
}

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artad-')); imgBasePath = path.join(tmp, 'img'); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('ArtAdapter honors curation', () => {
  it('never selects a hidden work', async () => {
    await writeWork('shown', "date: '1875'\n");
    await writeWork('hidden', "date: '1875'\nhidden: true\n");
    const adapter = createArtAdapter({ imgBasePath, collections: { all: {} }, logger: noop });
    // pick first → with 'hidden' filtered out, only 'shown' remains
    const featured = await adapter.selectFeatured({ collection: 'all', pick: (arr) => arr[0] });
    expect(featured.panels[0].meta.title).toBe('shown');
  });

  it('selects a rule-miss that was tagged into the collection', async () => {
    await writeWork('odd', "date: '1500'\ntags:\n  - impressionism\n");
    const adapter = createArtAdapter({
      imgBasePath, collections: { impressionism: { dateMin: 1860, dateMax: 1900 } }, logger: noop,
    });
    const featured = await adapter.selectFeatured({ collection: 'impressionism', pick: (arr) => arr[0] });
    expect(featured.panels[0].meta.title).toBe('odd');
  });
});
```

> Note: `createArtAdapter` is constructed with `{ imgBasePath, collections, logger }`. If the real signature differs, read the top of `ArtAdapter.mjs` and match it — keep the test's intent (hidden filtered, tag included).

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artAdapter.membership.test.mjs`
Expected: FAIL — hidden work can be selected / tagged rule-miss not found (key not threaded).

- [ ] **Step 3: Implement the change**

In `ArtAdapter.mjs`, function `candidatesFor`, destructure `key` and pass it through both `resolveCandidates` calls:

```javascript
  async function candidatesFor(collection) {
    const { resolveCollection } = await import('./collections.mjs');
    const { key, def } = resolveCollection(collections, collection);
    const src = await sourceFor(def);
    if (!src) logger.warn?.('art.source.unavailable', { collection, source: def.source });
    let cands = src ? await src.resolveCandidates(def, key) : [];
    if (!cands || cands.length === 0) {
      const narrowing = def.source === 'immich' || Object.keys(def).length > 0;
      if (narrowing) {
        logger.warn?.('art.collection.empty', { collection, source: def.source ?? 'art' });
        const art = await getArtSource();
        cands = await art.resolveCandidates({}, 'all');
      }
    }
    return cands;
  }
```

- [ ] **Step 4: Run tests to verify they pass (and nothing regressed)**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artAdapter.membership.test.mjs`
Expected: PASS (2 tests).

Run the existing jest art suites to confirm no regression:
`npx jest tests/unit/adapters/art/ArtAdapter.test.mjs`
Expected: PASS (unchanged behavior — panel.meta now carries extra keys, which assertions ignore).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/art/ArtAdapter.mjs tests/unit/art/artAdapter.membership.test.mjs
git commit -m "feat(art): thread collection key so hidden/tags/exclude affect ArtMode output"
```

---

## Phase B — Backend admin API

### Task 4: Pure metadata helpers (`workMetadata.mjs`)

**Files:**
- Create: `backend/src/1_adapters/content/art/workMetadata.mjs`
- Test: `tests/unit/art/workMetadata.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/workMetadata.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { isValidAnchor, mergeWorkMetadata, filterWorks }
  from '../../../backend/src/1_adapters/content/art/workMetadata.mjs';

describe('isValidAnchor', () => {
  it('accepts keyword anchors (1-2 tokens) and percents', () => {
    ['top', 'center', 'bottom right', 'top left', '50% 20%'].forEach((a) =>
      expect(isValidAnchor(a)).toBe(true));
  });
  it('rejects junk and >2 tokens', () => {
    ['sideways', 'top top top', 'banana'].forEach((a) => expect(isValidAnchor(a)).toBe(false));
  });
  it('treats null as valid (a clear)', () => { expect(isValidAnchor(null)).toBe(true); });
});

describe('mergeWorkMetadata', () => {
  const base = "title: Lilies\nartist: Monet\nwidth: 1600\nheight: 1000\n";

  it('merges a patch and preserves untouched fields', () => {
    const out = yaml.load(mergeWorkMetadata(base, { tags: ['impressionism'], crop_anchor: 'top' }));
    expect(out).toMatchObject({ title: 'Lilies', artist: 'Monet', width: 1600, tags: ['impressionism'], crop_anchor: 'top' });
  });

  it('null clears a field', () => {
    const withAnchor = "title: X\nwidth: 1\nheight: 1\ncrop_anchor: top\n";
    const out = yaml.load(mergeWorkMetadata(withAnchor, { crop_anchor: null }));
    expect('crop_anchor' in out).toBe(false);
  });

  it('throws on an invalid anchor', () => {
    expect(() => mergeWorkMetadata(base, { crop_anchor: 'banana' })).toThrow(/anchor/i);
  });
});

describe('filterWorks', () => {
  const works = [
    { id: 'a', meta: { title: 'Sunrise', artist: 'Monet', tags: ['impressionism'], hidden: false, flagged: false } },
    { id: 'b', meta: { title: 'Night', artist: 'Goya', tags: [], hidden: true, flagged: false } },
    { id: 'c', meta: { title: 'Flag Study', artist: 'X', tags: [], hidden: false, flagged: true } },
  ];
  it('filters by tag', () => { expect(filterWorks(works, { tag: 'impressionism' }).map((w) => w.id)).toEqual(['a']); });
  it('filters by hidden flag', () => { expect(filterWorks(works, { hidden: true }).map((w) => w.id)).toEqual(['b']); });
  it('filters by flagged', () => { expect(filterWorks(works, { flagged: true }).map((w) => w.id)).toEqual(['c']); });
  it('searches title/artist case-insensitively', () => {
    expect(filterWorks(works, { q: 'goya' }).map((w) => w.id)).toEqual(['b']);
  });
  it('no filters → everything', () => { expect(filterWorks(works, {}).length).toBe(3); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/workMetadata.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `workMetadata.mjs`**

Create `backend/src/1_adapters/content/art/workMetadata.mjs`:

```javascript
// Pure helpers for the Art admin: validate crop anchors, merge a metadata patch
// into a work's metadata.yaml string, and filter a work list. No IO.
import yaml from 'js-yaml';

// Mirrors the frontend cropFocus vocabulary (artModes.js): up to two of
// top/bottom/left/right/center, or N% tokens. null = "clear the anchor".
const ANCHOR_KEYWORDS = new Set(['top', 'bottom', 'left', 'right', 'center']);
export function isValidAnchor(anchor) {
  if (anchor == null) return true;
  if (typeof anchor !== 'string') return false;
  const tokens = anchor.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 2) return false;
  return tokens.every((t) => ANCHOR_KEYWORDS.has(t) || /^\d{1,3}%$/.test(t));
}

// Fields the admin is allowed to write. Anything else in metadata.yaml is preserved.
const WRITABLE = new Set([
  'title', 'artist', 'date', 'medium', 'category', 'display',
  'crop_anchor', 'tags', 'exclude', 'hidden', 'flagged',
]);

// Read-merge-write: parse the raw YAML, apply the patch (null deletes a key),
// validate, and dump back. Preserves every key the patch doesn't touch.
// (js-yaml does not preserve comments; metadata.yaml files are plain data.)
export function mergeWorkMetadata(raw, patch = {}) {
  const doc = yaml.load(raw) || {};
  if ('crop_anchor' in patch && !isValidAnchor(patch.crop_anchor)) {
    throw new Error(`Invalid crop_anchor: ${patch.crop_anchor}`);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (!WRITABLE.has(k)) continue;
    if (v == null) delete doc[k];
    else doc[k] = v;
  }
  return yaml.dump(doc, { lineWidth: -1 });
}

// In-memory list filtering for GET /works.
export function filterWorks(works, { tag, hidden, flagged, q } = {}) {
  const needle = q ? String(q).toLowerCase() : null;
  return works.filter((w) => {
    const m = w.meta || {};
    if (tag && !(Array.isArray(m.tags) && m.tags.includes(tag))) return false;
    if (hidden === true && m.hidden !== true) return false;
    if (flagged === true && m.flagged !== true) return false;
    if (needle) {
      const hay = `${m.title ?? ''} ${m.artist ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export default { isValidAnchor, mergeWorkMetadata, filterWorks };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/workMetadata.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/art/workMetadata.mjs tests/unit/art/workMetadata.test.mjs
git commit -m "feat(art): pure work-metadata helpers (anchor validate, merge, filter)"
```

---

### Task 5: Admin art router (`GET /works`, `PATCH /works/*`) + mount

**Files:**
- Create: `backend/src/4_api/v1/routers/admin/art.mjs`
- Modify: `backend/src/4_api/v1/routers/admin/index.mjs`
- Test: `tests/isolated/api/admin-art-router.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/api/admin-art-router.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Jimp } from 'jimp';
import { createAdminArtRouter } from '../../../backend/src/4_api/v1/routers/admin/art.mjs';

const noop = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {}, child: () => noop };
let tmp, mediaPath, app;

async function writeWork(folder, metaLines) {
  const dir = path.join(mediaPath, 'img', 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  await new Jimp({ width: 16, height: 12, color: 0x808080ff }).write(path.join(dir, 'art.png'));
  fs.writeFileSync(path.join(dir, 'metadata.yaml'), `title: ${folder}\nwidth: 16\nheight: 12\n${metaLines}`);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adminart-'));
  mediaPath = tmp;
  await writeWork('alpha', "date: '1875'\n");
  await writeWork('beta', "date: '1875'\nhidden: true\n");
  app = express();
  app.use(express.json());
  app.use('/art', createAdminArtRouter({ mediaPath, logger: noop }));
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('admin art router', () => {
  it('GET /works lists all works incl. hidden', async () => {
    const res = await request(app).get('/art/works');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.works.map((w) => w.id).sort()).toEqual(['alpha', 'beta']);
  });

  it('GET /works?hidden=true filters', async () => {
    const res = await request(app).get('/art/works?hidden=true');
    expect(res.body.works.map((w) => w.id)).toEqual(['beta']);
  });

  it('PATCH /works/:id writes metadata.yaml and reflects on next GET', async () => {
    const patch = await request(app).patch('/art/works/alpha').send({ tags: ['impressionism'], crop_anchor: 'top' });
    expect(patch.status).toBe(200);
    expect(patch.body.meta).toMatchObject({ tags: ['impressionism'], crop_anchor: 'top' });
    const res = await request(app).get('/art/works?tag=impressionism');
    expect(res.body.works.map((w) => w.id)).toEqual(['alpha']);
  });

  it('PATCH rejects an invalid anchor', async () => {
    const res = await request(app).patch('/art/works/alpha').send({ crop_anchor: 'banana' });
    expect(res.status).toBe(400);
  });

  it('PATCH rejects path traversal', async () => {
    const res = await request(app).patch('/art/works/..%2f..%2fescape').send({ hidden: true });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/api/admin-art-router.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

Create `backend/src/4_api/v1/routers/admin/art.mjs`:

```javascript
import express from 'express';
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { createArtSource } from '../../../../1_adapters/content/art/sources/artSource.mjs';
import { mergeWorkMetadata, filterWorks } from '../../../../1_adapters/content/art/workMetadata.mjs';

/**
 * Admin Art router — curate the classic file-based art library.
 *   GET  /works         list works (filter: source, tag, hidden, flagged, q, page, pageSize)
 *   PATCH /works/*       merge a metadata patch into one work's metadata.yaml
 *
 * @param {Object} config
 * @param {string} config.mediaPath - base media dir; images live under <mediaPath>/img/art/<scope>/
 * @param {Object} [config.logger=console]
 */
export function createAdminArtRouter({ mediaPath, logger = console }) {
  const router = express.Router();
  const imgBasePath = path.join(mediaPath, 'img');
  const artSource = createArtSource({ imgBasePath, logger });

  const scopeDirFor = (source) => path.join(imgBasePath, source ? `art/${source}` : 'art/classic');

  router.get('/works', async (req, res) => {
    try {
      const { source, tag, hidden, flagged, q } = req.query;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 60));
      const all = await artSource.listWorks({ folder: source && source !== 'classic' ? source : undefined });
      const filtered = filterWorks(all, {
        tag: tag || undefined, q: q || undefined,
        hidden: hidden === 'true', flagged: flagged === 'true',
      });
      const start = (page - 1) * pageSize;
      res.json({ total: filtered.length, page, pageSize, works: filtered.slice(start, start + pageSize) });
    } catch (err) {
      logger.error?.('admin.art.list.failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /works/<folder> — folder may contain slashes (sectioned scopes), so use a wildcard.
  router.patch('/works/*', async (req, res) => {
    const rawId = req.params[0] || '';
    const source = req.body?.source;
    const scopeDir = scopeDirFor(source);
    const workDir = path.resolve(scopeDir, rawId);
    // Traversal guard: the resolved work dir must stay inside the scope.
    if (!workDir.startsWith(path.resolve(scopeDir) + path.sep)) {
      return res.status(400).json({ error: 'Invalid work id' });
    }
    const file = path.join(workDir, 'metadata.yaml');
    try {
      const patch = { ...req.body }; delete patch.source;
      const raw = await fs.readFile(file, 'utf-8');
      const merged = mergeWorkMetadata(raw, patch);   // throws on invalid anchor
      await fs.writeFile(file, merged, 'utf-8');
      logger.info?.('admin.art.patched', { id: rawId, fields: Object.keys(patch) });
      res.json({ ok: true, id: rawId, meta: yaml.load(merged) });
    } catch (err) {
      if (/anchor/i.test(err.message)) return res.status(400).json({ error: err.message });
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Work not found' });
      logger.error?.('admin.art.patch.failed', { id: rawId, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

export default createAdminArtRouter;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/api/admin-art-router.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Mount the router**

In `backend/src/4_api/v1/routers/admin/index.mjs`:

Add the import near the other router imports (after line 10):

```javascript
import { createAdminArtRouter } from './art.mjs';
```

Inside `createAdminRouter`, after the apps router block (after line 80), add:

```javascript
  // Mount art router (ArtMode library curation)
  const artRouter = createAdminArtRouter({
    mediaPath,
    logger: logger.child?.({ submodule: 'art' }) || logger
  });
  router.use('/art', artRouter);
```

Add `/art` to the mounted-subroutes log array (line 108) and re-export at the bottom:

```javascript
export { createAdminArtRouter } from './art.mjs';
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/art.mjs backend/src/4_api/v1/routers/admin/index.mjs tests/isolated/api/admin-art-router.test.mjs
git commit -m "feat(art): admin art router (list works, PATCH metadata) + mount"
```

---

## Phase C — Frontend Library

### Task 6: Keymap (pure key→action mapping)

**Files:**
- Create: `frontend/src/modules/Admin/Art/keymap.js`
- Test: `frontend/src/modules/Admin/Art/keymap.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Admin/Art/keymap.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { anchorForNumpad, keyToAction } from './keymap.js';

describe('anchorForNumpad', () => {
  it('maps the numpad compass to object-position keywords', () => {
    expect(anchorForNumpad('7')).toBe('top left');
    expect(anchorForNumpad('8')).toBe('top');
    expect(anchorForNumpad('5')).toBe('center');
    expect(anchorForNumpad('3')).toBe('bottom right');
    expect(anchorForNumpad('0')).toBe(null);   // clear
  });
  it('returns undefined for non-numpad', () => { expect(anchorForNumpad('q')).toBeUndefined(); });
});

describe('keyToAction', () => {
  const opts = { quickTags: ['impressionism', 'baroque'] };

  it('arrows / J K navigate', () => {
    expect(keyToAction({ key: 'ArrowRight' }, opts)).toEqual({ action: 'next' });
    expect(keyToAction({ key: 'j' }, opts)).toEqual({ action: 'next' });
    expect(keyToAction({ key: 'k' }, opts)).toEqual({ action: 'prev' });
  });

  it('digits toggle the matching quick-tag', () => {
    expect(keyToAction({ key: '1' }, opts)).toEqual({ action: 'toggleTag', tag: 'impressionism' });
    expect(keyToAction({ key: '2' }, opts)).toEqual({ action: 'toggleTag', tag: 'baroque' });
    expect(keyToAction({ key: '3' }, opts)).toBeNull();   // no 3rd quick-tag
  });

  it('X hides, F flags, E edits, T opens palette, A toggles auto-advance, U undoes', () => {
    expect(keyToAction({ key: 'x' }, opts)).toEqual({ action: 'toggleHidden' });
    expect(keyToAction({ key: 'f' }, opts)).toEqual({ action: 'toggleFlagged' });
    expect(keyToAction({ key: 'e' }, opts)).toEqual({ action: 'edit' });
    expect(keyToAction({ key: 't' }, opts)).toEqual({ action: 'palette' });
    expect(keyToAction({ key: 'a' }, opts)).toEqual({ action: 'autoAdvance' });
    expect(keyToAction({ key: 'u' }, opts)).toEqual({ action: 'undo' });
  });

  it('numpad sets the anchor', () => {
    expect(keyToAction({ key: '5', code: 'Numpad5' }, opts)).toEqual({ action: 'anchor', value: 'center' });
  });

  it('Backspace / - removes from the current collection', () => {
    expect(keyToAction({ key: 'Backspace' }, opts)).toEqual({ action: 'removeFromCollection' });
    expect(keyToAction({ key: '-' }, opts)).toEqual({ action: 'removeFromCollection' });
  });

  it('Enter toggles loupe/grid', () => {
    expect(keyToAction({ key: 'Enter' }, opts)).toEqual({ action: 'toggleView' });
  });

  it('in edit mode, only Escape is interpreted (typing passes through)', () => {
    expect(keyToAction({ key: 'x' }, { ...opts, editMode: true })).toBeNull();
    expect(keyToAction({ key: 'Escape' }, { ...opts, editMode: true })).toEqual({ action: 'exitEdit' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/keymap.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `keymap.js`**

Create `frontend/src/modules/Admin/Art/keymap.js`:

```javascript
// Pure keyboard mapping for the Art Library. Components call keyToAction() and
// dispatch the returned descriptor; keeping it pure makes the bindings testable
// and trivially re-mappable.

// Numpad compass → CSS object-position keyword. 0 = clear (center default).
const NUMPAD_ANCHOR = {
  7: 'top left', 8: 'top', 9: 'top right',
  4: 'left', 5: 'center', 6: 'right',
  1: 'bottom left', 2: 'bottom', 3: 'bottom right',
  0: null,
};
export function anchorForNumpad(key) {
  if (Object.prototype.hasOwnProperty.call(NUMPAD_ANCHOR, key)) return NUMPAD_ANCHOR[key];
  return undefined;
}

// Was this keydown produced by the numeric keypad (vs the top-row digits)?
const isNumpad = (e) => typeof e.code === 'string' && e.code.startsWith('Numpad');

/**
 * Map a keydown to an action descriptor, or null if unbound.
 * @param {{key:string, code?:string, shiftKey?:boolean}} e
 * @param {{quickTags?:string[], editMode?:boolean}} opts
 */
export function keyToAction(e, { quickTags = [], editMode = false } = {}) {
  const k = e.key;
  // In text-edit mode, suspend all single-key bindings except Escape.
  if (editMode) return k === 'Escape' ? { action: 'exitEdit' } : null;

  // Numpad digits set the crop anchor (checked before top-row digit quick-tags).
  if (isNumpad(e)) {
    const value = anchorForNumpad(k);
    if (value !== undefined) return { action: 'anchor', value };
  }

  switch (k) {
    case 'ArrowRight': case 'j': case 'J': return { action: 'next' };
    case 'ArrowLeft': case 'k': case 'K': return { action: 'prev' };
    case 'Enter': return { action: 'toggleView' };
    case '/': return { action: 'focusSearch' };
    case 'a': case 'A': return { action: 'autoAdvance' };
    case 'u': case 'U': return { action: 'undo' };
    case 't': case 'T': return { action: 'palette' };
    case 'x': case 'X': return { action: 'toggleHidden' };
    case 'f': case 'F': return { action: 'toggleFlagged' };
    case 'e': case 'E': return { action: 'edit' };
    case 'Backspace': case '-': return { action: 'removeFromCollection' };
    default: break;
  }

  // Top-row digits 1..9 → quick-tag at that index (if configured).
  if (/^[1-9]$/.test(k)) {
    const tag = quickTags[Number(k) - 1];
    return tag ? { action: 'toggleTag', tag } : null;
  }
  return null;
}

export default { keyToAction, anchorForNumpad };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/keymap.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Admin/Art/keymap.js frontend/src/modules/Admin/Art/keymap.test.js
git commit -m "feat(art-admin): pure keymap for Library keyboard culling"
```

---

### Task 7: Curation hook (`useArtCuration.js`)

**Files:**
- Create: `frontend/src/modules/Admin/Art/useArtCuration.js`
- Test: `frontend/src/modules/Admin/Art/useArtCuration.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Admin/Art/useArtCuration.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }) }),
}));

import { useArtCuration } from './useArtCuration.js';

beforeEach(() => {
  api.mockReset();
  api.mockImplementation((path) => {
    if (path.startsWith('api/v1/admin/art/works')) {
      return Promise.resolve({ total: 2, works: [
        { id: 'a', image: '/img/a.png', meta: { title: 'A', tags: [], hidden: false, flagged: false } },
        { id: 'b', image: '/img/b.png', meta: { title: 'B', tags: [], hidden: false, flagged: false } },
      ] });
    }
    return Promise.resolve({ ok: true, meta: { title: 'A', tags: ['impressionism'] } });
  });
});

describe('useArtCuration', () => {
  it('loads works on mount', async () => {
    const { result } = renderHook(() => useArtCuration());
    await waitFor(() => expect(result.current.works.length).toBe(2));
    expect(result.current.focused.id).toBe('a');
  });

  it('mutate() PATCHes and optimistically updates the focused work', async () => {
    const { result } = renderHook(() => useArtCuration());
    await waitFor(() => expect(result.current.works.length).toBe(2));
    await act(async () => { await result.current.mutate({ tags: ['impressionism'] }); });
    expect(api).toHaveBeenCalledWith('api/v1/admin/art/works/a', { tags: ['impressionism'] }, 'PATCH');
    expect(result.current.focused.meta.tags).toEqual(['impressionism']);
  });

  it('undo() reverts the last mutation', async () => {
    const { result } = renderHook(() => useArtCuration());
    await waitFor(() => expect(result.current.works.length).toBe(2));
    await act(async () => { await result.current.mutate({ hidden: true }); });
    expect(result.current.focused.meta.hidden).toBe(true);
    await act(async () => { await result.current.undo(); });
    expect(result.current.focused.meta.hidden).toBe(false);
  });

  it('next() advances the focus index', async () => {
    const { result } = renderHook(() => useArtCuration());
    await waitFor(() => expect(result.current.works.length).toBe(2));
    act(() => { result.current.next(); });
    expect(result.current.focused.id).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/useArtCuration.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useArtCuration.js`**

Create `frontend/src/modules/Admin/Art/useArtCuration.js`:

```javascript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';

const WORKS_PATH = 'api/v1/admin/art/works';

// Build the query string for the list endpoint from the active filters.
const qs = (filters) => {
  const p = new URLSearchParams();
  Object.entries(filters || {}).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

/**
 * Library data + mutations. Loads the filtered work list, tracks the focused
 * index, and applies optimistic auto-saving PATCHes with an undo stack.
 */
export function useArtCuration(filters = {}) {
  const logger = useMemo(() => getLogger().child({ component: 'admin-art-library' }), []);
  const [works, setWorks] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const undoStack = useRef([]);   // [{ id, prevMeta }]
  const filterKey = JSON.stringify(filters);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await DaylightAPI(`${WORKS_PATH}${qs(filters)}`);
      setWorks(res.works || []);
      setIndex(0);
      logger.info('art.library.loaded', { total: res.total ?? 0 });
    } catch (err) {
      logger.error('art.library.load-failed', { error: err.message });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, logger]);

  useEffect(() => { load(); }, [load]);

  const focused = works[index] || null;

  const clamp = useCallback((i) => Math.max(0, Math.min(works.length - 1, i)), [works.length]);
  const next = useCallback(() => setIndex((i) => clamp(i + 1)), [clamp]);
  const prev = useCallback(() => setIndex((i) => clamp(i - 1)), [clamp]);
  const goto = useCallback((i) => setIndex(() => clamp(i)), [clamp]);

  // Apply a patch to the focused work: optimistic local update + PATCH + undo entry.
  const patchWork = useCallback(async (id, patch, recordUndo = true) => {
    let prevMeta = null;
    setWorks((ws) => ws.map((w) => {
      if (w.id !== id) return w;
      prevMeta = w.meta;
      return { ...w, meta: { ...w.meta, ...patch } };
    }));
    if (recordUndo && prevMeta) undoStack.current.push({ id, prevMeta });
    try {
      const res = await DaylightAPI(`${WORKS_PATH}/${id}`, patch, 'PATCH');
      setWorks((ws) => ws.map((w) => (w.id === id ? { ...w, meta: res.meta || w.meta } : w)));
      logger.debug('art.curate', { id, fields: Object.keys(patch) });
    } catch (err) {
      logger.error('art.curate-failed', { id, error: err.message });
    }
  }, [logger]);

  const mutate = useCallback(async (patch) => {
    if (!focused) return;
    await patchWork(focused.id, patch);
    if (autoAdvance) next();
  }, [focused, patchWork, autoAdvance, next]);

  const undo = useCallback(async () => {
    const last = undoStack.current.pop();
    if (!last) return;
    // Re-PATCH the previous metadata snapshot (whole-field restore).
    await patchWork(last.id, last.prevMeta, false);
    logger.info('art.curate.undo', { id: last.id });
  }, [patchWork, logger]);

  return {
    works, focused, index, loading, autoAdvance,
    setAutoAdvance, next, prev, goto, mutate, undo, reload: load,
  };
}

export default useArtCuration;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/useArtCuration.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Admin/Art/useArtCuration.js frontend/src/modules/Admin/Art/useArtCuration.test.js
git commit -m "feat(art-admin): useArtCuration hook (load, optimistic PATCH, undo)"
```

---

### Task 8: Library components (Loupe, GridView, ArtLibrary)

**Files:**
- Create: `frontend/src/modules/Admin/Art/Loupe.jsx`, `GridView.jsx`, `ArtLibrary.jsx`, `index.js`, `Art.scss`
- Test: `frontend/src/modules/Admin/Art/ArtLibrary.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Admin/Art/ArtLibrary.test.jsx`:

```javascript
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a), DaylightMediaPath: (p) => p }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }) }),
}));
vi.mock('../../../hooks/admin/useAdminConfig.js', () => ({
  useAdminConfig: () => ({ data: { quickTags: ['impressionism', 'baroque'] }, load: () => {} }),
}));

import ArtLibrary from './ArtLibrary.jsx';

const renderLib = () => render(<MantineProvider><ArtLibrary /></MantineProvider>);

beforeEach(() => {
  api.mockReset();
  api.mockImplementation((path) => {
    if (path.startsWith('api/v1/admin/art/works')) {
      return Promise.resolve({ total: 1, works: [
        { id: 'a', image: '/img/a.png', meta: { title: 'Sunrise', artist: 'Monet', tags: [], hidden: false, flagged: false } },
      ] });
    }
    return Promise.resolve({ ok: true, meta: { title: 'Sunrise', tags: ['impressionism'] } });
  });
});

describe('ArtLibrary', () => {
  it('renders the focused work title', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Sunrise')).toBeTruthy());
  });

  it('pressing "1" applies the first quick-tag via PATCH', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Sunrise')).toBeTruthy());
    fireEvent.keyDown(window, { key: '1' });
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('api/v1/admin/art/works/a', { tags: ['impressionism'] }, 'PATCH'));
  });

  it('pressing "x" toggles hidden via PATCH', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Sunrise')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'x' });
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('api/v1/admin/art/works/a', { hidden: true }, 'PATCH'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/ArtLibrary.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the components**

Create `frontend/src/modules/Admin/Art/Loupe.jsx`:

```javascript
import React from 'react';
import { DaylightMediaPath } from '../../../lib/api.mjs';

// 3x3 numpad compass overlay; highlights the work's current crop anchor.
const COMPASS = [
  ['top left', 'top', 'top right'],
  ['left', 'center', 'right'],
  ['bottom left', 'bottom', 'bottom right'],
];
const anchorOrCenter = (a) => (a == null ? 'center' : a);

export default function Loupe({ work, total, index, saved }) {
  if (!work) return <div className="art-loupe art-loupe--empty">No artwork</div>;
  const m = work.meta || {};
  const active = anchorOrCenter(m.crop_anchor);
  return (
    <div className="art-loupe">
      <div className="art-loupe__stage">
        <img className="art-loupe__img" src={DaylightMediaPath(work.image)} alt={m.title || 'Artwork'} />
        <div className="art-loupe__compass" aria-hidden="true">
          {COMPASS.flat().map((pos) => (
            <span key={pos} className={`art-loupe__cell${pos === active ? ' is-active' : ''}`} />
          ))}
        </div>
        <div className="art-loupe__counter">{index + 1} / {total}{saved ? ' · ✓ saved' : ''}</div>
      </div>
      <aside className="art-loupe__meta">
        <h3 className="art-loupe__title">{m.title || '(untitled)'}</h3>
        <div className="art-loupe__sub">{[m.artist, m.date].filter(Boolean).join(' · ')}</div>
        <div className="art-loupe__tags">
          {(m.tags || []).map((t) => <span key={t} className="art-tag">{t}</span>)}
        </div>
        <div className="art-loupe__state">
          {m.hidden ? <span className="art-pill art-pill--hidden">hidden</span> : null}
          {m.flagged ? <span className="art-pill art-pill--flagged">flagged</span> : null}
          <span className="art-pill">anchor: {active}</span>
        </div>
      </aside>
    </div>
  );
}
```

Create `frontend/src/modules/Admin/Art/GridView.jsx`:

```javascript
import React from 'react';
import { DaylightMediaPath } from '../../../lib/api.mjs';

export default function GridView({ works, index, onPick }) {
  return (
    <div className="art-grid" role="listbox" aria-label="Art works">
      {works.map((w, i) => {
        const m = w.meta || {};
        return (
          <button
            key={w.id}
            type="button"
            className={`art-grid__cell${i === index ? ' is-focused' : ''}${m.hidden ? ' is-hidden' : ''}`}
            onClick={() => onPick(i)}
            aria-selected={i === index}
          >
            <img src={DaylightMediaPath(w.image)} alt={m.title || 'Artwork'} loading="lazy" />
            {m.flagged ? <span className="art-grid__flag">⚑</span> : null}
            {(m.tags || []).length ? <span className="art-grid__tagdot" /> : null}
          </button>
        );
      })}
    </div>
  );
}
```

Create `frontend/src/modules/Admin/Art/ArtLibrary.jsx`:

```javascript
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TextInput, Group, Switch, Badge } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import { useAdminConfig } from '../../../hooks/admin/useAdminConfig.js';
import { useArtCuration } from './useArtCuration.js';
import { keyToAction } from './keymap.js';
import Loupe from './Loupe.jsx';
import GridView from './GridView.jsx';
import './Art.scss';

// Toggle a value in/out of an array immutably.
const toggle = (arr = [], v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export default function ArtLibrary() {
  const logger = useMemo(() => getLogger().child({ component: 'admin-art-library' }), []);
  const [filters, setFilters] = useState({});
  const [view, setView] = useState('loupe');   // 'loupe' | 'grid'
  const [editMode, setEditMode] = useState(false);
  const [saved, setSaved] = useState(false);
  const searchRef = useRef(null);

  const cfg = useAdminConfig('household/config/art.yml');
  useEffect(() => { cfg.load?.(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const quickTags = cfg.data?.quickTags || [];

  const {
    works, focused, index, loading, autoAdvance,
    setAutoAdvance, next, prev, goto, mutate, undo,
  } = useArtCuration(filters);

  const flash = useCallback(() => { setSaved(true); setTimeout(() => setSaved(false), 800); }, []);

  // The collection the list is currently filtered to (for remove-from-collection).
  const currentCollection = filters.tag || null;

  const onAction = useCallback(async (a) => {
    if (!a) return;
    switch (a.action) {
      case 'next': return next();
      case 'prev': return prev();
      case 'toggleView': return setView((v) => (v === 'loupe' ? 'grid' : 'loupe'));
      case 'focusSearch': return searchRef.current?.focus();
      case 'autoAdvance': return setAutoAdvance((v) => !v);
      case 'undo': await undo(); return flash();
      case 'edit': return setEditMode(true);
      case 'exitEdit': return setEditMode(false);
      case 'palette': return searchRef.current?.focus();   // P1: palette = focus tag filter; richer palette later
      case 'toggleHidden':
        await mutate({ hidden: !focused?.meta?.hidden }); return flash();
      case 'toggleFlagged':
        await mutate({ flagged: !focused?.meta?.flagged }); return flash();
      case 'toggleTag':
        await mutate({ tags: toggle(focused?.meta?.tags, a.tag) }); return flash();
      case 'anchor':
        await mutate({ crop_anchor: a.value }); return flash();
      case 'removeFromCollection': {
        if (!currentCollection || !focused) return;
        const meta = focused.meta || {};
        if ((meta.tags || []).includes(currentCollection)) {
          await mutate({ tags: meta.tags.filter((t) => t !== currentCollection) });
        } else {
          await mutate({ exclude: [...(meta.exclude || []), currentCollection] });
        }
        return flash();
      }
      default: return undefined;
    }
  }, [next, prev, setAutoAdvance, undo, flash, mutate, focused, currentCollection]);

  // Global keydown → keymap → action. Ignore when typing in an input unless it's Escape.
  useEffect(() => {
    const onKey = (e) => {
      const inField = e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA';
      const a = keyToAction(e, { quickTags, editMode: editMode || inField });
      if (!a) return;
      e.preventDefault();
      onAction(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quickTags, editMode, onAction]);

  useEffect(() => { logger.info('art.library.mount', {}); }, [logger]);

  return (
    <div className="art-library">
      <Group className="art-library__bar" gap="sm">
        <TextInput
          ref={searchRef} size="xs" placeholder="search title / artist…"
          value={filters.q || ''}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.currentTarget.value }))}
        />
        <TextInput
          size="xs" placeholder="filter tag / collection…"
          value={filters.tag || ''}
          onChange={(e) => setFilters((f) => ({ ...f, tag: e.currentTarget.value }))}
        />
        <Switch size="xs" label="hidden" checked={!!filters.hidden}
          onChange={(e) => setFilters((f) => ({ ...f, hidden: e.currentTarget.checked ? 'true' : '' }))} />
        <Switch size="xs" label="flagged" checked={!!filters.flagged}
          onChange={(e) => setFilters((f) => ({ ...f, flagged: e.currentTarget.checked ? 'true' : '' }))} />
        <Switch size="xs" label="auto-advance" checked={autoAdvance}
          onChange={(e) => setAutoAdvance(e.currentTarget.checked)} />
        <Badge size="sm" variant="light">{works.length} works</Badge>
      </Group>

      {loading ? <div className="art-library__loading">Loading…</div>
        : view === 'loupe'
          ? <Loupe work={focused} total={works.length} index={index} saved={saved} />
          : <GridView works={works} index={index} onPick={(i) => { goto(i); setView('loupe'); }} />}
    </div>
  );
}
```

Create `frontend/src/modules/Admin/Art/index.js`:

```javascript
export { default as ArtLibrary } from './ArtLibrary.jsx';
```

Create `frontend/src/modules/Admin/Art/Art.scss`:

```scss
.art-library { display: flex; flex-direction: column; height: 100%; gap: 8px; }
.art-library__bar { padding: 8px 12px; border-bottom: 1px solid var(--ds-border, #333); }
.art-library__loading { padding: 24px; opacity: .6; }

.art-loupe { display: flex; flex: 1; min-height: 0; }
.art-loupe__stage { position: relative; flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px; }
.art-loupe__img { max-width: 100%; max-height: 100%; object-fit: contain; }
.art-loupe__compass { position: absolute; inset: 16px; display: grid;
  grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); pointer-events: none; opacity: .25; }
.art-loupe__cell { border: 1px dashed currentColor; }
.art-loupe__cell.is-active { background: var(--ds-accent, #4a9); opacity: .35; }
.art-loupe__counter { position: absolute; bottom: 18px; left: 20px; font-size: 12px; opacity: .6; }
.art-loupe__meta { width: 220px; padding: 16px; border-left: 1px solid var(--ds-border, #333); }
.art-loupe__title { margin: 0 0 2px; font-size: 16px; }
.art-loupe__sub { opacity: .7; font-size: 12px; margin-bottom: 10px; }
.art-tag, .art-pill { display: inline-block; padding: 1px 6px; margin: 2px 4px 2px 0;
  font-size: 11px; border-radius: 3px; background: rgba(127,127,127,.2); }
.art-pill--hidden { background: rgba(120,120,120,.35); }
.art-pill--flagged { background: rgba(200,80,60,.35); }

.art-grid { flex: 1; overflow: auto; display: grid; gap: 6px; padding: 12px;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); align-content: start; }
.art-grid__cell { position: relative; padding: 0; border: 2px solid transparent;
  background: none; cursor: pointer; aspect-ratio: 1; }
.art-grid__cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.art-grid__cell.is-focused { border-color: var(--ds-accent, #4a9); }
.art-grid__cell.is-hidden { opacity: .4; }
.art-grid__flag { position: absolute; top: 4px; right: 4px; color: #e0604a; }
.art-grid__tagdot { position: absolute; bottom: 4px; left: 4px; width: 6px; height: 6px; border-radius: 50%; background: var(--ds-accent, #4a9); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/ArtLibrary.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Admin/Art/
git commit -m "feat(art-admin): Library UI (loupe + grid, keyboard-driven, auto-save)"
```

---

### Task 9: Register nav + route

**Files:**
- Modify: `frontend/src/modules/Admin/AdminNav.jsx`
- Modify: `frontend/src/Apps/AdminApp.jsx`

- [ ] **Step 1: Add the nav item**

In `AdminNav.jsx`, add `IconPhoto` to the `@tabler/icons-react` import (line 4-10 block), then add an item to the `CONTENT` section's `items` array (after the Programs/Games entries, ~line 19):

```javascript
      { label: 'Art', icon: IconPhoto, to: '/admin/content/art' },
```

- [ ] **Step 2: Add the import + route**

In `AdminApp.jsx`, add an import near the other module imports (~line 9):

```javascript
import { ArtLibrary } from '../modules/Admin/Art/index.js';
```

Add a route inside the `<Route element={<AdminLayout />}>` block, next to the other `content/*` routes (~line 144):

```javascript
              <Route path="content/art" element={<ArtLibrary />} />
```

- [ ] **Step 3: Verify the frontend builds**

Run: `npx vite build` (or the project's frontend build) — confirm no import/JSX errors.
Expected: build succeeds; `ArtLibrary` resolves.

> If a faster check is preferred, run the existing Library test again — it imports the component and will fail on a syntax error: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/ArtLibrary.test.jsx`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Admin/AdminNav.jsx frontend/src/Apps/AdminApp.jsx
git commit -m "feat(art-admin): mount Art Library nav item + route"
```

---

## Phase D — Config + verification

### Task 10: Seed `quickTags` in the live `art.yml`

**Files:**
- Modify (live data volume, via container): `data/household/config/art.yml`

> This file lives in the Docker data volume, not the repo. The frontend reads it through the existing config API (`GET /api/v1/admin/config/files/household/config/art.yml`). The endpoint and Library already default gracefully when `quickTags` is absent — this step just populates the digit shortcuts.

- [ ] **Step 1: Read the current file**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/art.yml'
```

- [ ] **Step 2: Append the `quickTags` key** (write the WHOLE file back — never `sed -i` YAML). Add at the top level (sibling of `collections:`):

```yaml
# Admin Library digit shortcuts (keys 1..9 → toggle these tags/collections).
quickTags: [impressionism, baroque, romantic, realism, paintings, sketches, prints]
```

Use a heredoc inside `sh -c` to rewrite the file (see CLAUDE.local.md "Editing container data files"). Confirm it parses:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/art.yml' | head -40
```

- [ ] **Step 3: No commit** (data volume is not version-controlled). Note the change in the PR/notes.

---

### Task 11: Full-suite check, build, deploy, manual verify

- [ ] **Step 1: Run the affected unit tests together**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/unit/art/ tests/isolated/api/admin-art-router.test.mjs \
  frontend/src/modules/Admin/Art/
```
Expected: all PASS. Then the existing jest art suite:
`npx jest tests/unit/adapters/art/`
Expected: PASS (no regressions).

- [ ] **Step 2: Build the image**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

- [ ] **Step 3: Confirm the deploy gate is clear, then deploy** (per CLAUDE.local.md — never redeploy during an active fitness session or a live playing video):

```bash
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
# Clear ⇒ no videoState:"playing", sessionActive:false, rosterSize:0
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 4: Manual verify in the browser**

Open `/admin/content/art`. Confirm:
- The grid/loupe loads classic works; `← →` / `J K` cycle.
- `1` toggles the impressionism tag (tag chip appears; reload persists it — check `metadata.yaml` via `sudo docker exec daylight-station sh -c 'cat media/img/art/classic/<folder>/metadata.yaml'`).
- numpad `8` sets `crop_anchor: top` (compass highlights top; persists).
- `X` hides a work (grid dims it; filtering `hidden` shows it).
- `F` flags; `Enter` toggles grid/loupe; `U` undoes the last action.
- Open ArtMode (home screensaver) and confirm a hidden work no longer appears and a tagged rule-miss can.

- [ ] **Step 5: Final commit (if any docs/notes changed)**

```bash
git add -A && git commit -m "docs(art-admin): notes after Library deploy verification" || true
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Hybrid membership (tags/exclude/hidden/flagged) → Tasks 1–3. ✓
- Backend list + PATCH endpoints → Tasks 4–5. ✓
- Resolver merge feeding ArtMode → Tasks 1–3 (`isMember` wired through `ArtAdapter`). ✓
- Keyboard model (loupe/grid, digits, numpad anchor, X/F/E/A/U, remove-from-collection) → Tasks 6–8. ✓
- Auto-save + undo → Task 7. ✓
- Nav/route integration → Task 9. ✓
- `quickTags` config → Task 10 (read via existing config API, not a new endpoint — a deliberate simplification of the spec's `GET /quicktags`). ✓
- Classic-only scope; Immich/Collections/Presets out of scope → respected (no Immich write path; only `art/classic` scope listed). ✓
- Logging from the start → hook + components emit structured events. ✓

**Placeholder scan:** none — every code step is complete and runnable.

**Type/name consistency:** field names (`tags`/`exclude`/`hidden`/`flagged`/`crop_anchor`), `isMember(key, def, entry)`, `resolveCandidates(def, key)`, `listWorks({folder})`, `mergeWorkMetadata`/`isValidAnchor`/`filterWorks`, `keyToAction`/`anchorForNumpad`, endpoint paths (`api/v1/admin/art/works`, `PATCH …/works/:id`) are consistent across backend, frontend, and tests.

**Deviation from spec:** the spec's `GET /admin/art/quicktags` is replaced by reading `art.yml` through the existing config API (`useAdminConfig`), removing a redundant endpoint. Functionally equivalent; noted in Task 10.
