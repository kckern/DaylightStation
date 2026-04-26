# ArcadeSelector Tall-Tile Row Spans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow tall (portrait) tiles in `ArcadeSelector` to span two adjacent rows so that tall, square, and wide thumbnails coexist in a single justified-rows layout without distorting aspect ratios or wasting vertical space.

**Architecture:** Extract the inline layout `useEffect` from `ArcadeSelector.jsx` into a pure module (`arcadePacker.js`). Generalize the layout primitive from "row" to "band". A band is either `single` (one row, current behavior) or `double` (two adjacent rows that share one tall tile spanning both). Each band has a closed-form solver that fixes container width `W` and derives heights, exactly mirroring the existing single-row math. The renderer keeps emitting `{idx, x, y, w, h}` placements so `ArcadeSelector.jsx`'s render path is untouched.

**Tech Stack:** Plain ES modules in `frontend/src/`, Jest with `@jest/globals` for unit tests (matches `tests/isolated/frontend/playlistVirtualSeasons.test.mjs`).

---

## File Structure

**Create:**
- `frontend/src/modules/Menu/arcadePacker.js` — pure packer (`packLayout`, `classifyItems`, `solveSingleBand`, `solveDoubleBand`, `buildBands`, `renderBands`).
- `tests/isolated/frontend/arcadePacker.test.mjs` — unit tests for every export.

**Modify:**
- `frontend/src/modules/Menu/ArcadeSelector.jsx` — replace the inline layout `useEffect` (lines 309–436) with a call to `packLayout(...)`. No other code in this file changes.

---

## Closed-Form Math (reference for Tasks 3 & 4)

**Single-row band** (n tiles with ratios `r_i = h/w`):
```
rowH = (W − (n−1)·GAP) / Σ(1/r_i)
tile_w_i = rowH / r_i
```

**Double-row band** (1 tall tile of ratio `r_t`, `n_u` upper non-tall tiles, `n_l` lower non-tall tiles):

Let `S_t = 1/r_t`, `S_u = Σ(1/r_u_i)`, `S_l = Σ(1/r_l_i)`, `K = 1/S_u + 1/S_l`,
`g_u = n_u` (one gap between tall and upper-row tiles + `n_u − 1` between them = `n_u`),
`g_l = n_l`.

```
H_pair  = [W·K − GAP·(g_u/S_u + g_l/S_l − 1)] / (1 + S_t·K)
w_t     = H_pair / r_t
upper_h = (W − w_t − g_u·GAP) / S_u
lower_h = H_pair − GAP − upper_h     (also equals (W − w_t − g_l·GAP) / S_l)
```

Worked sanity check (Task 4 will encode this): `r_t=2`, two square upper, two square lower, `W=1000`, `GAP=10` → `H_pair=660`, `w_t=330`, `upper_h=lower_h=325`, both rows sum to 1000.

Required for validity: `n_u ≥ 1`, `n_l ≥ 1`, all derived heights `> 0`, all derived widths `> 0`.

---

## Task 1: Extract existing packer to a pure module (refactor)

**Goal:** Move the existing layout logic out of the `useEffect` with zero behavior change. Establish a golden test that locks current output, so later tasks can refactor freely.

**Files:**
- Create: `frontend/src/modules/Menu/arcadePacker.js`
- Create: `tests/isolated/frontend/arcadePacker.test.mjs`
- Modify: `frontend/src/modules/Menu/ArcadeSelector.jsx:309-436`

- [ ] **Step 1: Create the new module with the existing logic copied verbatim**

Create `frontend/src/modules/Menu/arcadePacker.js`:

```javascript
// Pure layout primitives for ArcadeSelector. No React, no DOM.
// `random` is injectable so callers (and tests) can control determinism.

const DEFAULT_GAP = 3;
const DEFAULT_MAX_ROW_PCT = 0.25;
const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_MIN_PER_ROW = 3;

export function packLayout({
  itemRatios,
  W,
  H,
  gap = DEFAULT_GAP,
  maxRowPct = DEFAULT_MAX_ROW_PCT,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  minPerRow = DEFAULT_MIN_PER_ROW,
  random = Math.random,
} = {}) {
  if (!itemRatios?.length || W <= 0 || H <= 0) return [];
  const N = itemRatios.length;
  let bestPlacements = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const shuffled = itemRatios.map((_, i) => i);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const maxRows = Math.min(Math.ceil(N / 2), Math.floor(H / 30));
    let attemptBest = null;
    let attemptScore = -Infinity;

    for (let targetRows = 2; targetRows <= maxRows; targetRows++) {
      const refH = (H - (targetRows - 1) * gap) / targetRows;
      const rows = [];
      let row = [];
      let rowW = 0;
      for (const idx of shuffled) {
        const tw = refH / itemRatios[idx];
        if (row.length > 0 && rowW + gap + tw > W) {
          rows.push(row);
          row = [idx];
          rowW = tw;
        } else {
          rowW += (row.length > 0 ? gap : 0) + tw;
          row.push(idx);
        }
      }
      if (row.length) rows.push(row);

      while (rows.length > 1 && rows[rows.length - 1].length < minPerRow) {
        const last = rows.pop();
        rows[rows.length - 1].push(...last);
      }

      const rowData = rows.map(indices => {
        const gaps = (indices.length - 1) * gap;
        const invSum = indices.reduce((s, i) => s + 1 / itemRatios[i], 0);
        return { indices, rowH: (W - gaps) / invSum };
      });

      const maxRowH = H * maxRowPct;
      if (rowData.some(r => r.rowH > maxRowH)) continue;

      const totalH = rowData.reduce((s, r) => s + r.rowH, 0) + (rowData.length - 1) * gap;
      const fillRatio = totalH / H;
      const score = fillRatio <= 1 ? fillRatio : 1 / fillRatio;

      if (score > attemptScore) {
        attemptScore = score;
        const placements = [];
        if (totalH > H) {
          const s = H / totalH;
          let y = 0;
          for (const { indices, rowH } of rowData) {
            const sh = rowH * s;
            const rowTotalW = indices.reduce((sum, i) => sum + sh / itemRatios[i], 0)
              + (indices.length - 1) * gap;
            let x = (W - rowTotalW) / 2;
            for (const idx of indices) {
              const w = sh / itemRatios[idx];
              placements.push({ idx, x, y, w, h: sh });
              x += w + gap;
            }
            y += sh + gap;
          }
        } else {
          const pad = (H - totalH) / 2;
          let y = pad;
          for (const { indices, rowH } of rowData) {
            let x = 0;
            for (const idx of indices) {
              const w = rowH / itemRatios[idx];
              placements.push({ idx, x, y, w, h: rowH });
              x += w + gap;
            }
            y += rowH + gap;
          }
        }
        attemptBest = placements;
      }
    }

    if (attemptBest && attemptScore > bestScore) {
      bestScore = attemptScore;
      bestPlacements = attemptBest;
      break;
    }
  }

  if (!bestPlacements) return [];

  const mirrorH = random() < 0.5;
  const mirrorV = random() < 0.5;
  if (mirrorH || mirrorV) {
    bestPlacements.forEach(p => {
      if (mirrorH) p.x = W - p.x - p.w;
      if (mirrorV) p.y = H - p.y - p.h;
    });
  }
  return bestPlacements;
}
```

- [ ] **Step 2: Write the golden behavior test**

Create `tests/isolated/frontend/arcadePacker.test.mjs`:

```javascript
import { describe, test, expect } from '@jest/globals';
import { packLayout } from '../../../frontend/src/modules/Menu/arcadePacker.js';

// Deterministic LCG so attempts/shuffle/mirror are reproducible.
function seededRandom(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('packLayout (legacy parity)', () => {
  test('returns empty array for empty input', () => {
    expect(packLayout({ itemRatios: [], W: 1000, H: 600 })).toEqual([]);
  });

  test('places every item exactly once', () => {
    const itemRatios = [1.4, 1.4, 0.7, 1.0, 1.4, 0.8, 1.0, 1.4];
    const placements = packLayout({
      itemRatios, W: 1000, H: 600, random: seededRandom(42),
    });
    expect(placements).toHaveLength(itemRatios.length);
    const idxs = placements.map(p => p.idx).sort((a, b) => a - b);
    expect(idxs).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('every tile has positive width and height', () => {
    const itemRatios = [1.4, 1.4, 0.7, 1.0, 1.4, 0.8, 1.0, 1.4];
    const placements = packLayout({
      itemRatios, W: 1000, H: 600, random: seededRandom(7),
    });
    for (const p of placements) {
      expect(p.w).toBeGreaterThan(0);
      expect(p.h).toBeGreaterThan(0);
    }
  });

  test('respects each tile\'s ratio (h/w within 1% of input ratio)', () => {
    const itemRatios = [1.4, 1.4, 0.7, 1.0, 1.4, 0.8, 1.0, 1.4];
    const placements = packLayout({
      itemRatios, W: 1000, H: 600, random: seededRandom(5),
    });
    for (const p of placements) {
      const observed = p.h / p.w;
      const expected = itemRatios[p.idx];
      expect(Math.abs(observed - expected) / expected).toBeLessThan(0.01);
    }
  });
});
```

- [ ] **Step 3: Run the test — expect PASS**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs`
Expected: 4 tests pass.

- [ ] **Step 4: Replace the inline layout logic in `ArcadeSelector.jsx`**

In `frontend/src/modules/Menu/ArcadeSelector.jsx`, add the import near the other imports at the top:

```jsx
import { packLayout } from "./arcadePacker.js";
```

Replace the `useEffect` block at lines 309–436 with:

```jsx
  useEffect(() => {
    const nav = navmapRef.current;
    if (!nav || !items.length) return;
    const placements = packLayout({
      itemRatios,
      W: nav.clientWidth,
      H: nav.clientHeight,
    });
    if (placements.length) setLayout(placements);
  }, [items.length, itemRatios]);
```

- [ ] **Step 5: Run unit tests + smoke-load the menu in dev**

Run: `npx jest tests/isolated/frontend/`
Expected: all frontend isolated tests pass (the existing `playlistVirtualSeasons.test.mjs` and the new `arcadePacker.test.mjs`).

Then start the dev server (`npm run dev`) and load an arcade-style menu in the browser. Confirm the navmap renders identically to before (mixed-aspect tiles, justified rows, occasional mirror).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Menu/arcadePacker.js \
        tests/isolated/frontend/arcadePacker.test.mjs \
        frontend/src/modules/Menu/ArcadeSelector.jsx
git commit -m "refactor(ArcadeSelector): extract layout packer to arcadePacker.js"
```

---

## Task 2: Add a tall-tile classifier

**Files:**
- Modify: `frontend/src/modules/Menu/arcadePacker.js`
- Modify: `tests/isolated/frontend/arcadePacker.test.mjs`

- [ ] **Step 1: Write failing tests for `classifyItems`**

Append to `tests/isolated/frontend/arcadePacker.test.mjs`:

```javascript
import { classifyItems } from '../../../frontend/src/modules/Menu/arcadePacker.js';

describe('classifyItems', () => {
  test('splits indices by ratio threshold (default 1.4)', () => {
    const ratios = [0.7, 1.0, 1.4, 1.5, 2.0, 0.5];
    const { tallIndices, normalIndices } = classifyItems(ratios);
    expect(tallIndices).toEqual([3, 4]);
    expect(normalIndices).toEqual([0, 1, 2, 5]);
  });

  test('uses custom threshold when provided', () => {
    const ratios = [1.0, 1.2, 1.4];
    const { tallIndices, normalIndices } = classifyItems(ratios, 1.1);
    expect(tallIndices).toEqual([1, 2]);
    expect(normalIndices).toEqual([0]);
  });

  test('treats threshold as exclusive lower bound (>, not >=)', () => {
    const { tallIndices } = classifyItems([1.4, 1.4001], 1.4);
    expect(tallIndices).toEqual([1]);
  });

  test('handles empty input', () => {
    expect(classifyItems([])).toEqual({ tallIndices: [], normalIndices: [] });
  });
});
```

- [ ] **Step 2: Run — expect FAIL (`classifyItems is not a function`)**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t classifyItems`
Expected: 4 tests fail with import error or `not a function`.

- [ ] **Step 3: Implement `classifyItems`**

Append to `frontend/src/modules/Menu/arcadePacker.js`:

```javascript
export const DEFAULT_TALL_THRESHOLD = 1.4;

export function classifyItems(itemRatios, threshold = DEFAULT_TALL_THRESHOLD) {
  const tallIndices = [];
  const normalIndices = [];
  itemRatios.forEach((r, i) => {
    if (r > threshold) tallIndices.push(i);
    else normalIndices.push(i);
  });
  return { tallIndices, normalIndices };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t classifyItems`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Menu/arcadePacker.js tests/isolated/frontend/arcadePacker.test.mjs
git commit -m "feat(arcadePacker): add tall-tile classifier"
```

---

## Task 3: Single-row band solver

**Files:**
- Modify: `frontend/src/modules/Menu/arcadePacker.js`
- Modify: `tests/isolated/frontend/arcadePacker.test.mjs`

- [ ] **Step 1: Write failing tests for `solveSingleBand`**

Append:

```javascript
import { solveSingleBand } from '../../../frontend/src/modules/Menu/arcadePacker.js';

describe('solveSingleBand', () => {
  test('three squares fill width 1000, gap 10 → rowH=(1000-20)/3', () => {
    const out = solveSingleBand([1, 1, 1], 1000, 10);
    expect(out.valid).toBe(true);
    expect(out.rowH).toBeCloseTo((1000 - 20) / 3, 6); // 326.666…
  });

  test('mixed ratios solve correctly', () => {
    // ratios 0.5, 1.0, 2.0 → Σ(1/r) = 2 + 1 + 0.5 = 3.5
    const out = solveSingleBand([0.5, 1.0, 2.0], 1000, 10);
    expect(out.rowH).toBeCloseTo((1000 - 20) / 3.5, 6);
  });

  test('single tile: rowH = W * ratio', () => {
    const out = solveSingleBand([1.5], 600, 10);
    expect(out.rowH).toBeCloseTo(600 * 1.5, 6);
  });

  test('returns valid=false when ratios is empty', () => {
    expect(solveSingleBand([], 1000, 10)).toEqual({ rowH: 0, valid: false });
  });

  test('returns valid=false when computed rowH would be non-positive', () => {
    // Force gaps > W: 5 tiles at gap=300 → 4 gaps = 1200 > W=1000
    const out = solveSingleBand([1, 1, 1, 1, 1], 1000, 300);
    expect(out.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t solveSingleBand`
Expected: 5 tests fail.

- [ ] **Step 3: Implement `solveSingleBand`**

Append:

```javascript
export function solveSingleBand(ratios, W, gap) {
  if (!ratios.length) return { rowH: 0, valid: false };
  const gaps = (ratios.length - 1) * gap;
  const invSum = ratios.reduce((s, r) => s + 1 / r, 0);
  const rowH = (W - gaps) / invSum;
  return { rowH, valid: rowH > 0 };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t solveSingleBand`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Menu/arcadePacker.js tests/isolated/frontend/arcadePacker.test.mjs
git commit -m "feat(arcadePacker): add single-row band solver"
```

---

## Task 4: Double-row band solver (the new closed form)

**Files:**
- Modify: `frontend/src/modules/Menu/arcadePacker.js`
- Modify: `tests/isolated/frontend/arcadePacker.test.mjs`

- [ ] **Step 1: Write failing tests for `solveDoubleBand`**

Append:

```javascript
import { solveDoubleBand } from '../../../frontend/src/modules/Menu/arcadePacker.js';

describe('solveDoubleBand', () => {
  test('symmetric worked example: tall r=2, two squares above and below, W=1000, gap=10', () => {
    const out = solveDoubleBand({
      tallRatio: 2,
      upperRatios: [1, 1],
      lowerRatios: [1, 1],
      W: 1000,
      gap: 10,
    });
    expect(out.valid).toBe(true);
    expect(out.H_pair).toBeCloseTo(660, 4);
    expect(out.w_t).toBeCloseTo(330, 4);
    expect(out.upper_h).toBeCloseTo(325, 4);
    expect(out.lower_h).toBeCloseTo(325, 4);
  });

  test('upper and lower rows each fill exactly W (within rounding)', () => {
    const out = solveDoubleBand({
      tallRatio: 1.5,
      upperRatios: [0.5],
      lowerRatios: [1, 1, 1],
      W: 1000,
      gap: 10,
    });
    expect(out.valid).toBe(true);
    // upper: w_t + gap + (upper_h / 0.5) === W
    expect(out.w_t + 10 + out.upper_h / 0.5).toBeCloseTo(1000, 3);
    // lower: w_t + gap + 3*(lower_h) + 2*gap === W
    expect(out.w_t + 10 + 3 * out.lower_h + 20).toBeCloseTo(1000, 3);
    // pair geometry
    expect(out.upper_h + 10 + out.lower_h).toBeCloseTo(out.H_pair, 3);
    expect(out.w_t).toBeCloseTo(out.H_pair / 1.5, 3);
  });

  test('valid=false when upperRatios is empty (degenerate)', () => {
    const out = solveDoubleBand({
      tallRatio: 1.5, upperRatios: [], lowerRatios: [1, 1], W: 1000, gap: 10,
    });
    expect(out.valid).toBe(false);
  });

  test('valid=false when lowerRatios is empty (degenerate)', () => {
    const out = solveDoubleBand({
      tallRatio: 1.5, upperRatios: [1, 1], lowerRatios: [], W: 1000, gap: 10,
    });
    expect(out.valid).toBe(false);
  });

  test('valid=false when computed dimensions are non-positive', () => {
    // Crank gap so high that all derived heights collapse
    const out = solveDoubleBand({
      tallRatio: 2, upperRatios: [1, 1], lowerRatios: [1, 1], W: 100, gap: 80,
    });
    expect(out.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t solveDoubleBand`
Expected: 5 tests fail.

- [ ] **Step 3: Implement `solveDoubleBand`**

Append:

```javascript
export function solveDoubleBand({ tallRatio, upperRatios, lowerRatios, W, gap }) {
  if (!upperRatios.length || !lowerRatios.length) {
    return { valid: false, H_pair: 0, w_t: 0, upper_h: 0, lower_h: 0 };
  }
  const S_t = 1 / tallRatio;
  const S_u = upperRatios.reduce((s, r) => s + 1 / r, 0);
  const S_l = lowerRatios.reduce((s, r) => s + 1 / r, 0);
  const K = 1 / S_u + 1 / S_l;
  const g_u = upperRatios.length; // 1 gap to tall + (n_u - 1) inter-tile = n_u
  const g_l = lowerRatios.length;

  const H_pair = (W * K - gap * (g_u / S_u + g_l / S_l - 1)) / (1 + S_t * K);
  const w_t = H_pair / tallRatio;
  const upper_h = (W - w_t - g_u * gap) / S_u;
  const lower_h = (W - w_t - g_l * gap) / S_l;

  const valid = H_pair > 0 && w_t > 0 && upper_h > 0 && lower_h > 0;
  return { valid, H_pair, w_t, upper_h, lower_h };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t solveDoubleBand`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Menu/arcadePacker.js tests/isolated/frontend/arcadePacker.test.mjs
git commit -m "feat(arcadePacker): add double-row band closed-form solver"
```

---

## Task 5: Greedy band builder

**Goal:** Walk a shuffled item list and emit bands. Each band is `single` (only normal items) or `double` (one tall + balanced upper/lower normal items). Cap one tall per band to keep things tractable.

**Files:**
- Modify: `frontend/src/modules/Menu/arcadePacker.js`
- Modify: `tests/isolated/frontend/arcadePacker.test.mjs`

- [ ] **Step 1: Write failing tests for `buildBands`**

Append:

```javascript
import { buildBands } from '../../../frontend/src/modules/Menu/arcadePacker.js';

describe('buildBands', () => {
  test('all-normal items produce only single bands', () => {
    const itemRatios = [1.0, 1.0, 0.7, 1.0, 0.8];
    const bands = buildBands({
      itemRatios,
      order: [0, 1, 2, 3, 4],
      tallThreshold: 1.4,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 3,
    });
    expect(bands.every(b => b.type === 'single')).toBe(true);
    const placedIdxs = bands.flatMap(b => b.items).sort((a, b) => a - b);
    expect(placedIdxs).toEqual([0, 1, 2, 3, 4]);
  });

  test('a tall item creates a double band with balanced upper/lower', () => {
    const itemRatios = [1.0, 1.0, 1.5, 1.0, 1.0]; // index 2 is tall
    const bands = buildBands({
      itemRatios,
      order: [2, 0, 1, 3, 4],
      tallThreshold: 1.4,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 3,
    });
    const doubles = bands.filter(b => b.type === 'double');
    expect(doubles).toHaveLength(1);
    expect(doubles[0].talls).toEqual([2]);
    // |upper| - |lower| <= 1
    expect(Math.abs(doubles[0].upper.length - doubles[0].lower.length)).toBeLessThanOrEqual(1);
  });

  test('every input index appears exactly once across all bands', () => {
    const itemRatios = [1.0, 1.5, 0.7, 1.0, 1.6, 0.8, 1.0, 1.4, 1.0];
    const bands = buildBands({
      itemRatios,
      order: itemRatios.map((_, i) => i),
      tallThreshold: 1.4,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 3,
    });
    const seen = new Set();
    for (const b of bands) {
      const ids = b.type === 'double'
        ? [...b.talls, ...b.upper, ...b.lower]
        : b.items;
      for (const id of ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(itemRatios.length);
  });

  test('tall item with no normals available falls back to single band', () => {
    const itemRatios = [2.0]; // only one tall
    const bands = buildBands({
      itemRatios,
      order: [0],
      tallThreshold: 1.4,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 1,
    });
    expect(bands).toHaveLength(1);
    expect(bands[0].type).toBe('single');
    expect(bands[0].items).toEqual([0]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t buildBands`
Expected: 4 tests fail.

- [ ] **Step 3: Implement `buildBands`**

Append:

```javascript
// Greedy: walk `order`. For each tall index, open a double band and pull
// subsequent normal indices to fill upper/lower halves until both sides hit
// `minPerRow` width consumption (estimated at refH). For each normal index,
// extend the current single band until adding the next tile would overflow W.
//
// Constraints (initial implementation):
//   - At most ONE tall tile per double band.
//   - Both upper and lower halves must contain >= 1 normal tile, otherwise
//     the tall is emitted as a single-band tile.
//   - Upper/lower split alternates so |n_u - n_l| <= 1.
export function buildBands({
  itemRatios,
  order,
  tallThreshold,
  refH,
  W,
  gap,
  minPerRow,
}) {
  const { tallIndices } = classifyItems(itemRatios, tallThreshold);
  const tallSet = new Set(tallIndices);
  const isTall = (i) => tallSet.has(i);
  const widthAt = (i, h) => h / itemRatios[i];

  const bands = [];
  let i = 0;

  while (i < order.length) {
    const idx = order[i];

    if (isTall(idx)) {
      // Estimate this tall's width when sharing a 2-row band of ~ 2*refH.
      const pairHeightGuess = 2 * refH + gap;
      const tallW = widthAt(idx, pairHeightGuess);
      const widthBudget = W - tallW - gap;

      if (widthBudget <= 0) {
        bands.push({ type: 'single', items: [idx] });
        i++;
        continue;
      }

      const upper = [];
      const lower = [];
      let uW = 0;
      let lW = 0;
      let j = i + 1;
      while (j < order.length) {
        const cand = order[j];
        if (isTall(cand)) break;
        const w = widthAt(cand, refH);
        const target = upper.length <= lower.length ? 'upper' : 'lower';
        if (target === 'upper') {
          const next = uW + (upper.length > 0 ? gap : 0) + w;
          if (next > widthBudget) break;
          upper.push(cand);
          uW = next;
        } else {
          const next = lW + (lower.length > 0 ? gap : 0) + w;
          if (next > widthBudget) break;
          lower.push(cand);
          lW = next;
        }
        j++;
      }

      if (upper.length >= 1 && lower.length >= 1) {
        bands.push({ type: 'double', talls: [idx], upper, lower });
        i = j;
      } else {
        // Couldn't fill both halves — keep the tall as a single tile.
        bands.push({ type: 'single', items: [idx] });
        i++;
      }
      continue;
    }

    // Normal: greedy single-band packing at refH.
    const items = [idx];
    let rowW = widthAt(idx, refH);
    let j = i + 1;
    while (j < order.length) {
      const cand = order[j];
      if (isTall(cand)) break;
      const w = widthAt(cand, refH);
      if (rowW + gap + w > W) break;
      rowW += gap + w;
      items.push(cand);
      j++;
    }
    bands.push({ type: 'single', items });
    i = j;
  }

  // Merge tiny trailing single bands (parity with the legacy behavior).
  while (bands.length > 1) {
    const last = bands[bands.length - 1];
    if (last.type !== 'single' || last.items.length >= minPerRow) break;
    const prev = bands[bands.length - 2];
    if (prev.type !== 'single') break;
    prev.items.push(...last.items);
    bands.pop();
  }

  return bands;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t buildBands`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Menu/arcadePacker.js tests/isolated/frontend/arcadePacker.test.mjs
git commit -m "feat(arcadePacker): greedy band builder with tall-tile spans"
```

---

## Task 6: Render bands to placements

**Goal:** Solve every band to numeric heights, then place tiles with `{idx, x, y, w, h}`. Tall tiles get the full `H_pair`; upper/lower non-tall tiles render at their per-row heights. Handle scale-down (`totalH > H`) and center-pad (`totalH < H`) just like the legacy code.

**Files:**
- Modify: `frontend/src/modules/Menu/arcadePacker.js`
- Modify: `tests/isolated/frontend/arcadePacker.test.mjs`

- [ ] **Step 1: Write failing tests for `renderBands`**

Append:

```javascript
import { renderBands } from '../../../frontend/src/modules/Menu/arcadePacker.js';

describe('renderBands', () => {
  test('single band: emits placements that fill W exactly', () => {
    const bands = [{ type: 'single', items: [0, 1, 2] }];
    const itemRatios = [1, 1, 1];
    const result = renderBands({ bands, itemRatios, W: 1000, H: 600, gap: 10 });
    expect(result.valid).toBe(true);
    expect(result.placements).toHaveLength(3);
    const lastTile = result.placements[2];
    expect(lastTile.x + lastTile.w).toBeCloseTo(1000, 3);
  });

  test('double band: tall spans both rows, non-tall tiles fill remaining width per row', () => {
    const bands = [{ type: 'double', talls: [0], upper: [1, 2], lower: [3, 4] }];
    const itemRatios = [2, 1, 1, 1, 1];
    const result = renderBands({ bands, itemRatios, W: 1000, H: 700, gap: 10 });
    expect(result.valid).toBe(true);
    const tall = result.placements.find(p => p.idx === 0);
    const upperTiles = [1, 2].map(i => result.placements.find(p => p.idx === i));
    const lowerTiles = [3, 4].map(i => result.placements.find(p => p.idx === i));

    // Tall height = upper_h + gap + lower_h (top-to-bottom span)
    const upperBottom = upperTiles[0].y + upperTiles[0].h;
    const lowerTop = lowerTiles[0].y;
    expect(lowerTop).toBeCloseTo(upperBottom + 10, 3);
    expect(tall.y).toBeCloseTo(upperTiles[0].y, 3);
    expect(tall.y + tall.h).toBeCloseTo(lowerTiles[0].y + lowerTiles[0].h, 3);

    // Upper row width fills to W
    expect(upperTiles[1].x + upperTiles[1].w).toBeCloseTo(1000, 3);
    // Lower row width fills to W
    expect(lowerTiles[1].x + lowerTiles[1].w).toBeCloseTo(1000, 3);
  });

  test('scales down when bands\' total height exceeds H', () => {
    // Tiny H forces scale-down
    const bands = [
      { type: 'single', items: [0, 1] },
      { type: 'single', items: [2, 3] },
    ];
    const itemRatios = [1, 1, 1, 1];
    const result = renderBands({ bands, itemRatios, W: 1000, H: 100, gap: 10 });
    expect(result.valid).toBe(true);
    const lastY = Math.max(...result.placements.map(p => p.y + p.h));
    expect(lastY).toBeLessThanOrEqual(100 + 0.01);
  });

  test('returns valid=false if any band fails to solve', () => {
    const bands = [{ type: 'double', talls: [0], upper: [], lower: [1] }];
    const result = renderBands({ bands, itemRatios: [2, 1], W: 1000, H: 700, gap: 10 });
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t renderBands`
Expected: 4 tests fail.

- [ ] **Step 3: Implement `renderBands`**

Append:

```javascript
export function renderBands({ bands, itemRatios, W, H, gap }) {
  // Phase 1: solve each band, collect heights.
  const solved = [];
  for (const band of bands) {
    if (band.type === 'single') {
      const ratios = band.items.map(i => itemRatios[i]);
      const r = solveSingleBand(ratios, W, gap);
      if (!r.valid) return { valid: false, placements: [] };
      solved.push({ band, rowH: r.rowH, height: r.rowH });
    } else {
      const tallRatio = itemRatios[band.talls[0]];
      const upperRatios = band.upper.map(i => itemRatios[i]);
      const lowerRatios = band.lower.map(i => itemRatios[i]);
      const r = solveDoubleBand({ tallRatio, upperRatios, lowerRatios, W, gap });
      if (!r.valid) return { valid: false, placements: [] };
      solved.push({
        band,
        H_pair: r.H_pair, w_t: r.w_t, upper_h: r.upper_h, lower_h: r.lower_h,
        height: r.H_pair,
      });
    }
  }

  const totalH = solved.reduce((s, b) => s + b.height, 0) + (solved.length - 1) * gap;
  const scale = totalH > H ? H / totalH : 1;

  const placements = [];
  let y = scale === 1 ? (H - totalH) / 2 : 0;

  for (const s of solved) {
    if (s.band.type === 'single') {
      const rowH = s.rowH * scale;
      // For scale<1, center each row horizontally to mirror legacy behavior.
      const tilesW = s.band.items.reduce((sum, i) => sum + rowH / itemRatios[i], 0)
        + (s.band.items.length - 1) * gap;
      let x = scale < 1 ? (W - tilesW) / 2 : 0;
      for (const idx of s.band.items) {
        const w = rowH / itemRatios[idx];
        placements.push({ idx, x, y, w, h: rowH });
        x += w + gap;
      }
      y += rowH + gap;
    } else {
      const upper_h = s.upper_h * scale;
      const lower_h = s.lower_h * scale;
      const w_t = s.w_t * scale;
      const tallIdx = s.band.talls[0];
      // Tall tile on the left, then non-tall tiles fill the rest.
      placements.push({ idx: tallIdx, x: 0, y, w: w_t, h: upper_h + gap + lower_h });

      let xu = w_t + gap;
      for (const idx of s.band.upper) {
        const w = upper_h / itemRatios[idx];
        placements.push({ idx, x: xu, y, w, h: upper_h });
        xu += w + gap;
      }
      let xl = w_t + gap;
      const yLower = y + upper_h + gap;
      for (const idx of s.band.lower) {
        const w = lower_h / itemRatios[idx];
        placements.push({ idx, x: xl, y: yLower, w, h: lower_h });
        xl += w + gap;
      }
      y += upper_h + gap + lower_h + gap;
    }
  }

  return { valid: true, placements };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t renderBands`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Menu/arcadePacker.js tests/isolated/frontend/arcadePacker.test.mjs
git commit -m "feat(arcadePacker): render bands to absolute placements"
```

---

## Task 7: Replace `packLayout` with the band-based pipeline

**Goal:** Swap the old `packLayout` body for the new pipeline (`classifyItems` → `buildBands` → `renderBands`), keep the outer attempts/score loop, keep the random mirror, and keep the same `MAX_ROW_PCT` rejection.

**Files:**
- Modify: `frontend/src/modules/Menu/arcadePacker.js`
- Modify: `tests/isolated/frontend/arcadePacker.test.mjs`

- [ ] **Step 1: Add a behavioral test for tall-spanning at the top level**

Append:

```javascript
describe('packLayout (band-based)', () => {
  test('every tile preserves its h/w ratio (tolerance 1%)', () => {
    const itemRatios = [1.0, 1.5, 0.7, 1.0, 1.6, 0.8, 1.0, 1.4, 1.0];
    const placements = packLayout({
      itemRatios, W: 1000, H: 600, random: seededRandom(42),
    });
    expect(placements.length).toBe(itemRatios.length);
    for (const p of placements) {
      const observed = p.h / p.w;
      const expected = itemRatios[p.idx];
      expect(Math.abs(observed - expected) / expected).toBeLessThan(0.01);
    }
  });

  test('placements stay inside the container (within rounding)', () => {
    const itemRatios = [1.0, 1.5, 0.7, 1.0, 1.6, 0.8, 1.0, 1.4, 1.0];
    const placements = packLayout({
      itemRatios, W: 1000, H: 600, random: seededRandom(99),
    });
    for (const p of placements) {
      expect(p.x).toBeGreaterThanOrEqual(-0.5);
      expect(p.y).toBeGreaterThanOrEqual(-0.5);
      expect(p.x + p.w).toBeLessThanOrEqual(1000.5);
      expect(p.y + p.h).toBeLessThanOrEqual(600.5);
    }
  });

  test('a tall tile spans the height of two normal tiles in the same band', () => {
    // Force a list where index 0 is tall and the rest are normal,
    // and we expect the packer to land it in a double band.
    const itemRatios = [1.6, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
    let foundDoubleSpan = false;
    for (let seed = 1; seed <= 20; seed++) {
      const placements = packLayout({
        itemRatios, W: 1000, H: 600, random: seededRandom(seed),
      });
      const tall = placements.find(p => p.idx === 0);
      if (!tall) continue;
      // A tall in a double band has h roughly equal to (2 * normal_h + gap).
      // Find a normal tile that overlaps the tall vertically.
      const overlapping = placements.filter(p => p.idx !== 0
        && p.y >= tall.y - 1 && p.y + p.h <= tall.y + tall.h + 1);
      if (overlapping.length >= 2) { foundDoubleSpan = true; break; }
    }
    expect(foundDoubleSpan).toBe(true);
  });

  test('returns empty array on empty input', () => {
    expect(packLayout({ itemRatios: [], W: 1000, H: 600 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect the new "double-span" test to FAIL**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t "packLayout"`
Expected: the legacy-parity tests still pass; the new "spans the height of two normal tiles" test FAILS because the current `packLayout` doesn't build double bands.

- [ ] **Step 3: Replace `packLayout` body with the band pipeline**

In `frontend/src/modules/Menu/arcadePacker.js`, replace the entire existing `packLayout` function with:

```javascript
export function packLayout({
  itemRatios,
  W,
  H,
  gap = DEFAULT_GAP,
  maxRowPct = DEFAULT_MAX_ROW_PCT,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  minPerRow = DEFAULT_MIN_PER_ROW,
  tallThreshold = DEFAULT_TALL_THRESHOLD,
  random = Math.random,
} = {}) {
  if (!itemRatios?.length || W <= 0 || H <= 0) return [];
  const N = itemRatios.length;
  let bestPlacements = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const order = itemRatios.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const maxRows = Math.min(Math.ceil(N / 2), Math.floor(H / 30));
    let attemptBest = null;
    let attemptScore = -Infinity;

    for (let targetRows = 2; targetRows <= maxRows; targetRows++) {
      const refH = (H - (targetRows - 1) * gap) / targetRows;

      const bands = buildBands({
        itemRatios, order, tallThreshold, refH, W, gap, minPerRow,
      });
      const rendered = renderBands({ bands, itemRatios, W, H, gap });
      if (!rendered.valid) continue;

      // Reject if any single tile or band exceeds maxRowPct of H.
      const maxAllowed = H * maxRowPct;
      // For double bands the tall tile is allowed to exceed maxAllowed
      // (that's the point), but each non-tall row must stay under it.
      const violates = bands.some((band, i) => {
        if (band.type === 'single') {
          const rowH = rendered.placements.find(p => band.items.includes(p.idx)).h;
          return rowH > maxAllowed;
        }
        // Find a non-tall tile from this band to read its row height.
        const nonTallIdx = band.upper[0];
        const upperH = rendered.placements.find(p => p.idx === nonTallIdx).h;
        const lowerNonTallIdx = band.lower[0];
        const lowerH = rendered.placements.find(p => p.idx === lowerNonTallIdx).h;
        return upperH > maxAllowed || lowerH > maxAllowed;
      });
      if (violates) continue;

      const totalH = rendered.placements.reduce(
        (m, p) => Math.max(m, p.y + p.h), 0,
      );
      const fillRatio = totalH / H;
      const score = fillRatio <= 1 ? fillRatio : 1 / fillRatio;

      if (score > attemptScore) {
        attemptScore = score;
        attemptBest = rendered.placements;
      }
    }

    if (attemptBest && attemptScore > bestScore) {
      bestScore = attemptScore;
      bestPlacements = attemptBest;
      break;
    }
  }

  if (!bestPlacements) return [];

  const mirrorH = random() < 0.5;
  const mirrorV = random() < 0.5;
  if (mirrorH || mirrorV) {
    bestPlacements.forEach(p => {
      if (mirrorH) p.x = W - p.x - p.w;
      if (mirrorV) p.y = H - p.y - p.h;
    });
  }
  return bestPlacements;
}
```

- [ ] **Step 4: Run all packer tests — expect PASS**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs`
Expected: every test passes (legacy parity + classifyItems + solveSingleBand + solveDoubleBand + buildBands + renderBands + the new "double-span" packLayout tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Menu/arcadePacker.js tests/isolated/frontend/arcadePacker.test.mjs
git commit -m "feat(arcadePacker): tall tiles span two rows via band pipeline"
```

---

## Task 8: Visual verification in the browser

**Files:** none modified unless tuning is needed.

- [ ] **Step 1: Start the dev server**

Run (from project root): `npm run dev`
Wait until both Vite and the backend log "ready". Confirm dev port from `lsof -i :3112` (per CLAUDE.md, this host is `kckern-server`).

- [ ] **Step 2: Open an arcade-style menu and observe**

In a browser, navigate to a menu where `menuMeta.menuStyle === 'arcade'` (typically a RetroArch console list). Verify:
1. Tiles render in justified rows.
2. Mixed-aspect lists (NES portrait + GBA landscape + PS1 square) include at least one tall tile that visually spans two rows of normal tiles, with the tall tile's top edge aligned to the upper row and bottom edge aligned to the lower row.
3. D-pad / arrow navigation still moves between every tile (including tall tiles).
4. The hero panel updates correctly when navigating to a tall tile.

- [ ] **Step 3: Sample threshold check**

In DevTools, compute the ratio histogram with:

```javascript
items.map(i => i.metadata?.thumbRatio || i.thumbRatio || 0.75)
  .reduce((acc, r) => {
    const bucket = Math.round(r * 10) / 10;
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
```

If most NES boxart sits at ratio ~1.4 and you want them spanning, lower `DEFAULT_TALL_THRESHOLD` to `1.35` (or whichever gives a clean separation). If you adjust it, edit `frontend/src/modules/Menu/arcadePacker.js` and re-run `npx jest tests/isolated/frontend/arcadePacker.test.mjs` to confirm tests still pass (the `1.4` literal in `classifyItems` tests is independent of the default).

- [ ] **Step 4: Commit any threshold tweak**

If `DEFAULT_TALL_THRESHOLD` changed:

```bash
git add frontend/src/modules/Menu/arcadePacker.js
git commit -m "tune(arcadePacker): adjust tall threshold to <new value>"
```

If no change was needed, skip this step.

---

## Task 9: Final cleanup

**Files:**
- Modify: `frontend/src/modules/Menu/ArcadeSelector.jsx` (only if stale code lingers)

- [ ] **Step 1: Verify ArcadeSelector.jsx no longer contains dead layout helpers**

Open `frontend/src/modules/Menu/ArcadeSelector.jsx` and confirm:
- No leftover `bestPlacements`, `rowData`, `MAX_ROW_PCT`, `MAX_ATTEMPTS` symbols inside the component (they all live in `arcadePacker.js` now).
- The layout `useEffect` is the small wrapper from Task 1, Step 4.

If anything stale remains, remove it and run `npx jest tests/isolated/frontend/`.

- [ ] **Step 2: Final test run across the isolated suite**

Run: `npx jest tests/isolated/frontend/`
Expected: all tests pass.

- [ ] **Step 3: Final commit (only if Step 1 made changes)**

```bash
git add frontend/src/modules/Menu/ArcadeSelector.jsx
git commit -m "chore(ArcadeSelector): remove dead layout helpers"
```
