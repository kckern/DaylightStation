# Arcade Triple-Row Span + Area-Balanced Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add triple-row band support (two tall tiles stacked, sharing width, spanning three rows of normals) and replace the `fillRatio`-only score with a composite that penalizes tall-area dominance, so the packer chooses layouts where tall tiles don't visually overpower their neighbors.

**Architecture:** Add a closed-form `solveTripleBand` solver. Parameterize `buildBands` with `tripleCount`/`doubleCount` so callers control how many of the K tall items become triples vs doubles vs singles. Extend `renderBands` to draw triple bands (talls stacked at one edge, three normal rows on the other). Replace the inner `targetRows`-only sweep in `packLayout` with a `(targetRows × tripleCount × doubleCount)` Monte Carlo, scored by a composite of fillRatio + count-proportional area balance − hard cap penalty.

**Tech Stack:** Plain ES modules. Jest with `@jest/globals` for unit tests. The packer is pure (no React, no DOM); only the React component (`ArcadeSelector.jsx`) consumes it via `packLayout`. Existing logger param (Task-7-era) propagates to all new diagnostic events.

---

## Reference: closed-form math for triple bands

For a triple band: two stacked talls sharing width `w_t` (heights vary by ratio), three normal-tile rows on the opposite side, two inter-row gaps + one inter-tall gap.

```
S_top = Σ(1/r_i) over top normal-row tiles      (similarly S_mid, S_bot)
n_top = top.length                              (similarly n_mid, n_bot)
K     = 1/S_top + 1/S_mid + 1/S_bot
G     = n_top/S_top + n_mid/S_mid + n_bot/S_bot
R     = r_t1 + r_t2

w_t        = [W·K − gap·(G − 1)] / (R + K)
tall1.h    = w_t · r_t1
tall2.h    = w_t · r_t2
top_h      = (W − w_t − n_top·gap) / S_top
mid_h      = (W − w_t − n_mid·gap) / S_mid
bot_h      = (W − w_t − n_bot·gap) / S_bot
H_triple   = top_h + mid_h + bot_h + 2·gap
            = tall1.h + gap + tall2.h     (must hold by construction)
```

Validity: `w_t > 0`, all derived heights `> 0`, all three normal rows non-empty.

**Worked sanity check** (used by Task 1 tests). `r_t1=r_t2=1.5`, `top=[1,1]`, `mid=[1,1]`, `bot=[1,1]`, `W=1000`, `gap=10`:
- `S_top=S_mid=S_bot=2`, `K=1.5`, `G=3`, `R=3`
- `w_t = (1000·1.5 − 10·2) / (3+1.5) = 1480/4.5 = 328.89`
- `tall1.h = tall2.h = 328.89·1.5 = 493.33`
- `top_h = mid_h = bot_h = (1000 − 328.89 − 20)/2 = 325.56`
- `H_triple = 325.56·3 + 20 = 996.67`. Cross-check: `493.33 + 10 + 493.33 = 996.67` ✓

---

## File structure

**Modify only:**
- `frontend/src/modules/Menu/arcadePacker.js` — adds `solveTripleBand`; extends `buildBands`, `renderBands`, `packLayout`; adds composite-score helper.
- `tests/isolated/frontend/arcadePacker.test.mjs` — adds new describe blocks; extends existing.

**No new files.** The packer is one cohesive responsibility; splitting now would fragment closely-coupled math. `ArcadeSelector.jsx` is **not** modified — `packLayout`'s public signature is unchanged.

---

## Task 1: Closed-form `solveTripleBand`

**Files:**
- Modify: `frontend/src/modules/Menu/arcadePacker.js`
- Modify: `tests/isolated/frontend/arcadePacker.test.mjs`

- [ ] **Step 1: Write failing tests for `solveTripleBand`**

Add `solveTripleBand` to the existing combined import line at the top of the test file (it currently includes `packLayout, classifyItems, solveSingleBand, solveDoubleBand, buildBands, renderBands`). Add `solveTripleBand` to that same import — do NOT add a new separate import line.

Append at the bottom of the test file:

```javascript
describe('solveTripleBand', () => {
  test('symmetric case: r_t1=r_t2=1.5, three rows of 2 squares, W=1000, gap=10', () => {
    const out = solveTripleBand({
      tallRatios: [1.5, 1.5],
      topRatios: [1, 1], midRatios: [1, 1], botRatios: [1, 1],
      W: 1000, gap: 10,
    });
    expect(out.valid).toBe(true);
    expect(out.w_t).toBeCloseTo(328.89, 1);
    expect(out.tall1_h).toBeCloseTo(493.33, 1);
    expect(out.tall2_h).toBeCloseTo(493.33, 1);
    expect(out.top_h).toBeCloseTo(325.56, 1);
    expect(out.mid_h).toBeCloseTo(325.56, 1);
    expect(out.bot_h).toBeCloseTo(325.56, 1);
    // Pair geometry: stacked talls span the band's full vertical extent
    expect(out.tall1_h + 10 + out.tall2_h).toBeCloseTo(out.H_triple, 2);
  });

  test('asymmetric tall ratios shift the seam off-center', () => {
    // r_t1=1.0 (square), r_t2=2.0 (very tall) → tall2 is twice as tall as tall1
    const out = solveTripleBand({
      tallRatios: [1.0, 2.0],
      topRatios: [1, 1], midRatios: [1, 1], botRatios: [1, 1],
      W: 1000, gap: 10,
    });
    expect(out.valid).toBe(true);
    expect(out.w_t).toBeGreaterThan(0);
    // tall2 should be exactly 2× tall1 in height (since w shared and r_t2 = 2·r_t1)
    expect(out.tall2_h / out.tall1_h).toBeCloseTo(2.0, 3);
    // Pair geometry still holds
    expect(out.tall1_h + 10 + out.tall2_h).toBeCloseTo(out.H_triple, 2);
    // All three rows still fill W exactly
    const checkRow = (rowH, n) => out.w_t + 10 + n * rowH + (n - 1) * 10;
    expect(checkRow(out.top_h, 2)).toBeCloseTo(1000, 2);
    expect(checkRow(out.mid_h, 2)).toBeCloseTo(1000, 2);
    expect(checkRow(out.bot_h, 2)).toBeCloseTo(1000, 2);
  });

  test('valid=false when any normal row is empty', () => {
    const out1 = solveTripleBand({
      tallRatios: [1.5, 1.5],
      topRatios: [], midRatios: [1], botRatios: [1],
      W: 1000, gap: 10,
    });
    expect(out1).toEqual({
      valid: false, H_triple: 0, w_t: 0,
      tall1_h: 0, tall2_h: 0, top_h: 0, mid_h: 0, bot_h: 0,
    });
    const out2 = solveTripleBand({
      tallRatios: [1.5, 1.5],
      topRatios: [1], midRatios: [], botRatios: [1],
      W: 1000, gap: 10,
    });
    expect(out2.valid).toBe(false);
    const out3 = solveTripleBand({
      tallRatios: [1.5, 1.5],
      topRatios: [1], midRatios: [1], botRatios: [],
      W: 1000, gap: 10,
    });
    expect(out3.valid).toBe(false);
  });

  test('valid=false when computed dimensions are non-positive', () => {
    // Crank gap so high that derived heights collapse
    const out = solveTripleBand({
      tallRatios: [1.5, 1.5],
      topRatios: [1, 1], midRatios: [1, 1], botRatios: [1, 1],
      W: 100, gap: 60,
    });
    expect(out).toEqual({
      valid: false, H_triple: 0, w_t: 0,
      tall1_h: 0, tall2_h: 0, top_h: 0, mid_h: 0, bot_h: 0,
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL (`solveTripleBand is not a function`)**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t solveTripleBand`
Expected: 4 tests fail with `TypeError: ... is not a function`.

- [ ] **Step 3: Implement `solveTripleBand`**

In `frontend/src/modules/Menu/arcadePacker.js`, add the export immediately after the existing `solveDoubleBand` function (so the three solvers stay grouped):

```javascript
export function solveTripleBand({ tallRatios, topRatios, midRatios, botRatios, W, gap }) {
  if (!topRatios.length || !midRatios.length || !botRatios.length) {
    return { valid: false, H_triple: 0, w_t: 0, tall1_h: 0, tall2_h: 0, top_h: 0, mid_h: 0, bot_h: 0 };
  }
  const [r_t1, r_t2] = tallRatios;
  const S_top = topRatios.reduce((s, r) => s + 1 / r, 0);
  const S_mid = midRatios.reduce((s, r) => s + 1 / r, 0);
  const S_bot = botRatios.reduce((s, r) => s + 1 / r, 0);
  const K = 1 / S_top + 1 / S_mid + 1 / S_bot;
  const n_top = topRatios.length;
  const n_mid = midRatios.length;
  const n_bot = botRatios.length;
  const G = n_top / S_top + n_mid / S_mid + n_bot / S_bot;
  const R = r_t1 + r_t2;

  const w_t = (W * K - gap * (G - 1)) / (R + K);
  const tall1_h = w_t * r_t1;
  const tall2_h = w_t * r_t2;
  const top_h = (W - w_t - n_top * gap) / S_top;
  const mid_h = (W - w_t - n_mid * gap) / S_mid;
  const bot_h = (W - w_t - n_bot * gap) / S_bot;
  const H_triple = top_h + mid_h + bot_h + 2 * gap;

  const valid = w_t > 0 && tall1_h > 0 && tall2_h > 0 && top_h > 0 && mid_h > 0 && bot_h > 0;
  if (!valid) {
    return { valid: false, H_triple: 0, w_t: 0, tall1_h: 0, tall2_h: 0, top_h: 0, mid_h: 0, bot_h: 0 };
  }
  return { valid, H_triple, w_t, tall1_h, tall2_h, top_h, mid_h, bot_h };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t solveTripleBand`
Expected: 4 tests pass.

- [ ] **Step 5: Run full file as regression check**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs`
Expected: All 37 tests pass (33 prior + 4 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Menu/arcadePacker.js tests/isolated/frontend/arcadePacker.test.mjs
git commit -m "feat(arcadePacker): add triple-row band closed-form solver"
```

---

## Task 2: Parameterize `buildBands` with `tripleCount` and `doubleCount`

**Goal:** Let callers control how many of the K tall items become triples (consume 2 talls each), how many become doubles (consume 1 tall each), and the rest become singles. Default behavior preserved when `tripleCount=0` and `doubleCount=Infinity` (all talls try to form doubles, exactly matching today).

**Files:**
- Modify: `frontend/src/modules/Menu/arcadePacker.js`
- Modify: `tests/isolated/frontend/arcadePacker.test.mjs`

- [ ] **Step 1: Write failing tests for triple-band emission**

Append to the existing `describe('buildBands', …)` block in the test file (just before the closing `});`):

```javascript
  test('emits a triple band when tripleCount=1 and two adjacent talls are available', () => {
    // 2 talls then 6 normals — should pair both talls into a triple with
    // 6 normals split across top/mid/bot (2 each, by alternating fill).
    const itemRatios = [1.5, 1.5, 1, 1, 1, 1, 1, 1];
    const bands = buildBands({
      itemRatios,
      order: [0, 1, 2, 3, 4, 5, 6, 7],
      tallThreshold: 1.1,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 1,
      tripleCount: 1,
      doubleCount: 0,
    });
    const triples = bands.filter(b => b.type === 'triple');
    expect(triples).toHaveLength(1);
    expect(triples[0].talls).toEqual([0, 1]);
    // All 6 normal indices placed across top/mid/bot
    const normalsPlaced = [...triples[0].top, ...triples[0].mid, ...triples[0].bot].sort();
    expect(normalsPlaced).toEqual([2, 3, 4, 5, 6, 7]);
    // Each row non-empty
    expect(triples[0].top.length).toBeGreaterThan(0);
    expect(triples[0].mid.length).toBeGreaterThan(0);
    expect(triples[0].bot.length).toBeGreaterThan(0);
  });

  test('mixed: tripleCount=1, doubleCount=1, remainder as singles', () => {
    // 4 talls, 6 normals. Expect: 1 triple (consumes 2 talls, ~3 normals),
    // 1 double (consumes 1 tall, ~2 normals), 1 single tall, rest as singles.
    const itemRatios = [1.5, 1.5, 1.5, 1.5, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7];
    const bands = buildBands({
      itemRatios,
      order: itemRatios.map((_, i) => i),
      tallThreshold: 1.1,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 1,
      tripleCount: 1,
      doubleCount: 1,
    });
    const triples = bands.filter(b => b.type === 'triple');
    const doubles = bands.filter(b => b.type === 'double');
    expect(triples).toHaveLength(1);
    expect(doubles).toHaveLength(1);
    // Triple consumed talls 0 and 1
    expect(triples[0].talls).toEqual([0, 1]);
    // Double consumed tall 2 (next tall after triple)
    expect(doubles[0].talls).toEqual([2]);
    // Tall 3 became a single
    const singleBands = bands.filter(b => b.type === 'single');
    const tall3InSingle = singleBands.some(b => b.items.includes(3));
    expect(tall3InSingle).toBe(true);
  });

  test('default behavior (no tripleCount/doubleCount specified) matches legacy: all talls try doubles', () => {
    // Same input as the existing "balanced upper/lower" test
    const itemRatios = [1.0, 1.0, 1.5, 1.0, 1.0];
    const bands = buildBands({
      itemRatios,
      order: [2, 0, 1, 3, 4],
      tallThreshold: 1.4,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 3,
      // tripleCount and doubleCount omitted — defaults preserve legacy behavior
    });
    const doubles = bands.filter(b => b.type === 'double');
    const triples = bands.filter(b => b.type === 'triple');
    expect(triples).toHaveLength(0);
    expect(doubles).toHaveLength(1);
  });

  test('triple falls back if normal supply between talls is insufficient', () => {
    // 2 adjacent talls but only 2 normals after — needs ≥3 normals (one per row).
    const itemRatios = [1.5, 1.5, 1, 1];
    const bands = buildBands({
      itemRatios,
      order: [0, 1, 2, 3],
      tallThreshold: 1.1,
      refH: 200,
      W: 1000,
      gap: 10,
      minPerRow: 1,
      tripleCount: 1,
      doubleCount: 0,
    });
    // Triple cannot form (only 2 normals available, need ≥3 for top/mid/bot).
    // Algorithm falls back: the requested triple becomes (1 double + 1 single)
    // OR (2 singles) — either is acceptable. The invariant is no triple band.
    expect(bands.filter(b => b.type === 'triple')).toHaveLength(0);
    // All 4 indices still placed
    const allIndices = bands.flatMap(b => {
      if (b.type === 'single') return b.items;
      if (b.type === 'double') return [...b.talls, ...b.upper, ...b.lower];
      return [...b.talls, ...b.top, ...b.mid, ...b.bot];
    }).sort();
    expect(allIndices).toEqual([0, 1, 2, 3]);
  });
```

- [ ] **Step 2: Run — expect FAILs**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t buildBands`
Expected: the 4 new tests fail (the 5 existing buildBands tests still pass).

- [ ] **Step 3: Extend `buildBands` to accept `tripleCount` and `doubleCount` and emit triple bands**

Replace the entire `buildBands` function body in `frontend/src/modules/Menu/arcadePacker.js` with:

```javascript
export function buildBands({
  itemRatios,
  order,
  tallThreshold,
  refH,
  W,
  gap,
  minPerRow,
  tripleCount = 0,
  doubleCount = Infinity,
}) {
  const { tallIndices } = classifyItems(itemRatios, tallThreshold);
  const tallSet = new Set(tallIndices);
  const isTall = (i) => tallSet.has(i);
  const widthAt = (i, h) => h / itemRatios[i];

  // Talls are consumed in encounter order: first 2*tripleCount form triples
  // (paired greedily), next doubleCount form doubles, rest become singles.
  let triplesRemaining = tripleCount;
  let doublesRemaining = doubleCount;

  const bands = [];
  let i = 0;

  while (i < order.length) {
    const idx = order[i];

    if (isTall(idx)) {
      // 1) Try to form a TRIPLE if budget allows AND the next tall in `order`
      //    is also adjacent (i.e., reachable without crossing other talls).
      if (triplesRemaining > 0) {
        // Find the next tall after idx (skipping any normals in between for now).
        let nextTallJ = -1;
        for (let k = i + 1; k < order.length; k++) {
          if (isTall(order[k])) { nextTallJ = k; break; }
        }
        if (nextTallJ !== -1) {
          // Estimate band height for sizing wing widths. A triple is roughly
          // 3 row-equivalents tall, so guess ~ 3 * refH + 2 * gap.
          const tripleHeightGuess = 3 * refH + 2 * gap;
          const r1 = itemRatios[idx];
          const r2 = itemRatios[order[nextTallJ]];
          // Tall width if pair shared height = tripleHeightGuess − gap (one inter-tall gap).
          // For each tall: h = tallHeight, w = h/r. Stacked heights sum = guess − gap.
          // Pin same width: w_t = (guess − gap) / (r1 + r2).
          const w_t_guess = (tripleHeightGuess - gap) / (r1 + r2);
          const widthBudget = W - w_t_guess - gap;
          if (widthBudget > 0) {
            // Fill the 3 rows from normals AFTER both talls (between them
            // could leave normals stranded; consume them as the wing).
            // Strategy: pull normals from positions BETWEEN idx and nextTallJ
            // first (so they're not orphaned), then continue past nextTallJ.
            // Reorder by promoting the second tall to immediately after idx,
            // then walking forward.
            const normalsBetween = [];
            for (let k = i + 1; k < nextTallJ; k++) normalsBetween.push(order[k]);
            const synthOrder = [...normalsBetween, ...order.slice(nextTallJ + 1)];
            // Use fillTripleRows on a synthetic walker that iterates synthOrder.
            const top = [], mid = [], bot = [];
            const widths = [0, 0, 0];
            const arrs = [top, mid, bot];
            let consumed = 0;
            for (const cand of synthOrder) {
              if (isTall(cand)) break;
              let target = 0;
              if (arrs[1].length < arrs[target].length) target = 1;
              if (arrs[2].length < arrs[target].length) target = 2;
              const w = widthAt(cand, refH);
              const next = widths[target] + (arrs[target].length > 0 ? gap : 0) + w;
              if (next > widthBudget) break;
              arrs[target].push(cand);
              widths[target] = next;
              consumed++;
            }
            if (top.length >= 1 && mid.length >= 1 && bot.length >= 1) {
              bands.push({
                type: 'triple',
                talls: [idx, order[nextTallJ]],
                top, mid, bot,
              });
              triplesRemaining--;
              // Advance i past both talls AND the consumed normals. Consumed
              // normals come first from `normalsBetween` then from after the
              // second tall.
              const consumedFromBetween = Math.min(consumed, normalsBetween.length);
              const consumedAfter = consumed - consumedFromBetween;
              // After the triple, continue with: any leftover `normalsBetween`,
              // then `order` after (nextTallJ + 1 + consumedAfter). We need to
              // splice these back into our walking position. Easiest: adjust
              // `order` in-place from position i onward to reflect what's left.
              const leftoverBetween = normalsBetween.slice(consumedFromBetween);
              const tailStart = nextTallJ + 1 + consumedAfter;
              order.splice(i, order.length - i, ...leftoverBetween, ...order.slice(tailStart));
              continue; // re-enter loop at the same i, which now holds the next item
            }
          }
        }
        // Triple did not form; fall through to double / single handling.
      }

      // 2) Try to form a DOUBLE if budget allows.
      if (doublesRemaining > 0) {
        const pairHeightGuess = 2 * refH + gap;
        const tallW = widthAt(idx, pairHeightGuess);
        const widthBudget = W - tallW - gap;
        if (widthBudget > 0) {
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
            doublesRemaining--;
            i = j;
            continue;
          }
        }
      }

      // 3) Fallback: tall as a single tile.
      bands.push({ type: 'single', items: [idx] });
      i++;
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

Note: this implementation mutates `order` in-place when a triple consumes items spanning two tall boundaries. That's an internal contract — `packLayout` always passes a fresh `order` per variant (see Task 5), so no caller is affected.

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t buildBands`
Expected: All 9 buildBands tests pass (5 original + 4 new).

- [ ] **Step 5: Run full file regression**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs`
Expected: 41 tests pass (37 from Task 1 + 4 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Menu/arcadePacker.js tests/isolated/frontend/arcadePacker.test.mjs
git commit -m "feat(arcadePacker): buildBands tripleCount/doubleCount params for variant control"
```

---

## Task 3: Render triple bands in `renderBands`

**Goal:** Extend `renderBands` to handle the new `triple` band type. Talls stack vertically at one edge; three normal rows fill the opposite side. Use the existing alternation counter (renamed `bigBandIndex`) so triples and doubles share the same left/right alternation.

**Files:**
- Modify: `frontend/src/modules/Menu/arcadePacker.js`
- Modify: `tests/isolated/frontend/arcadePacker.test.mjs`

- [ ] **Step 1: Write failing tests for triple-band rendering**

Append to the existing `describe('renderBands', …)` block in the test file (just before the closing `});`):

```javascript
  test('triple band: stacked talls span full vertical extent + 3 rows fill width', () => {
    const bands = [{
      type: 'triple', talls: [0, 1],
      top: [2, 3], mid: [4, 5], bot: [6, 7],
    }];
    const itemRatios = [1.5, 1.5, 1, 1, 1, 1, 1, 1];
    const result = renderBands({ bands, itemRatios, W: 1000, H: 1100, gap: 10 });
    expect(result.valid).toBe(true);

    const tall1 = result.placements.find(p => p.idx === 0);
    const tall2 = result.placements.find(p => p.idx === 1);
    const topT = result.placements.find(p => p.idx === 2);
    const midT = result.placements.find(p => p.idx === 4);
    const botT = result.placements.find(p => p.idx === 6);

    // Talls share x and width.
    expect(tall1.x).toBeCloseTo(tall2.x, 1);
    expect(tall1.w).toBeCloseTo(tall2.w, 1);

    // tall2 is directly below tall1 with one gap between them.
    expect(tall2.y).toBeCloseTo(tall1.y + tall1.h + 10, 1);

    // Triple's vertical extent matches stacked talls.
    expect(tall2.y + tall2.h).toBeCloseTo(botT.y + botT.h, 1);
    expect(tall1.y).toBeCloseTo(topT.y, 1);

    // 3 rows of normals at three distinct y positions.
    expect(topT.y).toBeLessThan(midT.y);
    expect(midT.y).toBeLessThan(botT.y);

    // Each row fills width: rightmost tile's right edge ≈ W.
    const rowEnd = (idx) => {
      const tile = result.placements.find(p => p.idx === idx);
      return tile.x + tile.w;
    };
    // The non-tall tiles' right edges should reach W.
    expect(rowEnd(3)).toBeCloseTo(1000, 1);
    expect(rowEnd(5)).toBeCloseTo(1000, 1);
    expect(rowEnd(7)).toBeCloseTo(1000, 1);
  });

  test('triple band stays inside H when scaled down', () => {
    const bands = [{
      type: 'triple', talls: [0, 1],
      top: [2, 3], mid: [4, 5], bot: [6, 7],
    }];
    const itemRatios = [1.5, 1.5, 1, 1, 1, 1, 1, 1];
    // Force scale-down: pin H well below the natural H_triple.
    const result = renderBands({ bands, itemRatios, W: 1000, H: 400, gap: 10 });
    expect(result.valid).toBe(true);
    const lastY = Math.max(...result.placements.map(p => p.y + p.h));
    expect(lastY).toBeLessThanOrEqual(400 + 0.01);
  });

  test('alternation: triple + double + triple → talls land left, right, left', () => {
    // 3 big bands in sequence. bigBandIndex should alternate the tall side.
    const bands = [
      { type: 'triple', talls: [0, 1], top: [10, 11], mid: [12, 13], bot: [14, 15] },
      { type: 'double', talls: [2], upper: [16, 17], lower: [18, 19] },
      { type: 'triple', talls: [3, 4], top: [20, 21], mid: [22, 23], bot: [24, 25] },
    ];
    const itemRatios = Array(26).fill(1);
    // Force ratios for talls explicitly
    itemRatios[0] = itemRatios[1] = itemRatios[2] = itemRatios[3] = itemRatios[4] = 1.5;
    const result = renderBands({ bands, itemRatios, W: 1000, H: 3000, gap: 10 });
    expect(result.valid).toBe(true);
    const tall0 = result.placements.find(p => p.idx === 0);   // first triple, tall on LEFT
    const tall2 = result.placements.find(p => p.idx === 2);   // second band (double), tall on RIGHT
    const tall3 = result.placements.find(p => p.idx === 3);   // third band (triple), tall on LEFT
    expect(tall0.x).toBeCloseTo(0, 1);
    expect(tall2.x + tall2.w).toBeCloseTo(1000, 1);
    expect(tall3.x).toBeCloseTo(0, 1);
  });

  test('returns valid=false when triple solver fails', () => {
    const bands = [{
      type: 'triple', talls: [0, 1],
      top: [], mid: [2], bot: [3],
    }];
    const result = renderBands({ bands, itemRatios: [1.5, 1.5, 1, 1], W: 1000, H: 1000, gap: 10 });
    expect(result.valid).toBe(false);
  });
```

- [ ] **Step 2: Run — expect FAILs**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t renderBands`
Expected: the 4 new tests fail (the 6 existing renderBands tests still pass).

- [ ] **Step 3: Extend `renderBands` to handle `type: 'triple'`**

In `frontend/src/modules/Menu/arcadePacker.js`, the current `renderBands` function spans roughly lines 328–425. Locate it. Make TWO changes:

**Change A — extend Phase 1 (band solving) to handle triples.** Find the loop:

```javascript
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
```

Replace it with:

```javascript
  for (const band of bands) {
    if (band.type === 'single') {
      const ratios = band.items.map(i => itemRatios[i]);
      const r = solveSingleBand(ratios, W, gap);
      if (!r.valid) return { valid: false, placements: [] };
      solved.push({ band, rowH: r.rowH, height: r.rowH });
    } else if (band.type === 'double') {
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
    } else { // triple
      const tallRatios = [itemRatios[band.talls[0]], itemRatios[band.talls[1]]];
      const topRatios = band.top.map(i => itemRatios[i]);
      const midRatios = band.mid.map(i => itemRatios[i]);
      const botRatios = band.bot.map(i => itemRatios[i]);
      const r = solveTripleBand({ tallRatios, topRatios, midRatios, botRatios, W, gap });
      if (!r.valid) return { valid: false, placements: [] };
      solved.push({
        band,
        H_triple: r.H_triple, w_t: r.w_t,
        tall1_h: r.tall1_h, tall2_h: r.tall2_h,
        top_h: r.top_h, mid_h: r.mid_h, bot_h: r.bot_h,
        height: r.H_triple,
      });
    }
  }
```

**Change B — extend Phase 2 (placement emission) to handle triples and rename the alternation counter.** Find the placement loop:

```javascript
  let doubleBandIndex = 0;

  for (const s of solved) {
    if (s.band.type === 'single') {
      // ... (unchanged single-band branch)
    } else {
      // ... (existing double-band branch)
    }
  }
```

Rename `doubleBandIndex` to `bigBandIndex` (a "big band" is anything that holds a tall — both doubles and triples). Then add a third branch for triples. The full replacement of the placement loop is:

```javascript
  // Counter for both doubles and triples — they share the alternation cycle.
  let bigBandIndex = 0;

  for (const s of solved) {
    if (s.band.type === 'single') {
      const rowH = s.rowH * scale;
      const tilesW = s.band.items.reduce((sum, i) => sum + rowH / itemRatios[i], 0)
        + (s.band.items.length - 1) * gap;
      let x = scale < 1 ? (W - tilesW) / 2 : 0;
      for (const idx of s.band.items) {
        const w = rowH / itemRatios[idx];
        placements.push({ idx, x, y, w, h: rowH });
        x += w + gap;
      }
      y += rowH + interBandGap;
    } else if (s.band.type === 'double') {
      const upper_h = s.upper_h * scale;
      const lower_h = s.lower_h * scale;
      const w_t = s.w_t * scale;
      const innerGap = gap * scale;
      const tallIdx = s.band.talls[0];
      const tallOnLeft = bigBandIndex % 2 === 0;
      bigBandIndex++;

      const upperRowW = w_t + innerGap
        + s.band.upper.reduce((sum, i) => sum + upper_h / itemRatios[i], 0)
        + Math.max(0, s.band.upper.length - 1) * innerGap;
      const lowerRowW = w_t + innerGap
        + s.band.lower.reduce((sum, i) => sum + lower_h / itemRatios[i], 0)
        + Math.max(0, s.band.lower.length - 1) * innerGap;
      const bandW = Math.max(upperRowW, lowerRowW);
      const xOffset = scale < 1 ? (W - bandW) / 2 : 0;

      const tallX = tallOnLeft ? xOffset : xOffset + bandW - w_t;
      placements.push({
        idx: tallIdx, x: tallX, y, w: w_t, h: upper_h + innerGap + lower_h,
      });

      const nonTallStartX = tallOnLeft ? xOffset + w_t + innerGap : xOffset;

      let xu = nonTallStartX;
      for (const idx of s.band.upper) {
        const w = upper_h / itemRatios[idx];
        placements.push({ idx, x: xu, y, w, h: upper_h });
        xu += w + innerGap;
      }
      let xl = nonTallStartX;
      const yLower = y + upper_h + innerGap;
      for (const idx of s.band.lower) {
        const w = lower_h / itemRatios[idx];
        placements.push({ idx, x: xl, y: yLower, w, h: lower_h });
        xl += w + innerGap;
      }
      y += upper_h + innerGap + lower_h + interBandGap;
    } else { // triple
      const top_h = s.top_h * scale;
      const mid_h = s.mid_h * scale;
      const bot_h = s.bot_h * scale;
      const tall1_h = s.tall1_h * scale;
      const tall2_h = s.tall2_h * scale;
      const w_t = s.w_t * scale;
      const innerGap = gap * scale;
      const [tall1Idx, tall2Idx] = s.band.talls;
      const tallOnLeft = bigBandIndex % 2 === 0;
      bigBandIndex++;

      // Compute band's effective width = w_t + gap + widest of (top/mid/bot rows).
      const rowW = (rowArr, rowH) => w_t + innerGap
        + rowArr.reduce((sum, i) => sum + rowH / itemRatios[i], 0)
        + Math.max(0, rowArr.length - 1) * innerGap;
      const bandW = Math.max(rowW(s.band.top, top_h), rowW(s.band.mid, mid_h), rowW(s.band.bot, bot_h));
      const xOffset = scale < 1 ? (W - bandW) / 2 : 0;

      const tallX = tallOnLeft ? xOffset : xOffset + bandW - w_t;

      // Stacked talls: tall1 on top, tall2 directly below with innerGap.
      placements.push({ idx: tall1Idx, x: tallX, y, w: w_t, h: tall1_h });
      placements.push({
        idx: tall2Idx, x: tallX, y: y + tall1_h + innerGap, w: w_t, h: tall2_h,
      });

      const nonTallStartX = tallOnLeft ? xOffset + w_t + innerGap : xOffset;

      // top row
      let xt = nonTallStartX;
      for (const idx of s.band.top) {
        const w = top_h / itemRatios[idx];
        placements.push({ idx, x: xt, y, w, h: top_h });
        xt += w + innerGap;
      }
      // mid row
      let xm = nonTallStartX;
      const yMid = y + top_h + innerGap;
      for (const idx of s.band.mid) {
        const w = mid_h / itemRatios[idx];
        placements.push({ idx, x: xm, y: yMid, w, h: mid_h });
        xm += w + innerGap;
      }
      // bot row
      let xb = nonTallStartX;
      const yBot = y + top_h + innerGap + mid_h + innerGap;
      for (const idx of s.band.bot) {
        const w = bot_h / itemRatios[idx];
        placements.push({ idx, x: xb, y: yBot, w, h: bot_h });
        xb += w + innerGap;
      }
      y += top_h + innerGap + mid_h + innerGap + bot_h + interBandGap;
    }
  }
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t renderBands`
Expected: All 10 renderBands tests pass (6 original + 4 new).

- [ ] **Step 5: Run full file regression**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs`
Expected: 45 tests pass (41 from Task 2 + 4 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Menu/arcadePacker.js tests/isolated/frontend/arcadePacker.test.mjs
git commit -m "feat(arcadePacker): renderBands handles triple bands + alternation across big bands"
```

---

## Task 4: Composite scoring helper

**Goal:** Extract the scoring logic into a pure helper `scoreLayout` so it's unit-testable and `packLayout` stays readable. The score combines `fillRatio`, count-proportional area balance, and a hard cap penalty.

**Files:**
- Modify: `frontend/src/modules/Menu/arcadePacker.js`
- Modify: `tests/isolated/frontend/arcadePacker.test.mjs`

- [ ] **Step 1: Write failing tests for `scoreLayout`**

Add `scoreLayout` and `DEFAULT_TALL_AREA_CAP` to the existing combined import line at the top of the test file.

Append at the bottom of the test file:

```javascript
describe('scoreLayout', () => {
  test('perfect fill + perfect balance returns positive composite', () => {
    // 4 normals filling H exactly, 0 talls — balance is trivially zero.
    const placements = [
      { idx: 0, x: 0, y: 0, w: 250, h: 100 },
      { idx: 1, x: 250, y: 0, w: 250, h: 100 },
      { idx: 2, x: 500, y: 0, w: 250, h: 100 },
      { idx: 3, x: 750, y: 0, w: 250, h: 100 },
    ];
    const tallSet = new Set();
    const out = scoreLayout({ placements, tallSet, N: 4, W: 1000, H: 100 });
    expect(out.fillRatio).toBeCloseTo(1.0, 3);
    expect(out.tallAreaFrac).toBeCloseTo(0, 3);
    expect(out.tallCountFrac).toBeCloseTo(0, 3);
    expect(out.balanceTerm).toBeCloseTo(1.0, 3);
    expect(out.capPenalty).toBe(0);
    expect(out.score).toBeGreaterThan(0);
  });

  test('balanced talls (area% == count%) maximize balanceTerm', () => {
    // 2 of 4 items are tall (50% count); they occupy 50% of total area.
    const placements = [
      { idx: 0, x: 0, y: 0, w: 250, h: 200 },     // tall, area=50000
      { idx: 1, x: 250, y: 0, w: 250, h: 200 },   // tall, area=50000
      { idx: 2, x: 500, y: 0, w: 250, h: 200 },   // normal, area=50000
      { idx: 3, x: 750, y: 0, w: 250, h: 200 },   // normal, area=50000
    ];
    const tallSet = new Set([0, 1]);
    const out = scoreLayout({ placements, tallSet, N: 4, W: 1000, H: 200 });
    expect(out.tallAreaFrac).toBeCloseTo(0.5, 3);
    expect(out.tallCountFrac).toBe(0.5);
    expect(out.balanceTerm).toBeCloseTo(1.0, 3);
    expect(out.capPenalty).toBe(0);
  });

  test('over-allocation triggers cap penalty', () => {
    // 1 of 4 items is tall but takes 60% of area — over default cap of 0.5.
    const placements = [
      { idx: 0, x: 0, y: 0, w: 600, h: 200 },     // tall, 60% area
      { idx: 1, x: 0, y: 200, w: 333, h: 100 },   // normal
      { idx: 2, x: 333, y: 200, w: 333, h: 100 },
      { idx: 3, x: 666, y: 200, w: 334, h: 100 },
    ];
    const tallSet = new Set([0]);
    const out = scoreLayout({ placements, tallSet, N: 4, W: 1000, H: 300 });
    expect(out.tallAreaFrac).toBeCloseTo(0.4, 3); // 120000 / 300000
    // 0.4 < 0.5 cap → no penalty
    expect(out.capPenalty).toBe(0);
  });

  test('exceeding hard cap produces penalty proportional to overshoot', () => {
    // Force tall area to 60% with cap=0.5.
    const placements = [
      { idx: 0, x: 0, y: 0, w: 600, h: 600 },     // tall, area = 360000
      { idx: 1, x: 600, y: 0, w: 400, h: 600 },   // normal, area = 240000
    ];
    const tallSet = new Set([0]);
    const out = scoreLayout({ placements, tallSet, N: 2, W: 1000, H: 600 });
    expect(out.tallAreaFrac).toBeCloseTo(0.6, 3);
    expect(out.capPenalty).toBeCloseTo(0.1, 3); // 0.6 - 0.5
    // Score should reflect the penalty (default capWeight=10): score includes
    // a -1.0 contribution from the penalty.
    expect(out.score).toBeLessThan(out.fillRatio + out.balanceTerm);
  });

  test('overflow (totalH > H) penalizes fillRatio via inversion', () => {
    // Place a tile beyond H to simulate overflow.
    const placements = [
      { idx: 0, x: 0, y: 0, w: 1000, h: 800 }, // extends to y=800 in H=400
    ];
    const tallSet = new Set();
    const out = scoreLayout({ placements, tallSet, N: 1, W: 1000, H: 400 });
    // renderedTotalH = 800; fillRatio = 800/400 = 2 → score uses 1/2 = 0.5
    expect(out.fillRatio).toBeCloseTo(0.5, 3);
  });

  test('uses default constants when weights/cap not provided', () => {
    const placements = [{ idx: 0, x: 0, y: 0, w: 100, h: 100 }];
    const tallSet = new Set();
    const out = scoreLayout({ placements, tallSet, N: 1, W: 100, H: 100 });
    // score = 1·1 + 1·1 - 10·0 = 2
    expect(out.score).toBeCloseTo(2, 3);
  });

  test('respects custom weights and cap', () => {
    const placements = [
      { idx: 0, x: 0, y: 0, w: 800, h: 1000 }, // tall, 80% of 1000x1000
      { idx: 1, x: 800, y: 0, w: 200, h: 1000 },
    ];
    const tallSet = new Set([0]);
    const out = scoreLayout({
      placements, tallSet, N: 2, W: 1000, H: 1000,
      fillWeight: 2, balanceWeight: 0.5, capWeight: 100, areaCap: 0.4,
    });
    expect(out.tallAreaFrac).toBeCloseTo(0.8, 3);
    // capPenalty = 0.8 - 0.4 = 0.4; weighted = 100·0.4 = 40
    expect(out.score).toBeLessThan(0); // penalty dominates
  });
});
```

- [ ] **Step 2: Run — expect FAILs**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t scoreLayout`
Expected: 7 tests fail (TypeError on import).

- [ ] **Step 3: Implement `scoreLayout`**

In `frontend/src/modules/Menu/arcadePacker.js`, add these exports near the top, just after the existing `DEFAULT_*` constants (around line 7):

```javascript
export const DEFAULT_TALL_AREA_CAP = 0.5;
export const DEFAULT_FILL_WEIGHT = 1.0;
export const DEFAULT_BALANCE_WEIGHT = 1.0;
export const DEFAULT_CAP_PENALTY = 10.0;
```

Then add this exported function at the very end of the file (after `renderBands`):

```javascript
export function scoreLayout({
  placements,
  tallSet,
  N,
  W,
  H,
  fillWeight = DEFAULT_FILL_WEIGHT,
  balanceWeight = DEFAULT_BALANCE_WEIGHT,
  capWeight = DEFAULT_CAP_PENALTY,
  areaCap = DEFAULT_TALL_AREA_CAP,
}) {
  const renderedTotalH = placements.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  const rawFillRatio = renderedTotalH / H;
  const fillRatio = rawFillRatio <= 1 ? rawFillRatio : 1 / rawFillRatio;

  const totalArea = W * H;
  const tallArea = placements.reduce(
    (s, p) => s + (tallSet.has(p.idx) ? p.w * p.h : 0),
    0,
  );
  const tallAreaFrac = tallArea / totalArea;
  const tallCountFrac = N > 0 ? tallSet.size / N : 0;
  const balanceTerm = 1 - Math.abs(tallAreaFrac - tallCountFrac);
  const capPenalty = Math.max(0, tallAreaFrac - areaCap);

  const score = fillWeight * fillRatio + balanceWeight * balanceTerm - capWeight * capPenalty;

  return {
    score, fillRatio, tallAreaFrac, tallCountFrac, balanceTerm, capPenalty, renderedTotalH,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t scoreLayout`
Expected: All 7 scoreLayout tests pass.

- [ ] **Step 5: Run full file regression**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs`
Expected: 52 tests pass (45 from Task 3 + 7 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Menu/arcadePacker.js tests/isolated/frontend/arcadePacker.test.mjs
git commit -m "feat(arcadePacker): composite scoreLayout helper for area-balanced optimization"
```

---

## Task 5: Monte Carlo `(tripleCount, doubleCount)` sweep in `packLayout`

**Goal:** Replace the inner `targetRows` sweep with a nested `(targetRows × tripleCount × doubleCount)` sweep. For each combination, build bands, validate (pre-scale `maxRowPct` extended to triple-band rows), render, score with the composite. Pick the variant with the best composite score.

**Files:**
- Modify: `frontend/src/modules/Menu/arcadePacker.js`
- Modify: `tests/isolated/frontend/arcadePacker.test.mjs`

- [ ] **Step 1: Write a failing behavioral test for the optimizer choosing triples under high tall density**

Append to the existing `describe('packLayout (band-based)', …)` block in the test file (just before the closing `});`):

```javascript
  test('packs at least one triple band when many tall items would dominate via doubles', () => {
    // 6 talls + 18 normals (25% tall by count). With doubles, talls might
    // consume ~40-50% of area. The optimizer should pick a layout with at
    // least one triple band to balance.
    const itemRatios = [
      ...Array(6).fill(1.5),
      ...Array(18).fill(0.7),
    ];
    let foundTriple = false;
    for (let seed = 1; seed <= 30; seed++) {
      const placements = packLayout({
        itemRatios, W: 1152, H: 1080, random: seededRandom(seed),
      });
      if (!placements.length) continue;
      // Detect a triple band heuristically: a tall tile whose h is close to
      // 2x the median tile height (a tall in a triple is roughly 1.5 row-
      // equivalents, vs 2 in a double). Easier signal: the layout has THREE
      // distinct row positions on one side of a tall tile.
      const heights = placements.map(p => Math.round(p.h)).sort((a, b) => a - b);
      const median = heights[Math.floor(heights.length / 2)];
      const tallCandidates = placements.filter(p => itemRatios[p.idx] > 1.1);
      // In a triple, two talls share the same x and have ~equal width.
      const tallByX = new Map();
      for (const t of tallCandidates) {
        const key = Math.round(t.x / 5) * 5;
        if (!tallByX.has(key)) tallByX.set(key, []);
        tallByX.get(key).push(t);
      }
      for (const tiles of tallByX.values()) {
        if (tiles.length >= 2) { foundTriple = true; break; }
      }
      if (foundTriple) break;
    }
    expect(foundTriple).toBe(true);
  });

  test('low-tall-density inputs prefer doubles (no unnecessary triples)', () => {
    // 1 tall + 25 normals — too few talls to need a triple. Doubles or
    // singles only.
    const itemRatios = [1.5, ...Array(25).fill(0.7)];
    let triplesEverFormed = false;
    for (let seed = 1; seed <= 10; seed++) {
      const placements = packLayout({
        itemRatios, W: 1152, H: 1080, random: seededRandom(seed),
      });
      if (!placements.length) continue;
      const tallCandidates = placements.filter(p => itemRatios[p.idx] > 1.1);
      const tallByX = new Map();
      for (const t of tallCandidates) {
        const key = Math.round(t.x / 5) * 5;
        if (!tallByX.has(key)) tallByX.set(key, []);
        tallByX.get(key).push(t);
      }
      for (const tiles of tallByX.values()) {
        if (tiles.length >= 2) { triplesEverFormed = true; break; }
      }
    }
    expect(triplesEverFormed).toBe(false);
  });
```

- [ ] **Step 2: Run — expect at least one of these tests to fail under current packLayout**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t "packLayout"`
Expected: the "packs at least one triple band" test fails (the algorithm doesn't yet generate triples).

- [ ] **Step 3: Replace `packLayout` body with the variant sweep**

Replace the current `packLayout` function body in `frontend/src/modules/Menu/arcadePacker.js` with:

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
  fillWeight = DEFAULT_FILL_WEIGHT,
  balanceWeight = DEFAULT_BALANCE_WEIGHT,
  capWeight = DEFAULT_CAP_PENALTY,
  areaCap = DEFAULT_TALL_AREA_CAP,
  random = Math.random,
  logger = null,
} = {}) {
  const log = (event, data) => { if (logger) logger.debug(event, data); };
  const logInfo = (event, data) => { if (logger) logger.info(event, data); };

  if (!itemRatios?.length || W <= 0 || H <= 0) {
    logInfo('pack.skip', { reason: 'invalid-input', N: itemRatios?.length || 0, W, H });
    return [];
  }
  const N = itemRatios.length;
  const maxAllowedRowH = H * maxRowPct;
  const { tallIndices } = classifyItems(itemRatios, tallThreshold);
  const tallSet = new Set(tallIndices);
  const K = tallIndices.length;

  logInfo('pack.start', {
    N, W, H, gap, maxRowPct, maxAllowedRowH: Math.round(maxAllowedRowH),
    tallThreshold, K,
  });

  let bestPlacements = null;
  let bestScore = -Infinity;
  let bestMeta = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const baseOrder = itemRatios.map((_, i) => i);
    for (let i = baseOrder.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [baseOrder[i], baseOrder[j]] = [baseOrder[j], baseOrder[i]];
    }

    const maxRows = Math.min(N, Math.floor(H / 30));
    let attemptBest = null;
    let attemptScore = -Infinity;
    let attemptMeta = null;

    for (let targetRows = 2; targetRows <= maxRows; targetRows++) {
      const refH = (H - (targetRows - 1) * gap) / targetRows;

      // Sweep (tripleCount, doubleCount) variants. With K talls:
      //   t triples + d doubles + s singles where 2t + d + s = K.
      // We enumerate all valid (t, d) pairs.
      for (let t = 0; t <= Math.floor(K / 2); t++) {
        for (let d = 0; d <= K - 2 * t; d++) {
          // Fresh order copy per variant — buildBands may splice the array.
          const order = baseOrder.slice();
          const bands = buildBands({
            itemRatios, order, tallThreshold, refH, W, gap, minPerRow,
            tripleCount: t, doubleCount: d,
          });

          // Pre-scale solve for maxRowPct rejection.
          const solved = bands.map(b => solveBandRaw(b, itemRatios, W, gap));
          if (solved.some(s => !s.valid)) {
            log('pack.variant.skip', { targetRows, t, d, reason: 'invalid-solve' });
            continue;
          }
          const violates = bands.some((band, i) => {
            if (band.type === 'single') return solved[i].rowH > maxAllowedRowH;
            if (band.type === 'double') {
              return solved[i].upper_h > maxAllowedRowH || solved[i].lower_h > maxAllowedRowH;
            }
            // triple
            return solved[i].top_h > maxAllowedRowH
              || solved[i].mid_h > maxAllowedRowH
              || solved[i].bot_h > maxAllowedRowH;
          });
          if (violates) {
            log('pack.variant.reject', { targetRows, t, d, reason: 'row-too-tall' });
            continue;
          }

          const rendered = renderBands({ bands, itemRatios, W, H, gap });
          if (!rendered.valid) {
            log('pack.variant.skip', { targetRows, t, d, reason: 'render-invalid' });
            continue;
          }

          const sc = scoreLayout({
            placements: rendered.placements, tallSet, N, W, H,
            fillWeight, balanceWeight, capWeight, areaCap,
          });

          const tripleCount = bands.filter(b => b.type === 'triple').length;
          const doubleCount = bands.filter(b => b.type === 'double').length;
          const singleCount = bands.filter(b => b.type === 'single').length;
          log('pack.variant.candidate', {
            targetRows, t, d,
            tripleCount, doubleCount, singleCount,
            fillRatio: +sc.fillRatio.toFixed(3),
            tallAreaFrac: +sc.tallAreaFrac.toFixed(3),
            balanceTerm: +sc.balanceTerm.toFixed(3),
            capPenalty: +sc.capPenalty.toFixed(3),
            score: +sc.score.toFixed(3),
          });

          if (sc.score > attemptScore) {
            attemptScore = sc.score;
            attemptBest = rendered.placements;
            attemptMeta = {
              targetRows, t, d, tripleCount, doubleCount, singleCount,
              fillRatio: +sc.fillRatio.toFixed(3),
              tallAreaFrac: +sc.tallAreaFrac.toFixed(3),
              score: +sc.score.toFixed(3),
            };
          }
        }
      }
    }

    if (attemptBest && attemptScore > bestScore) {
      bestScore = attemptScore;
      bestPlacements = attemptBest;
      bestMeta = { attempt, ...attemptMeta };
      break;
    }
  }

  if (!bestPlacements) {
    logInfo('pack.fail', { N, W, H, K, reason: 'no-valid-layout-across-attempts' });
    return [];
  }

  const mirrorH = random() < 0.5;
  const mirrorV = random() < 0.5;
  if (mirrorH || mirrorV) {
    bestPlacements.forEach(p => {
      if (mirrorH) p.x = W - p.x - p.w;
      if (mirrorV) p.y = H - p.y - p.h;
    });
  }
  logInfo('pack.done', { ...bestMeta, mirrorH, mirrorV });
  return bestPlacements;
}
```

Also extend the existing `solveBandRaw` helper (just above `packLayout`) to handle triple bands. Replace its body with:

```javascript
function solveBandRaw(band, itemRatios, W, gap) {
  if (band.type === 'single') {
    const ratios = band.items.map(i => itemRatios[i]);
    const r = solveSingleBand(ratios, W, gap);
    return { valid: r.valid, rowH: r.rowH };
  }
  if (band.type === 'double') {
    const tallRatio = itemRatios[band.talls[0]];
    const upperRatios = band.upper.map(i => itemRatios[i]);
    const lowerRatios = band.lower.map(i => itemRatios[i]);
    const r = solveDoubleBand({ tallRatio, upperRatios, lowerRatios, W, gap });
    return { valid: r.valid, H_pair: r.H_pair, upper_h: r.upper_h, lower_h: r.lower_h };
  }
  // triple
  const tallRatios = [itemRatios[band.talls[0]], itemRatios[band.talls[1]]];
  const topRatios = band.top.map(i => itemRatios[i]);
  const midRatios = band.mid.map(i => itemRatios[i]);
  const botRatios = band.bot.map(i => itemRatios[i]);
  const r = solveTripleBand({ tallRatios, topRatios, midRatios, botRatios, W, gap });
  return {
    valid: r.valid, H_triple: r.H_triple,
    top_h: r.top_h, mid_h: r.mid_h, bot_h: r.bot_h,
  };
}
```

- [ ] **Step 4: Run — expect PASS for the new packLayout tests**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs -t "packLayout"`
Expected: All packLayout tests pass, including the new triple-detection one.

- [ ] **Step 5: Run full file regression**

Run: `npx jest tests/isolated/frontend/arcadePacker.test.mjs`
Expected: 54 tests pass (52 from Task 4 + 2 new packLayout tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Menu/arcadePacker.js tests/isolated/frontend/arcadePacker.test.mjs
git commit -m "feat(arcadePacker): Monte Carlo (triples,doubles) variant sweep with composite scoring"
```

---

## Task 6: Visual verification on prod + threshold tuning

**Files:** none modified unless tuning is needed.

- [ ] **Step 1: Build and deploy**

Run from `/opt/Code/DaylightStation`:

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

Expected: container restarts cleanly; `sudo docker ps --filter name=daylight-station` shows it Up.

- [ ] **Step 2: Screenshot prod via Playwright**

Reuse `tmp_prod_screenshot.mjs` if still present, or create a 30-line script that hits `https://daylightlocal.kckern.net/screens/living-room/games`, waits for `.arcade-selector__navmap-item`, screenshots to `/tmp/arcade-prod.png`, and dumps tile geometry. Run it.

Expected: screenshot file exists, tile count ≈ 26, `valid` layout returned.

- [ ] **Step 3: Read the screenshot and dispatch a vision-agent confirmation**

Use the Read tool on `/tmp/arcade-prod.png`. Then dispatch a `general-purpose` Agent with a prompt that asks specifically:

> Look at /tmp/arcade-prod.png. The N64 game list has 4 tall tiles (Sonic, Bubble Bobble, Mario Tennis, Mario Kart Double Dash). With the new triple-row span feature, two of those tall tiles should be STACKED on the same vertical column (sharing width, one above the other), spanning three rows of N64 landscape boxart on the opposite side. Report whether you see exactly that pattern.

Expected: vision agent confirms one or more triple stacks exist visually.

- [ ] **Step 4: Tune `DEFAULT_TALL_AREA_CAP` if needed**

If the vision report says "talls still dominate", lower `DEFAULT_TALL_AREA_CAP` from `0.5` to `0.4` in `arcadePacker.js`. Conversely, if "no triples ever form", raise it to `0.6`. Re-run unit tests after any change:

```bash
npx jest tests/isolated/frontend/arcadePacker.test.mjs
```

Expected: 54/54 pass.

- [ ] **Step 5: Commit any tuning**

If `DEFAULT_TALL_AREA_CAP` (or any other constant) changed:

```bash
git add frontend/src/modules/Menu/arcadePacker.js
git commit -m "tune(arcadePacker): adjust tall area cap to <new value> based on visual review"
```

If no tuning was required, skip this step.

- [ ] **Step 6: Re-deploy if tuning happened**

Re-run Step 1's build + deploy commands if tuning landed in Step 5. Otherwise skip.

---

## Task 7: Final cleanup

**Files:**
- Possibly modify: `frontend/src/modules/Menu/arcadePacker.js` (only if dead code / stale comments lingered)

- [ ] **Step 1: Read `frontend/src/modules/Menu/arcadePacker.js` end-to-end**

Confirm:
- All exports needed by the public API are present: `packLayout`, `classifyItems`, `solveSingleBand`, `solveDoubleBand`, `solveTripleBand`, `buildBands`, `renderBands`, `scoreLayout`, plus the `DEFAULT_*` constants.
- `solveBandRaw` is internal (not exported).
- No `// TODO`, `// FIXME`, or commented-out code blocks remain.
- The file's leading docstring (lines 1–2) still accurately describes the module: "Pure layout primitives for ArcadeSelector. No React, no DOM. `random` is injectable so callers (and tests) can control determinism."

If anything stale is found, remove it.

- [ ] **Step 2: Run the full isolated frontend suite**

Run: `npx jest tests/isolated/frontend/`
Expected: all isolated frontend tests pass (the existing menu/fitness/etc tests + the 54 in arcadePacker.test.mjs).

- [ ] **Step 3: Final commit (only if Step 1 made changes)**

```bash
git add frontend/src/modules/Menu/arcadePacker.js
git commit -m "chore(arcadePacker): post-implementation cleanup"
```

If Step 1 found nothing to clean, skip this step.
