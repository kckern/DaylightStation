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

export function solveSingleBand(ratios, W, gap) {
  if (!ratios.length) return { rowH: 0, valid: false };
  const gaps = (ratios.length - 1) * gap;
  const invSum = ratios.reduce((s, r) => s + 1 / r, 0);
  const rowH = (W - gaps) / invSum;
  if (rowH <= 0) return { rowH: 0, valid: false };
  return { rowH, valid: true };
}

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
  if (!valid) return { valid: false, H_pair: 0, w_t: 0, upper_h: 0, lower_h: 0 };
  return { valid, H_pair, w_t, upper_h, lower_h };
}

// Greedy: walk `order`. For each tall index, open a double band and pull
// subsequent normal indices to fill upper/lower halves until adding the next
// item would exceed `widthBudget` (estimated using `refH`). For each normal
// index, extend the current single band until adding the next tile would
// overflow W.
//
// Constraints (initial implementation):
//   - At most ONE tall tile per double band.
//   - Both upper and lower halves must contain >= 1 normal tile, otherwise
//     the tall is emitted as a single-band tile.
//   - Upper/lower split alternates by count so |n_u - n_l| <= 1. (Width-
//     balanced splitting is a future improvement; revisit if Task 8 visual
//     review shows visible asymmetry.)
//   - Trailing-merge only handles the LAST band — mid-stream short singles
//     stay short. Revisit if Task 8 finds them ugly.
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
      // NOTE: this is a low estimate — the closed-form `solveDoubleBand` will
      // typically yield H_pair (and therefore w_t) larger than this guess, so
      // the actual upper_h / lower_h shrink below refH. If Task 8 visual
      // review shows starved half-rows or maxRowPct rejections, raise the
      // guess (e.g. 2.5 * refH + gap) or iteratively re-solve.
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
  // When scaling down, scale inter-band gaps too so the total still fits H.
  const interBandGap = gap * scale;

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
      y += rowH + interBandGap;
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
      y += upper_h + gap + lower_h + interBandGap;
    }
  }

  return { valid: true, placements };
}
