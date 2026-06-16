# ArtMode Layout v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Landscape art shows singly (cover-cropped ≤8%/side to fill); portrait/square art shows as a companion diptych with a shared matte; all geometry accounts for the frame PNG's effective border, config-driven in the screen YAML.

**Architecture:** The art adapter loosens the filter (keep everything ≤16:9, classify landscape/portrait), and for a portrait primary picks a companion, returning a unified `{ mode, matte, panels[] }`. A pure frontend `artLayout` helper computes opening insets, per-panel cropped box aspects, and nameplate centers. ArtMode renders single or diptych from that geometry, applying the shared matte and per-painting nameplates.

**Tech Stack:** Node/Express ESM, `jimp`, `js-yaml`, Jest (backend), React + Vitest (frontend).

---

## File Structure

**Create:**
- `frontend/src/screen-framework/widgets/artLayout.js` — pure geometry (`boxAspect`, `artLayout`). No DOM.
- `tests/unit/art/artLayout.test.mjs` — geometry unit tests (Vitest).

**Modify:**
- `backend/src/1_adapters/content/art/ArtAdapter.mjs` — loosen filter + classify; companion selection; unified `{ mode, matte, panels[] }` response; shared matte.
- `tests/unit/adapters/art/ArtAdapter.test.mjs` — rewrite to the new shape + diptych/companion/filter tests.
- `frontend/src/screen-framework/widgets/ArtMode.jsx` — consume `panels` + `artLayout`; single & diptych render; per-panel nameplates.
- `frontend/src/screen-framework/widgets/ArtMode.css` — opening/window driven by inline geometry; `object-fit: cover`; placard `left` per panel.
- `frontend/src/screen-framework/widgets/ArtMode.test.jsx` — rewrite to the new shape + diptych assertions.
- `data/household/screens/living-room.yml` — add layout config under `screensaver.props` (container data volume).

**Unchanged:** `backend/src/4_api/v1/routers/art.mjs`, `backend/src/2_domains/art/deriveMatte.mjs`.

**Conventions:** Backend tests under Jest (`npx jest`), relative imports, `jimp` via `require('jimp').Jimp`. Frontend tests under Vitest (`./node_modules/.bin/vitest run --config vitest.config.mjs <file>`). Screensaver `props` from the YAML are passed straight to the widget, so new props need only be read in ArtMode (no plumbing).

---

## Task 1: Backend — unified response, filter loosening, companion, shared matte

**Files:**
- Modify: `backend/src/1_adapters/content/art/ArtAdapter.mjs`
- Test: `tests/unit/adapters/art/ArtAdapter.test.mjs`

- [ ] **Step 1: Replace the adapter test file**

Overwrite `tests/unit/adapters/art/ArtAdapter.test.mjs` with:

```javascript
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createArtAdapter } from '../../../../backend/src/1_adapters/content/art/ArtAdapter.mjs';
import { Jimp } from 'jimp';

const noopLogger = { warn: () => {}, error: () => {}, debug: () => {}, info: () => {} };

let tmp;
let imgBasePath;

// metadata with explicit dims + optional artist/credit
const metaYaml = (w, h, { artist = 'A', credit = 'C', title = 'T' } = {}) =>
  `title: ${title}\nartist: ${artist}\ndate: '1900'\norigin: O\nmedium: M\ncredit: ${credit}\nwidth: ${w}\nheight: ${h}\n`;

// real solid-color PNG so jimp's average is deterministic
const writeArt = async (folder, [r, g, b], yamlStr) => {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  const color = ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
  await new Jimp({ width: 16, height: 12, color }).write(path.join(dir, 'art.png'));
  fs.writeFileSync(path.join(dir, 'metadata.yaml'), yamlStr);
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
  imgBasePath = path.join(tmp, 'img');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('ArtAdapter', () => {
  it('landscape primary → single, one panel', async () => {
    await writeArt('Land', [117, 135, 156], metaYaml(1600, 1000)); // 1.6 landscape
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(r.panels).toHaveLength(1);
    expect(r.panels[0].image).toContain('Land');
    expect(r.panels[0].meta.width).toBe(1600);
    expect(r.panels[0].color.average).toMatch(/^#[0-9a-f]{6}$/);
    expect(r.matte.branch).toBe('match');
  });

  it('panoramic is excluded; portrait/square are eligible', async () => {
    await writeArt('Pano', [10, 10, 10], metaYaml(3000, 1000));      // 3.0 > 16:9 → excluded
    await writeArt('Land', [10, 10, 10], metaYaml(1600, 1000));      // 1.6 landscape
    await writeArt('Square', [10, 10, 10], metaYaml(1000, 1000));    // 1.0 portrait(square)
    await writeArt('Tall', [10, 10, 10], metaYaml(800, 1200));       // 0.667 portrait
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    let pool;
    await adapter.selectFeatured({ pick: (a) => { pool = a; return a.find((e) => e.kind === 'landscape'); } });
    expect(pool.map((e) => e.folder).sort()).toEqual(['Land', 'Square', 'Tall']);
    expect(pool.find((e) => e.folder === 'Square').kind).toBe('portrait');
    expect(pool.find((e) => e.folder === 'Land').kind).toBe('landscape');
  });

  it('portrait primary → diptych with a companion + shared matte', async () => {
    await writeArt('P1', [200, 40, 40], metaYaml(800, 1200, { artist: 'X' }));
    await writeArt('P2', [40, 40, 200], metaYaml(800, 1200, { artist: 'X' }));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    // pick primary = P1, then companion picker also takes first of its tier
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('diptych');
    expect(r.panels).toHaveLength(2);
    expect(r.panels[0].image).toContain('P1');
    expect(r.panels[1].image).toContain('P2');
    expect(r.matte.base).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('companion prefers same artist+credit, then artist, then credit, then any', async () => {
    await writeArt('Primary', [10, 10, 10], metaYaml(800, 1200, { artist: 'Monet', credit: 'KimballColl' }));
    await writeArt('SameArtistCredit', [10, 10, 10], metaYaml(800, 1200, { artist: 'Monet', credit: 'KimballColl' }));
    await writeArt('SameArtist', [10, 10, 10], metaYaml(800, 1200, { artist: 'Monet', credit: 'Other' }));
    await writeArt('SameCredit', [10, 10, 10], metaYaml(800, 1200, { artist: 'Renoir', credit: 'KimballColl' }));
    await writeArt('Unrelated', [10, 10, 10], metaYaml(800, 1200, { artist: 'Degas', credit: 'Misc' }));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const r = await adapter.selectFeatured({
      pick: (a) => a.find((e) => e.folder === 'Primary') ?? a[0],
    });
    expect(r.mode).toBe('diptych');
    expect(r.panels[1].image).toContain('SameArtistCredit');
  });

  it('portrait with no companion falls back to single', async () => {
    await writeArt('Lonely', [10, 10, 10], metaYaml(800, 1200));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(r.panels).toHaveLength(1);
  });

  it('skips macOS AppleDouble (._) sidecars', async () => {
    const dir = path.join(imgBasePath, 'art', 'classic', 'Land');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '._art.png'), 'fork');
    const color = ((10 << 24) | (10 << 16) | (10 << 8) | 0xff) >>> 0;
    await new Jimp({ width: 16, height: 10, color }).write(path.join(dir, 'real.png'));
    fs.writeFileSync(path.join(dir, 'metadata.yaml'), metaYaml(1600, 1000));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.panels[0].image).toContain('real.png');
  });

  it('throws when the art directory is empty', async () => {
    fs.mkdirSync(path.join(imgBasePath, 'art', 'classic'), { recursive: true });
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    await expect(adapter.selectFeatured({ pick: (a) => a[0] })).rejects.toThrow('No artwork available');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest tests/unit/adapters/art/ArtAdapter.test.mjs`
Expected: FAIL (`r.mode` undefined / shape mismatch).

- [ ] **Step 3: Rewrite the adapter**

Overwrite `backend/src/1_adapters/content/art/ArtAdapter.mjs` with:

```javascript
/**
 * ArtAdapter — selects classic artwork(s) for ArtMode.
 *
 * Eligibility keeps every work whose aspect ratio (w/h) is ≤ 16:9 (panoramic
 * excluded) and classifies it: 'landscape' (4:3–16:9) or 'portrait' (taller
 * than 4:3, incl. square). A landscape primary is shown singly; a portrait
 * primary is paired with a companion (tiered: same artist+credit → artist →
 * credit → any) into a diptych with a shared matte.
 *
 * Returns { mode: 'single'|'diptych', matte, panels: [{ image, meta, color }] }.
 * The eligible index + per-folder resolution are cached for the process.
 */
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Jimp } from 'jimp';
import { deriveMatte, rgbToHsv } from '../../../2_domains/art/deriveMatte.mjs';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MIN_RATIO = 4 / 3;   // landscape floor; below → portrait
const MAX_RATIO = 16 / 9;  // panoramic ceiling; above → excluded
const randomPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const toInt = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const meanRGB = (a, b) => [0, 1, 2].map((i) => Math.round((a[i] + b[i]) / 2));

export function createArtAdapter({ imgBasePath, logger = console }) {
  const artDir = path.join(imgBasePath, 'art', 'classic');
  let eligibleCache = null;            // [{ folder, meta, kind }]
  const resolveCache = new Map();      // folder → { image, meta, avg, color }

  async function readMeta(folder) {
    try {
      const raw = await fs.readFile(path.join(artDir, folder, 'metadata.yaml'), 'utf-8');
      const parsed = yaml.load(raw) || {};
      return {
        title: parsed.title ?? null,
        artist: parsed.artist ?? null,
        date: parsed.date != null ? String(parsed.date) : null,
        origin: parsed.origin ?? null,
        medium: parsed.medium ?? null,
        credit: parsed.credit ?? null,
        width: toInt(parsed.width),
        height: toInt(parsed.height),
      };
    } catch (err) {
      logger.warn?.('art.metadata.missing', { folder, error: err.message });
      return null;
    }
  }

  async function buildEligible() {
    let entries;
    try {
      entries = await fs.readdir(artDir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`No artwork available: ${err.message}`);
    }
    const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const eligible = [];
    for (const folder of folders) {
      const meta = await readMeta(folder);
      if (!meta || !meta.width || !meta.height) continue;
      const ratio = meta.width / meta.height;
      if (ratio > MAX_RATIO) continue; // panoramic excluded
      const kind = ratio >= MIN_RATIO ? 'landscape' : 'portrait';
      eligible.push({ folder, meta, kind });
    }
    logger.info?.('art.index.built', {
      total: folders.length,
      landscape: eligible.filter((e) => e.kind === 'landscape').length,
      portrait: eligible.filter((e) => e.kind === 'portrait').length,
    });
    return eligible;
  }

  async function analyzeColor(imagePath) {
    const img = await Jimp.read(imagePath);
    img.resize({ w: 32, h: 32 }); // jimp mutates in place
    const d = img.bitmap.data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const avg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    const [h, s, v] = rgbToHsv(avg);
    return {
      avg,
      color: {
        average: '#' + avg.map((c) => c.toString(16).padStart(2, '0')).join(''),
        hue: Math.round(h * 360),
        saturation: Math.round(s * 1000) / 1000,
        value: Math.round(v * 1000) / 1000,
      },
    };
  }

  // Resolve a folder to { image, meta, avg, color }. Throws if no image file.
  async function resolveFolder(entry) {
    const cached = resolveCache.get(entry.folder);
    if (cached) return cached;
    const folderPath = path.join(artDir, entry.folder);
    const files = await fs.readdir(folderPath);
    const imageFile = files.find(
      (f) => !f.startsWith('.') && IMAGE_EXTS.includes(path.extname(f).toLowerCase())
    );
    if (!imageFile) throw new Error(`No image file in art folder: ${entry.folder}`);
    const image =
      `/media/img/art/classic/${encodeURIComponent(entry.folder)}/${encodeURIComponent(imageFile)}`;
    let avg = null, color = null;
    try {
      ({ avg, color } = await analyzeColor(path.join(folderPath, imageFile)));
    } catch (err) {
      logger.warn?.('art.color.failed', { folder: entry.folder, error: err.message });
    }
    const resolved = { folder: entry.folder, image, meta: entry.meta, avg, color };
    resolveCache.set(entry.folder, resolved);
    return resolved;
  }

  // Tiered companion: same artist+credit → same artist → same credit → any.
  function pickCompanion(primary, portraits, pick) {
    const pool = portraits.filter((p) => p.folder !== primary.folder);
    if (pool.length === 0) return null;
    const a = primary.meta.artist;
    const c = primary.meta.credit;
    const tiers = [
      pool.filter((p) => a && c && p.meta.artist === a && p.meta.credit === c),
      pool.filter((p) => a && p.meta.artist === a),
      pool.filter((p) => c && p.meta.credit === c),
      pool,
    ];
    for (const tier of tiers) if (tier.length) return pick(tier);
    return pick(pool);
  }

  function matteFromAvgs(avgs) {
    const present = avgs.filter(Boolean);
    if (present.length === 0) return null;
    const avg = present.length === 1 ? present[0] : meanRGB(present[0], present[1]);
    return deriveMatte(avg);
  }

  const panelOut = (p) => ({ image: p.image, meta: p.meta, color: p.color });

  async function selectFeatured({ pick = randomPick } = {}) {
    if (!eligibleCache) eligibleCache = await buildEligible();
    if (eligibleCache.length === 0) throw new Error('No artwork available');

    const chosen = pick(eligibleCache);
    const p1 = await resolveFolder(chosen);

    if (chosen.kind === 'landscape') {
      return { mode: 'single', matte: matteFromAvgs([p1.avg]), panels: [panelOut(p1)] };
    }

    const portraits = eligibleCache.filter((e) => e.kind === 'portrait');
    const companion = pickCompanion(chosen, portraits, pick);
    if (!companion) {
      return { mode: 'single', matte: matteFromAvgs([p1.avg]), panels: [panelOut(p1)] };
    }
    let p2;
    try {
      p2 = await resolveFolder(companion);
    } catch (err) {
      logger.warn?.('art.companion.failed', { folder: companion.folder, error: err.message });
      return { mode: 'single', matte: matteFromAvgs([p1.avg]), panels: [panelOut(p1)] };
    }
    return {
      mode: 'diptych',
      matte: matteFromAvgs([p1.avg, p2.avg]),
      panels: [panelOut(p1), panelOut(p2)],
    };
  }

  return { selectFeatured };
}

export default createArtAdapter;
```

- [ ] **Step 4: Run it, verify PASS** — `npx jest tests/unit/adapters/art/ArtAdapter.test.mjs` (confirm the "Tests: N passed" line). Also `node --check backend/src/1_adapters/content/art/ArtAdapter.mjs`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/art/ArtAdapter.mjs tests/unit/adapters/art/ArtAdapter.test.mjs
git commit -m "feat(art): unified single/diptych response with companion pairing + shared matte

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Frontend pure geometry helper

**Files:**
- Create: `frontend/src/screen-framework/widgets/artLayout.js`
- Test: `tests/unit/art/artLayout.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/artLayout.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { boxAspect, artLayout } from '../../../frontend/src/screen-framework/widgets/artLayout.js';

const FRAME = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };
const CFG = { frame: FRAME, matMargin: 4, crop: 0.08 };

describe('boxAspect', () => {
  it('returns the cell aspect when within the crop budget', () => {
    expect(boxAspect(1.5, 1.5, 0.08)).toBeCloseTo(1.5, 5);
  });
  it('clamps to the widen cap (crop top/bottom) for a tall cell vs wide art', () => {
    // very tall painting, wide cell → cap at artAR / (1-2c)
    expect(boxAspect(3.0, 0.7, 0.08)).toBeCloseTo(0.7 / 0.84, 5);
  });
  it('clamps to the narrow cap (crop sides) for a wide art vs narrow cell', () => {
    expect(boxAspect(0.3, 1.6, 0.08)).toBeCloseTo(1.6 * 0.84, 5);
  });
});

describe('artLayout single', () => {
  it('returns one centered panel with a clamped box aspect', () => {
    const L = artLayout({ mode: 'single', ratios: [1.4], ...CFG });
    expect(L.justify).toBe('center');
    expect(L.panels).toHaveLength(1);
    const c = 0.08; const ar = 1.4;
    expect(L.panels[0].boxAspect).toBeGreaterThanOrEqual(ar * (1 - 2 * c) - 1e-9);
    expect(L.panels[0].boxAspect).toBeLessThanOrEqual(ar / (1 - 2 * c) + 1e-9);
    expect(L.panels[0].heightPct).toBeGreaterThan(0);
    expect(L.panels[0].heightPct).toBeLessThanOrEqual(100.0001);
    expect(L.panels[0].centerXPct).toBeCloseTo((FRAME.left + (100 - FRAME.left - FRAME.right) / 2), 0);
  });
});

describe('artLayout diptych', () => {
  it('two panels, equal three gaps, within the window, crop within cap', () => {
    const r1 = 0.79, r2 = 0.64, c = 0.08;
    const L = artLayout({ mode: 'diptych', ratios: [r1, r2], ...CFG });
    expect(L.justify).toBe('space-evenly');
    expect(L.panels).toHaveLength(2);
    // box aspects within crop budget
    for (const [p, r] of [[L.panels[0], r1], [L.panels[1], r2]]) {
      expect(p.boxAspect).toBeGreaterThanOrEqual(r * (1 - 2 * c) - 1e-9);
      expect(p.boxAspect).toBeLessThanOrEqual(r / (1 - 2 * c) + 1e-9);
    }
    // recompute the three gaps from the outputs and assert equality
    const SW = 16, SH = 9;
    const openTop = (FRAME.top + CFG.matMargin) / 100 * SH;
    const openBot = SH - (FRAME.bottom + CFG.matMargin) / 100 * SH;
    const openHpx = openBot - openTop;
    const Hpx = (L.panels[0].heightPct / 100) * openHpx;
    const w1 = Hpx * L.panels[0].boxAspect, w2 = Hpx * L.panels[1].boxAspect;
    const openLeft = FRAME.left / 100 * SW, openRight = SW - FRAME.right / 100 * SW;
    const c1 = (L.panels[0].centerXPct / 100) * SW, c2 = (L.panels[1].centerXPct / 100) * SW;
    const gapL = (c1 - w1 / 2) - openLeft;
    const gapM = (c2 - w2 / 2) - (c1 + w1 / 2);
    const gapR = openRight - (c2 + w2 / 2);
    expect(gapM).toBeCloseTo(gapL, 3);
    expect(gapR).toBeCloseTo(gapL, 3);
    expect(gapL).toBeGreaterThan(0);
  });

  it('panels share a common height', () => {
    const L = artLayout({ mode: 'diptych', ratios: [0.7, 0.9], ...CFG });
    expect(L.panels[0].heightPct).toBeCloseTo(L.panels[1].heightPct, 6);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artLayout.test.mjs`
Expected: FAIL — cannot resolve `artLayout.js`.

- [ ] **Step 3: Write the helper**

Create `frontend/src/screen-framework/widgets/artLayout.js`:

```javascript
// artLayout.js — pure geometry for ArtMode (single + diptych). No DOM.
// Reference stage 16 × 9; all outputs are CSS-ready (% of stage, except
// panel heightPct which is % of the opening; aspect ratios are unitless).
const SW = 16, SH = 9;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Display-box aspect filling a cell, allowing ≤ crop per side cover-crop.
export function boxAspect(cellAR, artAR, crop) {
  return clamp(cellAR, artAR * (1 - 2 * crop), artAR / (1 - 2 * crop));
}

/**
 * @param {object} o
 * @param {'single'|'diptych'} o.mode
 * @param {number[]} o.ratios   art aspect ratios (w/h), 1 or 2 entries
 * @param {{top,right,bottom,left}} o.frame  frame window insets, % (top/bottom of height, left/right of width)
 * @param {number} o.matMargin  mat band, % of stage height (uniform in pixels)
 * @param {number} o.crop       max cover-crop per side, fraction (e.g. 0.08)
 * @returns {{ opening:{top,bottom,left,right}, justify:string, panels:[{boxAspect,heightPct,centerXPct}] }}
 */
export function artLayout({ mode, ratios, frame, matMargin, crop }) {
  const openTopPct = frame.top + matMargin;
  const openBotPct = frame.bottom + matMargin;
  const openTopPx = (openTopPct / 100) * SH;
  const openBotPx = SH - (openBotPct / 100) * SH;
  const openHpx = openBotPx - openTopPx;
  const mmPx = (matMargin / 100) * SH; // uniform pixel mat

  if (mode === 'diptych' && ratios.length === 2) {
    const openLeftPx = (frame.left / 100) * SW;
    const openRightPx = SW - (frame.right / 100) * SW;
    const openWpx = openRightPx - openLeftPx;
    const [r1, r2] = ratios;
    const sum0 = openHpx * (r1 + r2);
    const avail = openWpx - 3 * mmPx;
    let H, b1, b2;
    if (sum0 <= avail) {
      const k = Math.min(avail / sum0, 1 / (1 - 2 * crop)); // widen via top/bottom crop, capped
      H = openHpx; b1 = r1 * k; b2 = r2 * k;
    } else {
      H = avail / (r1 + r2); b1 = r1; b2 = r2;              // too wide → shrink height to fit
    }
    const w1 = H * b1, w2 = H * b2;
    const gap = (openWpx - w1 - w2) / 3;
    const c1 = openLeftPx + gap + w1 / 2;
    const c2 = openLeftPx + 2 * gap + w1 + w2 / 2;
    const heightPct = (H / openHpx) * 100;
    return {
      opening: { top: openTopPct, bottom: openBotPct, left: frame.left, right: frame.right },
      justify: 'space-evenly',
      panels: [
        { boxAspect: b1, heightPct, centerXPct: (c1 / SW) * 100 },
        { boxAspect: b2, heightPct, centerXPct: (c2 / SW) * 100 },
      ],
    };
  }

  // single — mat margin on all sides (uniform in pixels)
  const mmPctX = (mmPx / SW) * 100;
  const openLeftPct = frame.left + mmPctX;
  const openRightPct = frame.right + mmPctX;
  const openLeftPx = (openLeftPct / 100) * SW;
  const openRightPx = SW - (openRightPct / 100) * SW;
  const openWpx = openRightPx - openLeftPx;
  const cellAR = openWpx / openHpx;
  const bAR = boxAspect(cellAR, ratios[0], crop);
  let wpx, hpx;
  if (bAR >= cellAR) { wpx = openWpx; hpx = wpx / bAR; }  // width-limited
  else { hpx = openHpx; wpx = hpx * bAR; }                // height-limited
  const centerX = openLeftPx + openWpx / 2;
  return {
    opening: { top: openTopPct, bottom: openBotPct, left: openLeftPct, right: openRightPct },
    justify: 'center',
    panels: [
      { boxAspect: bAR, heightPct: (hpx / openHpx) * 100, centerXPct: (centerX / SW) * 100 },
    ],
  };
}

export default artLayout;
```

- [ ] **Step 4: Run it, verify PASS** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artLayout.test.mjs` (confirm all pass).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/widgets/artLayout.js tests/unit/art/artLayout.test.mjs
git commit -m "feat(art): pure layout geometry (crop box aspect + diptych equal gaps)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: ArtMode renders single + diptych

**Files:**
- Modify: `frontend/src/screen-framework/widgets/ArtMode.jsx`
- Modify: `frontend/src/screen-framework/widgets/ArtMode.css`
- Test: `frontend/src/screen-framework/widgets/ArtMode.test.jsx`
- Modify: `data/household/screens/living-room.yml` (container data volume)

- [ ] **Step 1: Overwrite the ArtMode test file**

Overwrite `frontend/src/screen-framework/widgets/ArtMode.test.jsx` with:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { DaylightAPI } from '../../lib/api.mjs';
import ArtMode from './ArtMode.jsx';

const press = (key) =>
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(),
  DaylightMediaPath: (p) => String(p),
}));

const matte = {
  branch: 'match', base: '#58616b', glow: '#6b7682', edge: '#474e56',
  bevelTop: '#474e56', bevelLeft: '#4e555d', bevelRight: '#626c77', bevelBottom: '#6b7682',
};
const single = (over = {}) => ({
  mode: 'single', matte,
  panels: [{ image: '/a.jpg', meta: { title: 'A', artist: 'Artist', date: '1900', width: 1600, height: 1000 } }],
  ...over,
});
const diptych = () => ({
  mode: 'diptych', matte,
  panels: [
    { image: '/a.jpg', meta: { title: 'A', artist: 'X', date: '1', width: 800, height: 1200 } },
    { image: '/b.jpg', meta: { title: 'B', artist: 'X', date: '2', width: 800, height: 1100 } },
  ],
});

describe('ArtMode', () => {
  beforeEach(() => { DaylightAPI.mockReset(); });

  it('single: one window, one placard, frame, matte vars', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId, queryByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode-frame')).toBeTruthy();
    expect(getByTestId('artmode-placard')).toBeTruthy();
    expect(queryByTestId('artmode-image-1')).toBeNull();
    expect(getByTestId('artmode').style.getPropertyValue('--matte-base')).toBe('#58616b');
  });

  it('diptych: two windows and two placards', async () => {
    DaylightAPI.mockResolvedValue(diptych());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode-image-1')).toBeTruthy();
    expect(getByTestId('artmode-placard')).toBeTruthy();
    expect(getByTestId('artmode-placard-1')).toBeTruthy();
  });

  it('hides placards when placard=false', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId, queryByTestId } = render(<ArtMode placard={false} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(queryByTestId('artmode-placard')).toBeNull();
  });

  it('black fallback (no image) on fetch failure', async () => {
    DaylightAPI.mockRejectedValue(new Error('boom'));
    const { getByTestId, queryByTestId } = render(<ArtMode />);
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalled());
    await waitFor(() => expect(getByTestId('artmode-frame')).toBeTruthy());
    expect(queryByTestId('artmode-image')).toBeNull();
  });

  it('shuffles on arrows; exits on Enter/Space/Escape; dims on Up/Down', async () => {
    DaylightAPI.mockResolvedValue(single());
    const onExit = vi.fn();
    const { getByTestId } = render(<ArtMode onExit={onExit} />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    press('ArrowRight');
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(2));
    expect(getByTestId('artmode-dim').style.opacity).toBe('0');
    press('ArrowDown');
    expect(getByTestId('artmode-dim').style.opacity).toBe('0.1');
    press('ArrowUp');
    expect(getByTestId('artmode-dim').style.opacity).toBe('0');
    press('Enter'); press(' '); press('Escape');
    expect(onExit).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx`
Expected: FAIL (diptych testids / new shape not handled).

- [ ] **Step 3: Rewrite `ArtMode.jsx`**

Overwrite `frontend/src/screen-framework/widgets/ArtMode.jsx` with:

```javascript
// frontend/src/screen-framework/widgets/ArtMode.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
import { getChildLogger } from '../../lib/logging/singleton.js';
import { artLayout } from './artLayout.js';
import './ArtMode.css';

const DIM_STEP = 0.1;
const DIM_MAX = 0.85;
const EXIT_KEYS = new Set(['Enter', ' ', 'Spacebar', 'Escape', 'Esc']);
const NEXT_KEYS = new Set(['ArrowLeft', 'ArrowRight']);
const BRIGHTER_KEYS = new Set(['ArrowUp']);
const DIMMER_KEYS = new Set(['ArrowDown']);
const round2 = (n) => Math.round(n * 100) / 100;
const DEFAULT_FRAME = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };

/**
 * ArtMode — single landscape or portrait diptych, matted + framed, with engraved
 * brass nameplate(s). Home screensaver.
 *
 * Props (from screen YAML screensaver.props):
 *   placard        show nameplate(s) (default true)
 *   onExit/dismiss close the screensaver
 *   frame          frame PNG window insets {top,right,bottom,left} % (default DEFAULT_FRAME)
 *   matMargin      mat band % of height (default 4)
 *   cropMaxPerSide max cover-crop per side, % (default 8)
 */
function ArtMode({
  placard = true, onExit, dismiss,
  frame = DEFAULT_FRAME, matMargin = 4, cropMaxPerSide = 8,
}) {
  const [art, setArt] = useState(null);
  const [failed, setFailed] = useState(false);
  const [dim, setDim] = useState(0);
  const logger = useMemo(() => getChildLogger({ widget: 'art' }), []);
  const frameSrc = useMemo(() => DaylightMediaPath('media/img/ui/frame.png'), []);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(() => {
    DaylightAPI('api/v1/art/featured')
      .then((data) => {
        if (!mountedRef.current) return;
        setFailed(false);
        setArt(data);
        logger.info('artmode.loaded', { mode: data?.mode ?? null, count: data?.panels?.length ?? 0 });
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setFailed(true);
        logger.error('artmode.load-failed', { error: err.message });
      });
  }, [logger]);
  useEffect(() => { logger.info('artmode.mount', { placard }); load(); }, [logger, load, placard]);

  const exit = useCallback(() => { (onExit || dismiss)?.(); }, [onExit, dismiss]);
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key;
      if (!(EXIT_KEYS.has(k) || NEXT_KEYS.has(k) || BRIGHTER_KEYS.has(k) || DIMMER_KEYS.has(k))) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (EXIT_KEYS.has(k)) { logger.info('artmode.exit', { key: k }); exit(); }
      else if (NEXT_KEYS.has(k)) { logger.info('artmode.shuffle', { key: k }); load(); }
      else if (BRIGHTER_KEYS.has(k)) setDim((d) => round2(Math.max(0, d - DIM_STEP)));
      else setDim((d) => round2(Math.min(DIM_MAX, d + DIM_STEP)));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [exit, load, logger]);

  const matteVars = useMemo(() => {
    const m = art?.matte;
    if (!m) return undefined;
    return {
      '--matte-base': m.base, '--matte-glow': m.glow, '--matte-edge': m.edge,
      '--cut-top': m.bevelTop, '--cut-left': m.bevelLeft, '--cut-right': m.bevelRight, '--cut-bottom': m.bevelBottom,
    };
  }, [art]);

  const panels = (!failed && art?.panels) ? art.panels : [];
  const layout = useMemo(() => {
    if (!panels.length) return null;
    const ratios = panels.map((p) =>
      (p.meta?.width > 0 && p.meta?.height > 0) ? p.meta.width / p.meta.height : 1);
    return artLayout({ mode: art.mode, ratios, frame, matMargin, crop: cropMaxPerSide / 100 });
  }, [panels, art, frame, matMargin, cropMaxPerSide]);

  const testid = (base, i) => (i === 0 ? base : `${base}-${i}`);

  return (
    <div className="artmode" data-testid="artmode" style={matteVars}>
      <div className="artmode__stage">
        <div className="artmode__matte" aria-hidden="true" />
        {layout && (
          <div className="artmode__opening" style={{
            top: `${layout.opening.top}%`, bottom: `${layout.opening.bottom}%`,
            left: `${layout.opening.left}%`, right: `${layout.opening.right}%`,
            justifyContent: layout.justify,
          }}>
            {panels.map((p, i) => (
              <div key={i} className="artmode__window" data-testid={testid('artmode-window', i)}
                   style={{ height: `${layout.panels[i].heightPct}%`, aspectRatio: String(layout.panels[i].boxAspect) }}>
                <img className="artmode__image" data-testid={testid('artmode-image', i)}
                     src={DaylightMediaPath(p.image)} alt={p.meta?.title || 'Artwork'} />
                <span className="artmode__cut" aria-hidden="true" />
              </div>
            ))}
          </div>
        )}
        <img className="artmode__frame" data-testid="artmode-frame" src={frameSrc} alt="" />
        {placard && layout && panels.map((p, i) => {
          if (!(p.meta && (p.meta.title || p.meta.artist))) return null;
          return (
            <div key={i} className="artmode__placard" data-testid={testid('artmode-placard', i)}
                 style={{ left: `${layout.panels[i].centerXPct}%` }}>
              {p.meta.title && <span className="artmode__placard-title">{p.meta.title}</span>}
              {(p.meta.artist || p.meta.date) && (
                <span className="artmode__placard-artist">
                  {[p.meta.artist, p.meta.date].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
          );
        })}
        <div className="artmode__dim" data-testid="artmode-dim" aria-hidden="true" style={{ opacity: dim }} />
      </div>
    </div>
  );
}

export default ArtMode;
```

- [ ] **Step 4: Update `ArtMode.css`**

Replace the `.artmode__opening` rule:

```css
.artmode__opening {
  position: absolute;
  top: 17%;
  bottom: 17%;
  left: 13%;
  right: 13%;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

with (insets + justify now come from inline style; keep flex + centering):

```css
.artmode__opening {
  position: absolute;
  display: flex;
  align-items: center;
}
```

Replace the `.artmode__window` rule:

```css
.artmode__window {
  position: relative;
  height: 100%;
  max-width: 100%;
  aspect-ratio: 1 / 1;        /* fallback; overridden inline by the real ratio */
  line-height: 0;
}
```

with (height + aspect-ratio come from inline style):

```css
.artmode__window {
  position: relative;
  line-height: 0;
}
```

Replace the `.artmode__image` rule's `object-fit`:

```css
  object-fit: contain;
```

with:

```css
  object-fit: cover;
```

Replace the `.artmode__placard` `left`/`transform` lines:

```css
  left: 50%;
  transform: translateX(-50%);
```

with (left now comes from inline style per panel; keep the centering transform):

```css
  transform: translateX(-50%);
```

- [ ] **Step 5: Run tests, verify PASS** — `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx` (all pass). Also run the screensaver suite to confirm no regression: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/`.

- [ ] **Step 6: Add layout config to the home screen**

Update `data/household/screens/living-room.yml`'s `screensaver.props` to include the layout knobs. Per `CLAUDE.local.md`, rewrite the whole file via heredoc (no `sed`). The `props` block becomes:

```yaml
  props:
    placard: true
    cropMaxPerSide: 8
    matMargin: 4
    frame:
      top: 11.9
      right: 6.5
      bottom: 11.1
      left: 7.0
```

Apply by reading the current file (`sudo docker exec daylight-station sh -c 'cat data/household/screens/living-room.yml'`), then rewriting it with the expanded `props` via `sudo docker exec daylight-station sh -c "cat > data/household/screens/living-room.yml << 'EOF' ... EOF"`. Verify: `curl -s http://localhost:3111/api/v1/screens/living-room | python3 -c 'import sys,json;print(json.load(sys.stdin)["screensaver"]["props"])'` shows the frame/crop/matMargin keys.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screen-framework/widgets/ArtMode.jsx frontend/src/screen-framework/widgets/ArtMode.css frontend/src/screen-framework/widgets/ArtMode.test.jsx
git commit -m "feat(art): ArtMode single + portrait diptych with config-driven geometry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** filter loosening + classification + panoramic exclusion (Task 1); tiered companion artist+credit→artist→credit→any, no-companion→single (Task 1); shared matte = deriveMatte(mean of avgs) (Task 1); unified `{mode,matte,panels[]}` (Task 1); crop box-aspect clamp ≤8%/side + diptych equal-gap geometry + frame-window-aware opening (Task 2); ArtMode single+diptych render, per-panel nameplates on the rail, matte vars, config props (Task 3); frame border + crop + matMargin config in YAML (Task 3).
- **Type consistency:** adapter returns `{ mode, matte, panels:[{image,meta,color}] }`; `artLayout({mode,ratios,frame,matMargin,crop})` → `{opening:{top,bottom,left,right}, justify, panels:[{boxAspect,heightPct,centerXPct}]}`; ArtMode zips `art.panels[i]` with `layout.panels[i]` and reads `p.meta.width/height`. `crop` is a fraction in the helper; ArtMode passes `cropMaxPerSide/100`. Frame insets keys `top/right/bottom/left` consistent across helper, ArtMode default, and YAML.
- **Deferred:** 3-up/mixed layouts, transitions, recent-pair memory.
- **Note:** this rework replaces the v1 flat response and single-only ArtMode in one coordinated change; deploy serves both together.
