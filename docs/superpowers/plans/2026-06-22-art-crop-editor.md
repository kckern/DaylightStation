# Art Crop Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each art work a precise, curator-defined vertical crop band (or an explicit "don't crop / matted" flag) that the ArtMode screensaver obeys, edited by dragging a keep-window on the Library loupe.

**Architecture:** A new optional `crop` object in each work's `metadata.yaml` (`enabled`, `top`, `bottom` margin %). The backend surfaces + validates + persists it (no new endpoints). The screensaver gains a pure `cropBandFit()` cover-transform and a `fillDecision` gate so a band renders exactly and `enabled:false` forces matted. The Library loupe gets a draggable `CropEditor` overlay that auto-saves the `crop` via the existing curation hook.

**Tech Stack:** Node/Express 4 (backend ESM `.mjs`), js-yaml; React + Mantine (frontend); **vitest** for all tests. CSS transforms for the band render (no canvas).

**Spec:** `docs/superpowers/specs/2026-06-22-art-crop-editor-design.md`

**Conventions (use exactly):**
- Run a vitest file: `./node_modules/.bin/vitest run --config vitest.config.mjs <path>`
- Backend logic tests live under `tests/unit/art/`; router/api tests under `tests/isolated/api/`; frontend tests co-located `*.test.js[x]`. All use `import { describe, it, expect } from 'vitest'`.
- The work's curation fields already round-trip through `PATCH /api/v1/admin/art/works/*` and `useArtCuration.mutate({...})`; `crop` rides the same path.
- Crop margins are **% of source height**: keep-band = rows `[top, 100−bottom]`. Validation: `top,bottom ∈ [0,90]`, `top+bottom ≤ 90`.

---

## File Structure

**Backend — modify:**
- `backend/src/1_adapters/content/art/sources/artSource.mjs` — surface `crop` in `readMeta` + `projectMeta`.
- `backend/src/1_adapters/content/art/workMetadata.mjs` — add `crop` to `WRITABLE`; add `isValidCrop`; validate in `mergeWorkMetadata`.

**Engine — modify:**
- `frontend/src/screen-framework/widgets/artModes.js` — add pure `openingAspect()` + `cropBandFit()`; add a `crop` gate to `fillDecision`.
- `frontend/src/screen-framework/widgets/ArtMode.jsx` — pass `crop` to `fillDecision`; render the band in the fit-window path.
- `frontend/src/screen-framework/widgets/ArtLayer.jsx` — same band render in the crossfade path.
- `frontend/src/screen-framework/widgets/ArtMode.css` — `overflow:hidden` on the fit-window.

**Library — create/modify:**
- `frontend/src/modules/Admin/Art/cropGeometry.js` (new) — pure window↔% geometry + clamps.
- `frontend/src/modules/Admin/Art/CropEditor.jsx` (new) — draggable overlay.
- `frontend/src/modules/Admin/Art/Loupe.jsx` — mount `CropEditor` for landscape works; accept `onCrop`.
- `frontend/src/modules/Admin/Art/ArtLibrary.jsx` — pass `onCrop` (a `mutate({crop})` wrapper) to `Loupe`.

---

## Phase A — Backend: surface, validate, persist

### Task 1: Surface `crop` in artSource

**Files:**
- Modify: `backend/src/1_adapters/content/art/sources/artSource.mjs`
- Test: `tests/unit/art/artSource.crop.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/artSource.crop.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Jimp } from 'jimp';
import { createArtSource } from '../../../backend/src/1_adapters/content/art/sources/artSource.mjs';

const noop = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} };
let tmp, imgBasePath;

async function writeWork(folder, metaLines) {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  await new Jimp({ width: 16, height: 12, color: 0x808080ff }).write(path.join(dir, 'art.png'));
  fs.writeFileSync(path.join(dir, 'metadata.yaml'), `title: ${folder}\nwidth: 16\nheight: 12\n${metaLines}`);
}

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artcrop-')); imgBasePath = path.join(tmp, 'img'); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('artSource surfaces crop', () => {
  it('listWorks exposes a crop band', async () => {
    await writeWork('banded', "crop:\n  top: 12.5\n  bottom: 20\n");
    const src = createArtSource({ imgBasePath, logger: noop });
    const [w] = await src.listWorks();
    expect(w.meta.crop).toEqual({ enabled: true, top: 12.5, bottom: 20, left: null, right: null });
  });

  it('listWorks exposes an explicit not-croppable flag', async () => {
    await writeWork('nocrop', "crop:\n  enabled: false\n");
    const src = createArtSource({ imgBasePath, logger: noop });
    const [w] = await src.listWorks();
    expect(w.meta.crop).toMatchObject({ enabled: false });
  });

  it('works without crop expose crop: null', async () => {
    await writeWork('plain', "date: '1875'\n");
    const src = createArtSource({ imgBasePath, logger: noop });
    const [w] = await src.listWorks();
    expect(w.meta.crop).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artSource.crop.test.mjs`
Expected: FAIL — `w.meta.crop` is `undefined`.

- [ ] **Step 3: Implement**

In `artSource.mjs`, inside `readMeta`, just before the `return { ... }` of the parsed branch, add a normalizer and include `crop` in the returned object. Add this helper near the top of the file (after the `IMAGE_EXTS` const):

```javascript
// Normalize a raw metadata `crop` into { enabled, top, bottom, left, right } or null.
// enabled defaults true when a crop object exists; margins are numbers or null.
function normalizeCrop(raw) {
  if (raw == null || typeof raw !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    enabled: raw.enabled === false ? false : true,
    top: num(raw.top), bottom: num(raw.bottom),
    left: num(raw.left), right: num(raw.right),
  };
}
```

Then in `readMeta`'s returned object (the `return { title: ..., width: ..., height: ... }`), add the `crop` key alongside the curation fields:

```javascript
        tags: arr(p.tags), exclude: arr(p.exclude),
        hidden: p.hidden === true, flagged: p.flagged === true,
        crop: normalizeCrop(p.crop),
        width: toInt(p.width), height: toInt(p.height),
```

Then in `projectMeta` (the shared projection), add `crop`:

```javascript
    tags: meta.tags ?? [], exclude: meta.exclude ?? [],
    hidden: meta.hidden === true, flagged: meta.flagged === true,
    crop: meta.crop ?? null,
    width: meta.width, height: meta.height,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artSource.crop.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/art/sources/artSource.mjs tests/unit/art/artSource.crop.test.mjs
git commit -m "feat(art): surface per-work crop band in artSource"
```

---

### Task 2: Validate + persist `crop` through PATCH

**Files:**
- Modify: `backend/src/1_adapters/content/art/workMetadata.mjs`
- Test: `tests/unit/art/workMetadata.crop.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/workMetadata.crop.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { isValidCrop, mergeWorkMetadata }
  from '../../../backend/src/1_adapters/content/art/workMetadata.mjs';

describe('isValidCrop', () => {
  it('accepts a valid band and the not-croppable flag', () => {
    expect(isValidCrop({ top: 10, bottom: 20 })).toBe(true);
    expect(isValidCrop({ enabled: false })).toBe(true);
    expect(isValidCrop(null)).toBe(true);   // clear
  });
  it('rejects out-of-range and over-budget bands', () => {
    expect(isValidCrop({ top: -1 })).toBe(false);
    expect(isValidCrop({ top: 95 })).toBe(false);
    expect(isValidCrop({ top: 60, bottom: 40 })).toBe(false);   // sum > 90
    expect(isValidCrop('top')).toBe(false);
    expect(isValidCrop({ enabled: 'no' })).toBe(false);
  });
});

describe('mergeWorkMetadata crop', () => {
  const base = "title: X\nwidth: 1600\nheight: 1000\n";
  it('writes a crop band', () => {
    const out = yaml.load(mergeWorkMetadata(base, { crop: { enabled: true, top: 12, bottom: 18 } }));
    expect(out.crop).toMatchObject({ enabled: true, top: 12, bottom: 18 });
  });
  it('crop: null clears it', () => {
    const withCrop = "title: X\nwidth: 1\nheight: 1\ncrop:\n  top: 5\n";
    const out = yaml.load(mergeWorkMetadata(withCrop, { crop: null }));
    expect('crop' in out).toBe(false);
  });
  it('throws on an invalid crop', () => {
    expect(() => mergeWorkMetadata(base, { crop: { top: 99 } })).toThrow(/crop/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/workMetadata.crop.test.mjs`
Expected: FAIL — `isValidCrop is not a function`.

- [ ] **Step 3: Implement**

In `workMetadata.mjs`:

Add `'crop'` to the `WRITABLE` set:

```javascript
const WRITABLE = new Set([
  'title', 'artist', 'date', 'medium', 'category', 'display',
  'crop_anchor', 'tags', 'exclude', 'hidden', 'flagged', 'crop',
]);
```

Add the validator (after `isValidAnchor`):

```javascript
// A crop is null (clear), or { enabled?:bool, top?,bottom?,left?,right?:0..90 } with
// top+bottom ≤ 90 and left+right ≤ 90 (always keep ≥10% of each cropped axis).
export function isValidCrop(crop) {
  if (crop == null) return true;
  if (typeof crop !== 'object' || Array.isArray(crop)) return false;
  if ('enabled' in crop && typeof crop.enabled !== 'boolean') return false;
  const side = (v) => v == null || (typeof v === 'number' && v >= 0 && v <= 90);
  for (const k of ['top', 'bottom', 'left', 'right']) {
    if (k in crop && !side(crop[k])) return false;
  }
  if ((Number(crop.top) || 0) + (Number(crop.bottom) || 0) > 90) return false;
  if ((Number(crop.left) || 0) + (Number(crop.right) || 0) > 90) return false;
  return true;
}
```

In `mergeWorkMetadata`, add a crop check next to the anchor check (right after the `crop_anchor` validation line):

```javascript
  if ('crop' in patch && !isValidCrop(patch.crop)) {
    throw new Error(`Invalid crop: ${JSON.stringify(patch.crop)}`);
  }
```

Add `isValidCrop` to the default export object:

```javascript
export default { isValidAnchor, isValidCrop, mergeWorkMetadata, filterWorks };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/workMetadata.crop.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/art/workMetadata.mjs tests/unit/art/workMetadata.crop.test.mjs
git commit -m "feat(art): validate + persist per-work crop through PATCH"
```

---

## Phase B — Screensaver engine

### Task 3: `openingAspect` + `cropBandFit` pure helpers

**Files:**
- Modify: `frontend/src/screen-framework/widgets/artModes.js`
- Test: `frontend/src/screen-framework/widgets/cropBandFit.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/screen-framework/widgets/cropBandFit.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { openingAspect, cropBandFit } from './artModes.js';

const FRAME = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };

describe('openingAspect', () => {
  it('full window is 16:9', () => {
    expect(openingAspect({ frame: FRAME, fullWindow: true })).toBeCloseTo(16 / 9, 5);
  });
  it('framed opening is wider than 16:9 (~2:1)', () => {
    const ar = openingAspect({ frame: FRAME, fullWindow: false });
    expect(ar).toBeGreaterThan(1.9);
    expect(ar).toBeLessThan(2.1);
  });
});

describe('cropBandFit', () => {
  it('a band needing zoom scales up and offsets to the band top', () => {
    // tall source (srcRatio 1.0) into a 2:1 opening, keep middle 50% band.
    const fit = cropBandFit({ top: 25, bottom: 25 }, 1.0, 2.0);
    // bh = .5 → s = max(1, 1.0/(2.0*0.5)) = max(1,1) = 1 → no zoom, top-aligned to 25%
    expect(fit.scale).toBeCloseTo(1, 5);
    expect(fit.transform).toContain('scale(1');
  });
  it('a thin band zooms in (scale > 1) and centers horizontally', () => {
    const fit = cropBandFit({ top: 40, bottom: 40 }, 1.0, 2.0); // bh=.2 → s=1/(2*.2)=2.5
    expect(fit.scale).toBeCloseTo(2.5, 4);
    expect(fit.transform).toMatch(/translate\(-75\.?0*%, -100\.?0*%\) scale\(2\.5/);
  });
  it('full-frame band on a wide source is a near no-op (scale 1, no offset)', () => {
    const fit = cropBandFit({ top: 0, bottom: 0 }, 2.0, 2.0);
    expect(fit.scale).toBeCloseTo(1, 5);
    expect(fit.transform).toBe('translate(-0%, -0%) scale(1)');
  });
});
```

> Math check for the thin-band case: `bh=0.2`, `s = max(1, srcRatio/(openingRatio*bh)) = 1/(2*0.2) = 2.5`. Horizontal centering `Tx = -(s-1)/2*100 = -75%`. Vertical `Ty = -s*top/100*100 = -2.5*0.4*100 = -100%`.

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/cropBandFit.test.js`
Expected: FAIL — `openingAspect is not a function`.

- [ ] **Step 3: Implement**

In `artModes.js`, after the `cropFocus` function, add:

```javascript
/**
 * Aspect (w/h) of the ArtMode opening a panel fills. fullWindow → the whole 16:9
 * stage; otherwise the frame insets shrink it (≈2:1 for the default gold frame).
 * @param {{frame:{top,right,bottom,left}, fullWindow:boolean}} o
 */
export function openingAspect({ frame, fullWindow }) {
  if (fullWindow) return SW / SH;
  const w = SW - ((frame.left + frame.right) / 100) * SW;
  const h = SH - ((frame.top + frame.bottom) / 100) * SH;
  return w / h;
}

/**
 * CSS to cover-fill a full-width vertical keep-band [top, 100−bottom] (% of source
 * height) into an opening, applied to an <img width:100%> in an overflow:hidden
 * window. Uniform cover scale; horizontal centered; band top aligned to the window
 * top. Pure + px-independent (translate % is relative to the img's own box).
 * @param {{top?:number, bottom?:number}} band
 * @param {number} srcRatio  source aspect (w/h)
 * @param {number} openingRatio  opening aspect (w/h)
 * @returns {{transform:string, transformOrigin:'top left', scale:number}}
 */
export function cropBandFit(band, srcRatio, openingRatio) {
  const t = Math.max(0, Math.min(90, Number(band?.top) || 0)) / 100;
  const b = Math.max(0, Math.min(90, Number(band?.bottom) || 0)) / 100;
  const bh = Math.max(0.1, 1 - t - b);                 // band height fraction of source
  const scale = Math.max(1, srcRatio / (openingRatio * bh));
  const tx = -((scale - 1) / 2) * 100;                 // center horizontally
  const ty = -(scale * t) * 100;                       // align band top to window top
  const r3 = (n) => `${Number(n.toFixed(3))}`;
  return {
    transform: `translate(${r3(tx)}%, ${r3(ty)}%) scale(${Number(scale.toFixed(4))})`,
    transformOrigin: 'top left',
    scale,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/cropBandFit.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/widgets/artModes.js frontend/src/screen-framework/widgets/cropBandFit.test.js
git commit -m "feat(artmode): pure openingAspect + cropBandFit cover-transform helpers"
```

---

### Task 4: `fillDecision` crop gate

**Files:**
- Modify: `frontend/src/screen-framework/widgets/artModes.js`
- Test: `frontend/src/screen-framework/widgets/fillDecision.crop.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/screen-framework/widgets/fillDecision.crop.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { fillDecision } from './artModes.js';

const FRAME = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };
const base = { mode: 'single', ratios: [1.3], frame: FRAME, cropV: 0.13, cropH: 0.25 };

describe('fillDecision crop gate', () => {
  it('enabled:false forces the matted gallery, regardless of budget', () => {
    const d = fillDecision({ ...base, crop: { enabled: false } });
    expect(d.view).toBe('gallery');
    expect(d.qualified).toBe(false);
  });
  it('a band forces framed-cover even when ratio would not qualify', () => {
    // squarish 1.0 ratio would normally stay matted; a band overrides.
    const d = fillDecision({ ...base, ratios: [1.0], crop: { top: 10, bottom: 10 } });
    expect(d.view).toBe('framed-cover');
    expect(d.qualified).toBe(true);
  });
  it('no crop → unchanged auto behavior', () => {
    const d = fillDecision({ ...base, ratios: [1.0] });
    expect(d.view).toBe('gallery'); // 1.0 is squarer than the opening; stays matted
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/fillDecision.crop.test.js`
Expected: FAIL — the crop branches don't exist (band case returns gallery, not framed-cover).

- [ ] **Step 3: Implement**

In `artModes.js`, change the `fillDecision` signature to accept `crop` and add the two gates at the top of the function body (before the existing `const winAR = ...`). The new function:

```javascript
export function fillDecision({ mode, ratios, frame, cropV = 0, cropH = 0, fallback = 'gallery', crop = null }) {
  const fb = modeIndexByName(fallback);
  const matted = () => ({ index: fb, view: VIEW_MODES[fb].name, qualified: false, winAR: null, axis: null, need: null, budget: 0 });

  // Explicit per-work crop overrides the auto gate.
  if (crop && crop.enabled === false) return matted();
  const hasBand = !!crop && crop.enabled !== false
    && (Number.isFinite(crop.top) || Number.isFinite(crop.bottom));
  if (hasBand && mode !== 'diptych') {
    const fc = modeIndexByName('framed-cover');
    return { index: fc, view: VIEW_MODES[fc].name, qualified: true, winAR: null, axis: 'top-bottom', need: null, budget: 0 };
  }

  if (mode === 'diptych' || !(cropV > 0 || cropH > 0) || !ratios?.length) return matted();
  const winAR = (SW - ((frame.left + frame.right) / 100) * SW)
              / (SH - ((frame.top + frame.bottom) / 100) * SH);
  const vertical = ratios[0] <= winAR;
  const axis = vertical ? 'top-bottom' : 'left-right';
  const budget = vertical ? cropV : cropH;
  const need = coverCropPerSide(winAR, ratios[0]);
  const qualified = budget > 0 && need <= budget + 1e-9;
  const index = qualified ? modeIndexByName('framed-cover') : fb;
  return { index, view: VIEW_MODES[index].name, qualified, winAR, axis, need, budget };
}
```

- [ ] **Step 4: Run tests to verify (new + existing engine specs)**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/`
Expected: PASS — the new crop gate tests AND all pre-existing artModes tests (no regression from the refactor).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/widgets/artModes.js frontend/src/screen-framework/widgets/fillDecision.crop.test.js
git commit -m "feat(artmode): fillDecision honors per-work crop (band → cover, disabled → matted)"
```

---

### Task 5: Render the band in ArtMode + ArtLayer

**Files:**
- Modify: `frontend/src/screen-framework/widgets/ArtMode.jsx`
- Modify: `frontend/src/screen-framework/widgets/ArtLayer.jsx`
- Modify: `frontend/src/screen-framework/widgets/ArtMode.css`

This is JSX wiring; verify via the pure helpers (already tested), no engine regressions, and a manual screensaver check.

- [ ] **Step 1: Pass `crop` into the fill decision (ArtMode.jsx)**

In `ArtMode.jsx`, find the `fillDecision({ mode: activeArt.mode, ratios, frame, cropV, cropH, fallback: defaultViewMode })` call (in the per-image view-mode effect). Add `crop`:

```javascript
    const d = fillDecision({ mode: activeArt.mode, ratios, frame, cropV, cropH, fallback: defaultViewMode, crop: ps[0]?.meta?.crop ?? null });
```

- [ ] **Step 2: Add a band-render helper near the top of `ArtMode.jsx`**

After the existing imports/const block (near `DEFAULT_FRAME`), import `openingAspect` and `cropBandFit` (extend the existing `artModes.js` import on line 7):

```javascript
import { VIEW_MODES, modeIndexByName, nextMode, prevMode, objectFitWindows, fillDecision, cropFocus, openingAspect, cropBandFit } from './artModes.js';
```

Add a small pure helper (module scope, after `cropFocus` is imported — e.g. below `DEFAULT_FRAME`):

```javascript
// A panel has an active crop band when cropping (cover) and crop has margins on.
const bandFor = (panel, fit, fullWindow, frame) => {
  const c = panel?.meta?.crop;
  if (fit !== 'cover' || !c || c.enabled === false) return null;
  if (!(Number.isFinite(c.top) || Number.isFinite(c.bottom))) return null;
  const srcRatio = (panel.meta.width > 0 && panel.meta.height > 0) ? panel.meta.width / panel.meta.height : 1;
  return cropBandFit(c, srcRatio, openingAspect({ frame, fullWindow }));
};
```

- [ ] **Step 3: Use the band in the fit-window render (ArtMode.jsx)**

Find the `!isGallery && panels.map((p, i) => { ... })` block (the fit-window path, ~line 622). Replace its `<img>` with a band-aware version:

```javascript
            {!isGallery && panels.map((p, i) => {
              const win = fitWindows[i];
              const band = bandFor(p, mode.fit, mode.fullWindow, frame);
              return (
                <div key={p.image} className="artmode__fitwindow" data-testid={testid('artmode-window', i)}
                     style={{ top: `${win.top}%`, left: `${win.left}%`, right: `${win.right}%`, bottom: `${win.bottom}%` }}>
                  <img className={`artmode__fitimage artmode__fitimage--${band ? 'band' : mode.fit}`}
                       data-testid={testid('artmode-image', i)}
                       src={DaylightMediaPath(p.image)} alt={p.meta?.title || 'Artwork'}
                       style={band
                         ? { transform: band.transform, transformOrigin: band.transformOrigin }
                         : { objectPosition: cropFocus(p.meta?.crop_anchor) || undefined }}
                       onLoad={onLoaded} onError={onLoaded} />
                </div>
              );
            })}
```

- [ ] **Step 4: Mirror the band render in ArtLayer.jsx (crossfade path)**

In `ArtLayer.jsx`, extend the `artModes.js` import to include `openingAspect, cropBandFit`, add the same `bandFor` helper at module scope, and apply it to the fit-window `<img>` (around line 112) exactly as in Step 3 — the band branch sets `style={{ transform, transformOrigin }}` and class `artmode__fitimage--band`, the else branch keeps `objectPosition: cropFocus(...)`.

- [ ] **Step 5: CSS — clip the band to the window (ArtMode.css)**

In `ArtMode.css`, ensure the fit-window clips and the band image fills width from the top-left. Find `.artmode__fitwindow` and add `overflow: hidden;` (if not present), and add:

```css
.artmode__fitimage--band {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: auto;
  object-fit: fill;   /* irrelevant — width:100%/height:auto preserves source aspect */
}
```

> The existing `.artmode__fitwindow` is already `position: relative` (it positions the image); if not, add `position: relative;`. The cover/contain image rules are untouched.

- [ ] **Step 6: Verify no engine regression + frontend build**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/`
Expected: PASS (all existing artmode/artlayer tests).

Run: `npx vite build`
Expected: build succeeds (JSX/imports resolve).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screen-framework/widgets/ArtMode.jsx frontend/src/screen-framework/widgets/ArtLayer.jsx frontend/src/screen-framework/widgets/ArtMode.css
git commit -m "feat(artmode): render per-work vertical crop band (cover transform)"
```

---

## Phase C — Library crop editor

### Task 6: `cropGeometry` pure helpers

**Files:**
- Create: `frontend/src/modules/Admin/Art/cropGeometry.js`
- Test: `frontend/src/modules/Admin/Art/cropGeometry.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Admin/Art/cropGeometry.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { clampBand, pxToBand, bandToPx } from './cropGeometry.js';

describe('clampBand', () => {
  it('keeps margins in [0,90] and the sum ≤ 90', () => {
    expect(clampBand({ top: -5, bottom: 10 })).toEqual({ top: 0, bottom: 10 });
    expect(clampBand({ top: 95, bottom: 0 })).toEqual({ top: 90, bottom: 0 });
    expect(clampBand({ top: 70, bottom: 40 })).toEqual({ top: 70, bottom: 20 }); // sum capped at 90
  });
});

describe('px ⇄ band (imageHeightPx = 200)', () => {
  it('pxToBand converts top/bottom handle px to margin %', () => {
    expect(pxToBand({ topPx: 20, bottomPx: 40 }, 200)).toEqual({ top: 10, bottom: 20 });
  });
  it('bandToPx is the inverse', () => {
    expect(bandToPx({ top: 10, bottom: 20 }, 200)).toEqual({ topPx: 20, bottomPx: 40 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/cropGeometry.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Admin/Art/cropGeometry.js`:

```javascript
// Pure geometry for the crop editor: clamp a band and convert between handle
// pixel offsets (within the displayed image) and margin percentages of height.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const r2 = (n) => Number(n.toFixed(2));

// Keep each margin in [0,90]; if they'd keep <10% of height, shrink `bottom`.
export function clampBand({ top, bottom }) {
  let t = clamp(Number(top) || 0, 0, 90);
  let b = clamp(Number(bottom) || 0, 0, 90);
  if (t + b > 90) b = 90 - t;
  return { top: r2(t), bottom: r2(b) };
}

// Handle pixel offsets (from the top / from the bottom of the displayed image) → %.
export function pxToBand({ topPx, bottomPx }, imageHeightPx) {
  const h = imageHeightPx || 1;
  return clampBand({ top: (topPx / h) * 100, bottom: (bottomPx / h) * 100 });
}

// % margins → handle pixel offsets within a displayed image of imageHeightPx.
export function bandToPx({ top, bottom }, imageHeightPx) {
  const h = imageHeightPx || 1;
  return { topPx: r2((top / 100) * h), bottomPx: r2((bottom / 100) * h) };
}

export default { clampBand, pxToBand, bandToPx };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/cropGeometry.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Admin/Art/cropGeometry.js frontend/src/modules/Admin/Art/cropGeometry.test.js
git commit -m "feat(art-admin): pure crop-band geometry helpers"
```

---

### Task 7: `CropEditor` overlay component

**Files:**
- Create: `frontend/src/modules/Admin/Art/CropEditor.jsx`
- Test: `frontend/src/modules/Admin/Art/CropEditor.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Admin/Art/CropEditor.test.jsx`:

```javascript
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CropEditor from './CropEditor.jsx';

describe('CropEditor', () => {
  it('"Don\'t crop" writes crop.enabled:false', () => {
    const onCrop = vi.fn();
    render(<CropEditor crop={null} onCrop={onCrop} />);
    fireEvent.click(screen.getByLabelText(/don.t crop/i));
    expect(onCrop).toHaveBeenCalledWith({ enabled: false });
  });

  it('"Reset to auto" clears the crop (null)', () => {
    const onCrop = vi.fn();
    render(<CropEditor crop={{ enabled: false }} onCrop={onCrop} />);
    fireEvent.click(screen.getByText(/reset to auto/i));
    expect(onCrop).toHaveBeenCalledWith(null);
  });

  it('keyboard-nudging a handle writes an adjusted band', () => {
    const onCrop = vi.fn();
    render(<CropEditor crop={{ enabled: true, top: 10, bottom: 10 }} onCrop={onCrop} />);
    const topHandle = screen.getByTestId('crop-handle-top');
    fireEvent.keyDown(topHandle, { key: 'ArrowDown' }); // +1% top margin
    expect(onCrop).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, top: 11, bottom: 10 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/CropEditor.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Admin/Art/CropEditor.jsx`:

```javascript
import React, { useCallback, useRef, useState } from 'react';
import { clampBand } from './cropGeometry.js';

// Overlay on the loupe artwork: drag (or keyboard-nudge) the top/bottom edges of
// the keep-window to set the crop band; toggle "Don't crop"; reset to auto.
// Geometry is in % of the displayed image height, so it's resolution-independent.
export default function CropEditor({ crop, onCrop }) {
  const disabled = crop?.enabled === false;
  const top = Number.isFinite(crop?.top) ? crop.top : 8;
  const bottom = Number.isFinite(crop?.bottom) ? crop.bottom : 8;
  const stageRef = useRef(null);
  const dragRef = useRef(null); // { edge, startY, startTop, startBottom, h }

  const commit = useCallback((band) => {
    onCrop({ enabled: true, ...clampBand(band) });
  }, [onCrop]);

  const onHandleKey = useCallback((edge) => (e) => {
    const step = e.shiftKey ? 0.2 : 1;
    let d = 0;
    if (e.key === 'ArrowUp') d = -step;
    else if (e.key === 'ArrowDown') d = step;
    else return;
    e.preventDefault();
    if (edge === 'top') commit({ top: top + d, bottom });
    else commit({ top, bottom: bottom + d });
  }, [top, bottom, commit]);

  const onPointerDown = useCallback((edge) => (e) => {
    e.preventDefault();
    const h = stageRef.current?.clientHeight || 1;
    dragRef.current = { edge, startY: e.clientY, startTop: top, startBottom: bottom, h };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaPct = ((ev.clientY - d.startY) / d.h) * 100;
      if (d.edge === 'top') commit({ top: d.startTop + deltaPct, bottom: d.startBottom });
      else commit({ top: d.startTop, bottom: d.startBottom - deltaPct });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [top, bottom, commit]);

  return (
    <div className="crop-editor" ref={stageRef} data-testid="crop-editor">
      {!disabled && (
        <>
          <div className="crop-editor__shade crop-editor__shade--top" style={{ height: `${top}%` }} />
          <div className="crop-editor__shade crop-editor__shade--bottom" style={{ height: `${bottom}%` }} />
          <div className="crop-editor__window" style={{ top: `${top}%`, bottom: `${bottom}%` }}>
            <button type="button" data-testid="crop-handle-top" className="crop-editor__handle crop-editor__handle--top"
              aria-label="Top crop edge" onPointerDown={onPointerDown('top')} onKeyDown={onHandleKey('top')} />
            <button type="button" data-testid="crop-handle-bottom" className="crop-editor__handle crop-editor__handle--bottom"
              aria-label="Bottom crop edge" onPointerDown={onPointerDown('bottom')} onKeyDown={onHandleKey('bottom')} />
            <span className="crop-editor__readout">top {top}% · bottom {bottom}%</span>
          </div>
        </>
      )}
      <div className="crop-editor__controls">
        <label className="crop-editor__toggle">
          <input type="checkbox" checked={disabled}
            onChange={(e) => { const off = e.currentTarget.checked; onCrop(off ? { enabled: false } : { enabled: true, top, bottom }); }} />
          Don&apos;t crop (matted)
        </label>
        <button type="button" className="crop-editor__reset" onClick={() => onCrop(null)}>Reset to auto</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/CropEditor.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Add styles + commit**

Append to `frontend/src/modules/Admin/Art/Art.scss`:

```scss
.crop-editor { position: absolute; inset: 0; }
.crop-editor__shade { position: absolute; left: 0; right: 0; background: rgba(0,0,0,.55); pointer-events: none; }
.crop-editor__shade--top { top: 0; }
.crop-editor__shade--bottom { bottom: 0; }
.crop-editor__window { position: absolute; left: 0; right: 0; border: 2px solid #4ad; box-shadow: 0 0 0 1px rgba(0,0,0,.6); }
.crop-editor__handle { position: absolute; left: 50%; transform: translateX(-50%); width: 54px; height: 12px;
  background: #4ad; border: none; border-radius: 4px; cursor: ns-resize; padding: 0; }
.crop-editor__handle--top { top: -6px; }
.crop-editor__handle--bottom { bottom: -6px; }
.crop-editor__handle:focus { outline: 2px solid #fff; }
.crop-editor__readout { position: absolute; top: 4px; left: 6px; font-size: 11px; color: #bdf; }
.crop-editor__controls { position: absolute; bottom: 8px; right: 8px; display: flex; gap: 10px; align-items: center;
  font-size: 12px; background: rgba(0,0,0,.5); padding: 4px 8px; border-radius: 4px; }
.crop-editor__toggle { display: flex; gap: 6px; align-items: center; cursor: pointer; }
```

```bash
git add frontend/src/modules/Admin/Art/CropEditor.jsx frontend/src/modules/Admin/Art/CropEditor.test.jsx frontend/src/modules/Admin/Art/Art.scss
git commit -m "feat(art-admin): draggable CropEditor overlay (band + don't-crop + reset)"
```

---

### Task 8: Mount the editor in the loupe

**Files:**
- Modify: `frontend/src/modules/Admin/Art/Loupe.jsx`
- Modify: `frontend/src/modules/Admin/Art/ArtLibrary.jsx`
- Test: `frontend/src/modules/Admin/Art/ArtLibrary.test.jsx` (extend)

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/modules/Admin/Art/ArtLibrary.test.jsx` (inside the existing `describe('ArtLibrary', ...)`):

```javascript
  it('toggling "Don\'t crop" PATCHes crop.enabled:false', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Sunrise')).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/don.t crop/i));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('api/v1/admin/art/works/a', { crop: { enabled: false } }, 'PATCH'));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/ArtLibrary.test.jsx`
Expected: FAIL — no "Don't crop" control rendered yet.

- [ ] **Step 3: Wire `onCrop` in ArtLibrary**

In `ArtLibrary.jsx`, add a crop handler next to `setAnchor`:

```javascript
  const setCrop = useCallback(async (crop) => {
    await mutate({ crop });
    flash();
  }, [mutate, flash]);
```

Add `setCrop` to the `onAction` dependency array is not needed (it's not used there). Pass it to `Loupe`:

```javascript
            ? <Loupe work={focused} total={works.length} index={index} saved={saved} onAnchor={setAnchor} onCrop={setCrop} />
```

- [ ] **Step 4: Mount `CropEditor` in Loupe**

In `Loupe.jsx`, import the editor and render it over the stage (replacing the anchor compass when an `onCrop` is provided). Add the import:

```javascript
import CropEditor from './CropEditor.jsx';
```

Change the signature to accept `onCrop` and render `CropEditor` inside `.art-loupe__stage` instead of the compass:

```javascript
export default function Loupe({ work, total, index, saved, onAnchor, onCrop }) {
  if (!work) return <div className="art-loupe art-loupe--empty">No artwork</div>;
  const m = work.meta || {};
  const active = anchorOrCenter(m.crop_anchor);
  return (
    <div className="art-loupe">
      <div className="art-loupe__stage">
        <img key={work.id} className="art-loupe__img"
          src={DaylightMediaPath(work.image)} alt={m.title || 'Artwork'} />
        {onCrop
          ? <CropEditor crop={m.crop} onCrop={onCrop} />
          : (
            <div className="art-loupe__compass" role="group" aria-label="Set crop anchor">
              {COMPASS.flat().map((pos) => (
                <button type="button" key={pos}
                  className={`art-loupe__cell${pos === active ? ' is-active' : ''}`}
                  title={`Anchor: ${pos}`} onClick={() => onAnchor?.(pos)}>
                  <span className="art-loupe__cell-dot" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
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
          <span className="art-pill">{m.crop?.enabled === false ? 'no-crop' : (Number.isFinite(m.crop?.top) ? `crop ${m.crop.top}/${m.crop.bottom}` : `anchor: ${active}`)}</span>
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes (+ full Art suite)**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Admin/Art/`
Expected: PASS (all Art tests, including the new crop toggle).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Admin/Art/Loupe.jsx frontend/src/modules/Admin/Art/ArtLibrary.jsx frontend/src/modules/Admin/Art/ArtLibrary.test.jsx
git commit -m "feat(art-admin): mount CropEditor on the loupe (auto-saving crop)"
```

---

## Phase D — Verify, build, deploy

### Task 9: Full suite, build, deploy, manual verify

- [ ] **Step 1: Run all affected suites**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/unit/art/ tests/isolated/api/admin-art-router.test.mjs \
  frontend/src/screen-framework/widgets/ frontend/src/modules/Admin/Art/
```
Expected: all PASS. Then the existing jest art suite:
`npx jest tests/unit/adapters/art/`
Expected: PASS.

- [ ] **Step 2: Build**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

- [ ] **Step 3: Confirm deploy gate clear, then deploy** (per CLAUDE.local.md — never redeploy during an active fitness session or playing video):

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
# clear ⇒ 0 render lines, no videoState:"playing", sessionActive:false, rosterSize:0
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 4: Manual verify**

Open `/admin/content/art`, hard-refresh. On a tall landscape:
- Drag the top/bottom handles; the dimmed zones and `top%/bottom%` readout update; release auto-saves (verify `metadata.yaml` via `sudo docker exec daylight-station sh -c 'cat media/img/art/classic/<folder>/metadata.yaml'`).
- Open ArtMode (home screensaver) on that collection and confirm the work shows exactly the chosen band (cover-filled, no mat).
- Toggle "Don't crop" → confirm the work shows matted in ArtMode; "Reset to auto" → back to default.

- [ ] **Step 5: Reload the garage fitness display is NOT needed** (this is the home screensaver / admin, not `frontend/src/modules/Fitness/`). No garage reload step.

---

## Self-Review (plan author)

**Spec coverage:**
- `crop` model (enabled/top/bottom, ≥10% keep) → Tasks 1, 2 (surface + validate/persist). ✓
- Backend surface + validate + persist, no new endpoints → Tasks 1, 2. ✓
- Engine: `fillDecision` gate (enabled:false→matted, band→cover) → Task 4; band render via pure helper → Tasks 3, 5. ✓
- `<img onLoad>` still drives the curtain reveal → Task 5 keeps `onLoad`/`onError` on the band image. ✓
- Loupe editor (drag slide+resize via independent top/bottom handles, dim zones, readout, keyboard nudge, don't-crop, reset, auto-save) → Tasks 6, 7, 8. ✓
- Geometry in a tested helper → Task 6. ✓
- Left/right reserved, no UI → model carries left/right (Tasks 1,2,`isValidCrop`); editor writes vertical only. ✓
- Tests: backend round-trip/validation, engine band+gate math, frontend geometry+editor → Tasks 1–8. ✓

**Placeholder scan:** none — every code step is complete.

**Type/name consistency:** `crop` shape `{enabled, top, bottom, left, right}` is consistent across `normalizeCrop`, `isValidCrop`, `fillDecision({crop})`, `bandFor`, `cropBandFit`, `CropEditor`, `clampBand`. Helper names: `openingAspect`, `cropBandFit`, `clampBand`, `pxToBand`, `bandToPx`, `setCrop`/`onCrop` — used identically where referenced.
