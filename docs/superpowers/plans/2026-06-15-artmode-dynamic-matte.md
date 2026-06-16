# ArtMode Dynamic Matte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Color the ArtMode matte (paper plane + beveled cut) from the painting itself — a muted match for colorful art, warm browns for near-greyscale — never vibrant.

**Architecture:** A pure `deriveMatte(avgRGB)` domain function turns a painting's average color into a guardrailed muted palette. The art adapter computes the average color with `jimp` (cached per folder) and returns `color` + `matte` on `/api/v1/art/featured`. ArtMode applies the palette as CSS custom properties, with the current cream as fallback.

**Tech Stack:** Node/Express (ESM `.mjs`), `jimp` (pure-JS image read), Jest (backend tests), React + Vitest (frontend).

---

## File Structure

**Create:**
- `backend/src/2_domains/art/deriveMatte.mjs` — pure color math: `deriveMatte(avgRGB)` → muted palette; plus exported `rgbToHsv` helper. No I/O.
- `tests/unit/art/deriveMatte.test.mjs` — pure unit tests (Jest).

**Modify:**
- `backend/src/1_adapters/content/art/ArtAdapter.mjs` — compute average color via `jimp`, derive matte, cache per folder, return `color` + `matte`.
- `tests/unit/adapters/art/ArtAdapter.test.mjs` — add color/matte assertions (real images via `jimp`).
- `frontend/src/screen-framework/widgets/ArtMode.jsx` — apply `matte` as CSS custom properties on the root.
- `frontend/src/screen-framework/widgets/ArtMode.css` — matte/cut colors read from custom properties (cream fallbacks).
- `frontend/src/screen-framework/widgets/ArtMode.test.jsx` — assert custom properties are applied.

**Unchanged:** `backend/src/4_api/v1/routers/art.mjs` (it already returns whatever the adapter returns).

**Conventions:** Backend tests run under Jest (`testEnvironment: node`); use **relative imports** (not `#` aliases). `jimp` exposes `require('jimp').Jimp` (CJS-compatible). Frontend tests run under Vitest.

---

## Task 1: `deriveMatte` pure function

**Files:**
- Create: `backend/src/2_domains/art/deriveMatte.mjs`
- Test: `tests/unit/art/deriveMatte.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/deriveMatte.test.mjs`:

```javascript
import { deriveMatte, rgbToHsv } from '../../../backend/src/2_domains/art/deriveMatte.mjs';

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const sum = (rgb) => rgb[0] + rgb[1] + rgb[2];
const satOf = (hex) => rgbToHsv(hexToRgb(hex))[1];
const valOf = (hex) => rgbToHsv(hexToRgb(hex))[2];

describe('deriveMatte', () => {
  it('near-greyscale → warm neutral (brown), R>=G>=B', () => {
    const m = deriveMatte([200, 198, 195]); // saturation ~0.025
    expect(m.branch).toBe('neutral');
    const [r, g, b] = hexToRgb(m.base);
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThanOrEqual(b); // warm: amber/brown
  });

  it('colorful cool → match, hue preserved (blue), muted', () => {
    const m = deriveMatte([117, 135, 156]); // cool blue, sat ~0.25
    expect(m.branch).toBe('match');
    const [r, g, b] = hexToRgb(m.base);
    expect(b).toBeGreaterThan(r); // still cool
    expect(b).toBeGreaterThan(g);
    expect(satOf(m.base)).toBeLessThanOrEqual(0.19); // sat ceiling 0.18 (+rounding)
    expect(valOf(m.base)).toBeGreaterThanOrEqual(0.29);
    expect(valOf(m.base)).toBeLessThanOrEqual(0.53);
  });

  it('guardrail: a vivid input never yields a vibrant matte', () => {
    const m = deriveMatte([255, 0, 0]); // pure red, sat 1.0
    expect(satOf(m.base)).toBeLessThanOrEqual(0.19);
    expect(valOf(m.base)).toBeLessThanOrEqual(0.53);
  });

  it('mat brightness tracks the painting (dark < light)', () => {
    const dark = deriveMatte([20, 40, 60]);
    const light = deriveMatte([150, 175, 205]);
    expect(valOf(dark.base)).toBeLessThan(valOf(light.base));
  });

  it('bevel ordering: bottom (lit) > base > top (shadow)', () => {
    const m = deriveMatte([117, 135, 156]);
    expect(sum(hexToRgb(m.bevelBottom))).toBeGreaterThan(sum(hexToRgb(m.base)));
    expect(sum(hexToRgb(m.base))).toBeGreaterThan(sum(hexToRgb(m.bevelTop)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/art/deriveMatte.test.mjs`
Expected: FAIL — `Cannot find module '.../deriveMatte.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/2_domains/art/deriveMatte.mjs`:

```javascript
/**
 * deriveMatte — pure color math. Given a painting's average RGB, return a
 * muted matte palette (paper plane + beveled cut). No I/O.
 *
 * - Colorful paintings → "match": the painting's own hue, clamped muted.
 * - Near-greyscale paintings → "neutral": warm browns/cream.
 * Mat brightness tracks the painting's lightness. Nothing vibrant escapes.
 */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max]; // all 0..1
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (((i % 6) + 6) % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [r * 255, g * 255, b * 255];
}

const toHex = (rgb) =>
  '#' + rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('');

// Multiply an RGB color's HSL lightness by `factor`, return RGB.
function adjustLightness([r, g, b], factor) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const nl = clamp(l * factor, 0, 1);
  const c = (1 - Math.abs(2 * nl - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = nl - c / 2;
  const hp = h * 6;
  let rr, gg, bb;
  if (hp < 1) [rr, gg, bb] = [c, x, 0];
  else if (hp < 2) [rr, gg, bb] = [x, c, 0];
  else if (hp < 3) [rr, gg, bb] = [0, c, x];
  else if (hp < 4) [rr, gg, bb] = [0, x, c];
  else if (hp < 5) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
  return [(rr + m) * 255, (gg + m) * 255, (bb + m) * 255];
}

// Track painting lightness `v` into a muted band [lo, hi].
function mapValue(v, lo, hi) {
  const vc = clamp(v, 0.20, 0.85);
  return lo + ((vc - 0.20) / (0.85 - 0.20)) * (hi - lo);
}

const SAT_CEIL = 0.18;
const GREYSCALE = 0.10;

export function deriveMatte(avgRGB) {
  const [h, s, v] = rgbToHsv(avgRGB);
  let H, S, V, branch;
  if (s < GREYSCALE) {
    H = 30 / 360; S = 0.13; V = mapValue(v, 0.30, 0.60); branch = 'neutral';
  } else {
    H = h; S = Math.min(s, SAT_CEIL); V = mapValue(v, 0.30, 0.52); branch = 'match';
  }
  const baseRgb = hsvToRgb(H, S, V);
  return {
    branch,
    base: toHex(baseRgb),
    glow: toHex(adjustLightness(baseRgb, 1.16)),
    edge: toHex(adjustLightness(baseRgb, 0.82)),
    bevelTop: toHex(adjustLightness(baseRgb, 0.80)),
    bevelLeft: toHex(adjustLightness(baseRgb, 0.88)),
    bevelRight: toHex(adjustLightness(baseRgb, 1.12)),
    bevelBottom: toHex(adjustLightness(baseRgb, 1.20)),
  };
}

export default deriveMatte;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/art/deriveMatte.test.mjs`
Expected: PASS (5 passing). Confirm the actual "Tests: 5 passed" line.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/art/deriveMatte.mjs tests/unit/art/deriveMatte.test.mjs
git commit -m "feat(art): deriveMatte — muted matte palette from a painting's average color

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Color analysis in the adapter (jimp) + API

**Files:**
- Modify: `backend/src/1_adapters/content/art/ArtAdapter.mjs`
- Test: `tests/unit/adapters/art/ArtAdapter.test.mjs`

- [ ] **Step 1: Write the failing test**

Add these imports at the top of `tests/unit/adapters/art/ArtAdapter.test.mjs` (after the existing imports):

```javascript
import { Jimp } from 'jimp';

// Write a real solid-color PNG so jimp's average matches the input color.
const writeSolidArt = async (folder, [r, g, b], metaYaml) => {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  const color = (r << 24) | (g << 16) | (b << 8) | 0xff; // RGBA
  const img = new Jimp({ width: 16, height: 12, color: color >>> 0 });
  await img.write(path.join(dir, 'art.png'));
  fs.writeFileSync(path.join(dir, 'metadata.yaml'), metaYaml);
};
```

Add these tests inside the `describe('ArtAdapter', ...)` block:

```javascript
  it('returns color + matte for the selected painting (match branch)', async () => {
    await writeSolidArt('Cool - 1900 - Blue', [117, 135, 156], metaYaml(1500, 1000));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const result = await adapter.selectFeatured({ pick: (arr) => arr[0] });

    expect(result.color.average).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(result.color.average.slice(i, i + 2), 16));
    expect(Math.abs(r - 117)).toBeLessThanOrEqual(6);
    expect(Math.abs(g - 135)).toBeLessThanOrEqual(6);
    expect(Math.abs(b - 156)).toBeLessThanOrEqual(6);
    expect(result.matte.branch).toBe('match');
    expect(result.matte.base).toMatch(/^#[0-9a-f]{6}$/);
    expect(result.matte.bevelTop).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('uses the warm-neutral branch for a near-greyscale painting', async () => {
    await writeSolidArt('Grey - 1900 - Stone', [180, 178, 176], metaYaml(1500, 1000));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const result = await adapter.selectFeatured({ pick: (arr) => arr[0] });
    expect(result.matte.branch).toBe('neutral');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/adapters/art/ArtAdapter.test.mjs`
Expected: FAIL — `result.color` is undefined (adapter doesn't return it yet).

- [ ] **Step 3: Implement color analysis in the adapter**

In `backend/src/1_adapters/content/art/ArtAdapter.mjs`, add imports after the existing `import yaml from 'js-yaml';` line:

```javascript
import { Jimp } from 'jimp';
import { deriveMatte, rgbToHsv } from '../../../2_domains/art/deriveMatte.mjs';
```

Add a per-folder color cache. Find:

```javascript
  const artDir = path.join(imgBasePath, 'art', 'classic');
  let eligibleCache = null; // [{ folder, meta }] — built once, reused
```

Replace with:

```javascript
  const artDir = path.join(imgBasePath, 'art', 'classic');
  let eligibleCache = null; // [{ folder, meta }] — built once, reused
  const colorCache = new Map(); // folder → { color, matte }

  async function analyzeColor(imagePath) {
    const img = await Jimp.read(imagePath);
    const small = img.resize({ w: 32, h: 32 });
    const d = small.bitmap.data; // RGBA
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const avg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    const [h, s, v] = rgbToHsv(avg);
    const color = {
      average: '#' + avg.map((c) => c.toString(16).padStart(2, '0')).join(''),
      hue: Math.round(h * 360),
      saturation: Math.round(s * 1000) / 1000,
      value: Math.round(v * 1000) / 1000,
    };
    return { color, matte: deriveMatte(avg) };
  }
```

Find the end of `selectFeatured` where it returns:

```javascript
    const image =
      `/media/img/art/classic/${encodeURIComponent(chosen.folder)}/${encodeURIComponent(imageFile)}`;
    return { image, meta: chosen.meta };
```

Replace with:

```javascript
    const image =
      `/media/img/art/classic/${encodeURIComponent(chosen.folder)}/${encodeURIComponent(imageFile)}`;

    let palette = colorCache.get(chosen.folder);
    if (!palette) {
      try {
        palette = await analyzeColor(path.join(folderPath, imageFile));
        colorCache.set(chosen.folder, palette);
      } catch (err) {
        logger.warn?.('art.color.failed', { folder: chosen.folder, error: err.message });
        palette = { color: null, matte: null };
      }
    }
    return { image, meta: chosen.meta, color: palette.color, matte: palette.matte };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/adapters/art/ArtAdapter.test.mjs`
Expected: PASS (all prior tests + the 2 new ones). Confirm the "Tests: N passed" line.

- [ ] **Step 5: Verify live (if a backend is running)**

If a dev/prod backend is on port 3111: `curl -s http://localhost:3111/api/v1/art/featured | python3 -m json.tool` and confirm the response now includes `color` and `matte` objects. If no server is running, skip (the unit test is authoritative).

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/content/art/ArtAdapter.mjs tests/unit/adapters/art/ArtAdapter.test.mjs
git commit -m "feat(art): analyze average color (jimp) and return color + matte palette

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: ArtMode applies the matte palette

**Files:**
- Modify: `frontend/src/screen-framework/widgets/ArtMode.jsx`
- Modify: `frontend/src/screen-framework/widgets/ArtMode.css`
- Test: `frontend/src/screen-framework/widgets/ArtMode.test.jsx`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('ArtMode', ...)` block in `frontend/src/screen-framework/widgets/ArtMode.test.jsx`:

```javascript
  it('applies the matte palette as CSS custom properties', async () => {
    DaylightAPI.mockResolvedValue({
      image: '/x.jpg',
      meta: { title: 'T', artist: 'A', date: '1' },
      color: { average: '#75879c', hue: 212, saturation: 0.25, value: 0.61 },
      matte: {
        branch: 'match', base: '#58616b', glow: '#6b7682', edge: '#474e56',
        bevelTop: '#474e56', bevelLeft: '#4e555d', bevelRight: '#626c77', bevelBottom: '#6b7682',
      },
    });
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    const root = getByTestId('artmode');
    expect(root.style.getPropertyValue('--matte-base')).toBe('#58616b');
    expect(root.style.getPropertyValue('--cut-top')).toBe('#474e56');
    expect(root.style.getPropertyValue('--cut-bottom')).toBe('#6b7682');
  });

  it('sets no matte custom properties when matte is absent', async () => {
    DaylightAPI.mockResolvedValue({ image: '/x.jpg', meta: { title: 'T', artist: 'A', date: '1' } });
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode').style.getPropertyValue('--matte-base')).toBe('');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx`
Expected: FAIL — `--matte-base` is empty (ArtMode doesn't set it yet).

- [ ] **Step 3: Apply the palette in ArtMode.jsx**

In `frontend/src/screen-framework/widgets/ArtMode.jsx`, find the `dims` memo:

```javascript
  const dims = useMemo(() => {
    const w = art?.meta?.width;
    const h = art?.meta?.height;
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
  }, [art]);
```

Add directly below it:

```javascript
  // Map the API matte palette to CSS custom properties on the root. Absent →
  // undefined, so the stylesheet's cream fallbacks apply.
  const matteVars = useMemo(() => {
    const m = art?.matte;
    if (!m) return undefined;
    return {
      '--matte-base': m.base,
      '--matte-glow': m.glow,
      '--matte-edge': m.edge,
      '--cut-top': m.bevelTop,
      '--cut-left': m.bevelLeft,
      '--cut-right': m.bevelRight,
      '--cut-bottom': m.bevelBottom,
    };
  }, [art]);
```

Find the root element:

```javascript
    <div className="artmode" data-testid="artmode">
```

Replace with:

```javascript
    <div className="artmode" data-testid="artmode" style={matteVars}>
```

- [ ] **Step 4: Wire the custom properties into ArtMode.css**

In `frontend/src/screen-framework/widgets/ArtMode.css`, replace the `.artmode__matte` rule:

```css
.artmode__matte {
  position: absolute;
  inset: 0;
  background-color: #e7dcc1;
  background-image:
    radial-gradient(ellipse 80% 80% at 50% 40%,
      rgba(255, 252, 243, 0.78),
      rgba(206, 190, 156, 0.20) 68%,
      rgba(116, 100, 68, 0.42)),
    var(--paper-noise);
  background-size: cover, 180px 180px;
  background-blend-mode: multiply, multiply;
}
```

with:

```css
.artmode__matte {
  position: absolute;
  inset: 0;
  background-color: var(--matte-base, #e7dcc1);
  background-image:
    radial-gradient(ellipse 90% 90% at 50% 42%,
      var(--matte-glow, #f3ecd9),
      var(--matte-base, #e7dcc1) 55%,
      var(--matte-edge, #b3a079)),
    var(--paper-noise);
  background-size: cover, 180px 180px;
  background-blend-mode: normal, multiply;
}
```

Then replace the four `border-*-color` lines in `.artmode__cut`:

```css
  border-top-color: #d0c5a2;       /* gently shaded cream (top wall) */
  border-left-color: #dacfae;      /* slightly shaded cream (left wall) */
  border-right-color: #ece4ce;     /* barely-lit cream (right wall) */
  border-bottom-color: #f0e9d5;    /* barely-lit cream (bottom wall) */
```

with:

```css
  border-top-color: var(--cut-top, #d0c5a2);       /* shaded (top wall) */
  border-left-color: var(--cut-left, #dacfae);     /* shaded (left wall) */
  border-right-color: var(--cut-right, #ece4ce);   /* lit (right wall) */
  border-bottom-color: var(--cut-bottom, #f0e9d5); /* lit (bottom wall) */
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx`
Expected: PASS (all prior ArtMode tests + the 2 new ones).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screen-framework/widgets/ArtMode.jsx frontend/src/screen-framework/widgets/ArtMode.css frontend/src/screen-framework/widgets/ArtMode.test.jsx
git commit -m "feat(art): tint the matte + bevel from the painting's derived palette

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** color analysis via jimp cached per folder (Task 2); pure guardrailed `deriveMatte` with match/neutral branches, sat ≤ 0.18, value band, lightness tracking (Task 1); API returns `color` + `matte` (Task 2); ArtMode applies CSS vars with cream fallback (Task 3). Bevel tints derived from base (Task 1). Match vs neutral threshold `sat < 0.10`, neutral hue 30°, all per spec.
- **Spec simplification (noted):** the spec's `glow`/`edge` are returned by `deriveMatte` and drive the radial-gradient stops (center/outer) so the plane keeps tonal depth in the mat's own color; `base` is the mid stop and the background-color fallback. No accent palette / lightness-range (explicitly deferred).
- **Type consistency:** `deriveMatte(avgRGB)` → `{ branch, base, glow, edge, bevelTop, bevelLeft, bevelRight, bevelBottom }` (all hex) used identically in the adapter response and the ArtMode `matteVars` mapping (`bevelTop`→`--cut-top`, etc.); `rgbToHsv` exported once and reused by the adapter's `color` object.
