// Pure layout primitives for ArcadeSelector. No React, no DOM.
// `random` is injectable so callers (and tests) can control determinism.

const DEFAULT_GAP = 3;
const DEFAULT_MAX_ROW_PCT = 0.25;
const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_MIN_PER_ROW = 3;

// Solve a band's pre-scale dimensions using the same primitives renderBands
// uses internally. Returns { rowH } for singles or { H_pair, upper_h, lower_h }
// for doubles, plus a `valid` flag. Used by packLayout to perform the
// maxRowPct rejection BEFORE renderBands applies any scale-down — the legacy
// behavior. (renderBands itself returns post-scale heights, which can mask
// oversized rows that get hidden by aggressive scale-down.)
function solveBandRaw(band, itemRatios, W, gap) {
  if (band.type === 'single') {
    const ratios = band.items.map(i => itemRatios[i]);
    const r = solveSingleBand(ratios, W, gap);
    return { valid: r.valid, rowH: r.rowH };
  }
  const tallRatio = itemRatios[band.talls[0]];
  const upperRatios = band.upper.map(i => itemRatios[i]);
  const lowerRatios = band.lower.map(i => itemRatios[i]);
  const r = solveDoubleBand({ tallRatio, upperRatios, lowerRatios, W, gap });
  return { valid: r.valid, H_pair: r.H_pair, upper_h: r.upper_h, lower_h: r.lower_h };
}

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
  const tallCount = itemRatios.filter(r => r > tallThreshold).length;

  logInfo('pack.start', {
    N, W, H, gap, maxRowPct, maxAllowedRowH: Math.round(maxAllowedRowH),
    tallThreshold, tallCount,
  });

  let bestPlacements = null;
  let bestScore = -Infinity;
  let bestMeta = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const order = itemRatios.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    // Cap at N (worst case: one tile per row) AND at H/30 (no row smaller than
    // a thumbnail). The legacy `ceil(N/2)` cap was masked by the buggy post-
    // scale maxRowPct check; with the pre-scale check restored, we must let
    // the sweep go higher to find narrow-enough refH values.
    const maxRows = Math.min(N, Math.floor(H / 30));
    let attemptBest = null;
    let attemptScore = -Infinity;
    let attemptMeta = null;

    for (let targetRows = 2; targetRows <= maxRows; targetRows++) {
      const refH = (H - (targetRows - 1) * gap) / targetRows;

      const bands = buildBands({
        itemRatios, order, tallThreshold, refH, W, gap, minPerRow,
      });

      // Pre-scale solve: get raw heights for the maxRowPct check.
      const solved = bands.map(b => solveBandRaw(b, itemRatios, W, gap));
      if (solved.some(s => !s.valid)) {
        log('pack.targetRows.skip', { targetRows, refH: +refH.toFixed(1), reason: 'invalid-solve' });
        continue;
      }

      // Reject if any non-tall row exceeds maxRowPct of H (PRE-scale).
      // Tall tiles in double bands are allowed to exceed it — that's the point.
      const violates = bands.some((band, i) => {
        if (band.type === 'single') return solved[i].rowH > maxAllowedRowH;
        return solved[i].upper_h > maxAllowedRowH || solved[i].lower_h > maxAllowedRowH;
      });
      if (violates) {
        const maxRowH = Math.round(Math.max(...solved.map(s =>
          s.rowH ?? Math.max(s.upper_h ?? 0, s.lower_h ?? 0)
        )));
        log('pack.targetRows.reject', {
          targetRows, refH: +refH.toFixed(1), maxRowH, maxAllowedRowH: Math.round(maxAllowedRowH),
          reason: 'row-too-tall',
        });
        continue;
      }

      const rendered = renderBands({ bands, itemRatios, W, H, gap });
      if (!rendered.valid) {
        log('pack.targetRows.skip', { targetRows, refH: +refH.toFixed(1), reason: 'render-invalid' });
        continue;
      }

      // totalH from solved bands (pre-scale) tells us whether scale-down was
      // applied; renderedTotalH (post-scale) reports the actual placed range.
      const rawTotalH = solved.reduce((s, b) => s + (b.rowH ?? b.H_pair), 0)
        + (solved.length - 1) * gap;
      const renderedTotalH = rendered.placements.reduce(
        (m, p) => Math.max(m, p.y + p.h), 0,
      );
      const fillRatio = renderedTotalH / H;
      const score = fillRatio <= 1 ? fillRatio : 1 / fillRatio;

      const singleCount = bands.filter(b => b.type === 'single').length;
      const doubleCount = bands.filter(b => b.type === 'double').length;
      log('pack.targetRows.candidate', {
        targetRows, refH: +refH.toFixed(1), bands: bands.length, singleCount, doubleCount,
        rawTotalH: Math.round(rawTotalH), renderedTotalH: Math.round(renderedTotalH),
        scaleApplied: rawTotalH > H, fillRatio: +fillRatio.toFixed(3), score: +score.toFixed(3),
      });

      if (score > attemptScore) {
        attemptScore = score;
        attemptBest = rendered.placements;
        attemptMeta = { targetRows, bands: bands.length, singleCount, doubleCount,
          rawTotalH: Math.round(rawTotalH), renderedTotalH: Math.round(renderedTotalH) };
      }
    }

    if (attemptBest && attemptScore > bestScore) {
      bestScore = attemptScore;
      bestPlacements = attemptBest;
      bestMeta = { attempt, ...attemptMeta, score: +attemptScore.toFixed(3) };
      break;
    }
  }

  if (!bestPlacements) {
    logInfo('pack.fail', { N, W, H, reason: 'no-valid-layout-across-attempts' });
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

// Anything taller than a square (h/w > 1.1, with a small buffer for thumbs
// that measure slightly off from a true square) is treated as a "tall" tile
// and becomes a candidate for spanning two rows. Marginal-portrait items like
// Mario Tennis (~1.398) and Mario Kart Double Dash (~1.4) stand out visually
// against landscape neighbors and benefit from the span treatment.
export const DEFAULT_TALL_THRESHOLD = 1.1;

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
  // Alternate the side that holds the tall tile across consecutive double
  // bands so spans don't all cluster on one edge. First double goes left,
  // second goes right, third left, etc. (Random mirror in packLayout adds
  // another coin-flip on top of this, so the visual entropy compounds.)
  let doubleBandIndex = 0;

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
      const innerGap = gap * scale; // intra-band gaps scale uniformly with rows
      const tallIdx = s.band.talls[0];
      const tallOnLeft = doubleBandIndex % 2 === 0;
      doubleBandIndex++;

      // After scaling, the band's total width is scale*W. Center it horizontally
      // when scale < 1 (matches the single-band horizontal-centering behavior).
      const upperRowW = w_t + innerGap
        + s.band.upper.reduce((sum, i) => sum + upper_h / itemRatios[i], 0)
        + Math.max(0, s.band.upper.length - 1) * innerGap;
      const lowerRowW = w_t + innerGap
        + s.band.lower.reduce((sum, i) => sum + lower_h / itemRatios[i], 0)
        + Math.max(0, s.band.lower.length - 1) * innerGap;
      const bandW = Math.max(upperRowW, lowerRowW);
      const xOffset = scale < 1 ? (W - bandW) / 2 : 0;

      // Tall on left or right, with non-tall row tiles filling the opposite
      // side. Geometry is symmetric so the math is identical either way.
      const tallX = tallOnLeft ? xOffset : xOffset + bandW - w_t;
      placements.push({
        idx: tallIdx, x: tallX, y, w: w_t, h: upper_h + innerGap + lower_h,
      });

      // Non-tall tiles start where the tall ISN'T. If tall is on the left,
      // they begin at tall.right + innerGap. If tall is on the right, they
      // begin at xOffset (the band's left edge).
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
    }
  }

  return { valid: true, placements };
}
