// Pure layout primitives for ArcadeSelector. No React, no DOM.
// `random` is injectable so callers (and tests) can control determinism.

const DEFAULT_GAP = 3;
const DEFAULT_MAX_ROW_PCT = 0.25;
const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_MIN_PER_ROW = 3;

export const DEFAULT_TALL_AREA_CAP = 0.5;
export const DEFAULT_FILL_WEIGHT = 1.0;
export const DEFAULT_BALANCE_WEIGHT = 1.0;
export const DEFAULT_CAP_PENALTY = 10.0;

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

    // Keep the absolute-best across all attempts. (Earlier code break-ed on
    // the first valid attempt, which silently turned the Monte Carlo into a
    // single-shuffle search — the additional shuffles never ran.)
    if (attemptBest && attemptScore > bestScore) {
      bestScore = attemptScore;
      bestPlacements = attemptBest;
      bestMeta = { attempt, ...attemptMeta };
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
  tripleCount = 0,
  doubleCount = Infinity,
}) {
  // Defensive copy: explicit-mode triple/double formation rewrites `order`
  // in-place to remove consumed normals. Cloning at entry makes the function
  // safe to call with any caller-owned array.
  order = order.slice();
  const { tallIndices } = classifyItems(itemRatios, tallThreshold);
  const tallSet = new Set(tallIndices);
  const isTall = (i) => tallSet.has(i);
  const widthAt = (i, h) => h / itemRatios[i];

  // Talls are consumed in encounter order: first 2*tripleCount form triples
  // (paired greedily), next doubleCount form doubles, rest become singles.
  // "Explicit mode" — caller specified band counts. We then skip-over talls
  // when filling wings and reserve normals for downstream bands. In default
  // mode (no caller args) we preserve legacy contiguous-only packing so the
  // pre-feature callers behave identically.
  const explicitMode = tripleCount > 0 || doubleCount !== Infinity;
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
            // Fill the 3 rows from normals reachable in `order` past the two
            // talls. Walk forward from i+1, skipping the second tall and any
            // intervening talls (those will be handled by their own bands
            // afterward); only normals feed the wing.
            //
            // Reservation: downstream doubles need ≥2 normals each (one upper +
            // one lower). Don't drain so many normals that subsequent doubles
            // can't form. We also leave 1 normal per remaining tall so single
            // tall fallbacks don't completely starve.
            const totalNormalsAhead = (() => {
              let n = 0;
              for (let k = i + 1; k < order.length; k++) {
                if (k === nextTallJ) continue;
                if (!isTall(order[k])) n++;
              }
              return n;
            })();
            // Count downstream talls — used to bound how many doubles can
            // actually form (Infinity default doesn't translate to real demand).
            const tallsAhead = (() => {
              let n = 0;
              for (let k = i + 1; k < order.length; k++) {
                if (k === nextTallJ) continue;
                if (isTall(order[k])) n++;
              }
              return n;
            })();
            const realisticDoubles = Math.min(doublesRemaining, tallsAhead);
            const reserveForDoubles = 2 * realisticDoubles;
            const tripleNormalCap = Math.max(3, totalNormalsAhead - reserveForDoubles);

            const top = [], mid = [], bot = [];
            const widths = [0, 0, 0];
            const arrs = [top, mid, bot];
            const consumedNormals = new Set();
            for (let k = i + 1; k < order.length; k++) {
              if (k === nextTallJ) continue;
              const cand = order[k];
              if (isTall(cand)) continue; // skip downstream talls — they're handled later
              if (consumedNormals.size >= tripleNormalCap) break;
              let target = 0;
              if (arrs[1].length < arrs[target].length) target = 1;
              if (arrs[2].length < arrs[target].length) target = 2;
              const w = widthAt(cand, refH);
              const next = widths[target] + (arrs[target].length > 0 ? gap : 0) + w;
              if (next > widthBudget) break;
              arrs[target].push(cand);
              widths[target] = next;
              consumedNormals.add(cand);
            }
            if (top.length >= 1 && mid.length >= 1 && bot.length >= 1) {
              bands.push({
                type: 'triple',
                talls: [idx, order[nextTallJ]],
                top, mid, bot,
              });
              triplesRemaining--;
              // Rebuild `order`: drop the two talls plus the consumed normals.
              // Items outside this triple keep their relative order.
              const remaining = [];
              for (let k = i + 1; k < order.length; k++) {
                if (k === nextTallJ) continue;
                if (consumedNormals.has(order[k])) continue;
                remaining.push(order[k]);
              }
              order.splice(i, order.length - i, ...remaining);
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
          if (!explicitMode) {
            // Legacy path: pull contiguous normals after the tall, stop on
            // either tall or width exhaustion. No order mutation.
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
          } else {
            // Explicit mode: skip downstream talls when filling, reserve
            // 2 normals for each remaining double-after-this so they don't
            // starve when talls cluster.
            let totalNormalsAhead = 0;
            let tallsAhead = 0;
            for (let k = i + 1; k < order.length; k++) {
              if (isTall(order[k])) tallsAhead++;
              else totalNormalsAhead++;
            }
            const realisticFutureDoubles = Math.min(
              doublesRemaining - 1,
              tallsAhead,
            );
            const reserveForFutureDoubles = 2 * Math.max(0, realisticFutureDoubles);
            const doubleNormalCap = Math.max(2, totalNormalsAhead - reserveForFutureDoubles);

            const upper = [];
            const lower = [];
            let uW = 0;
            let lW = 0;
            const consumedNormals = new Set();
            for (let k = i + 1; k < order.length; k++) {
              const cand = order[k];
              if (isTall(cand)) continue;
              if (consumedNormals.size >= doubleNormalCap) break;
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
              consumedNormals.add(cand);
            }
            if (upper.length >= 1 && lower.length >= 1) {
              bands.push({ type: 'double', talls: [idx], upper, lower });
              doublesRemaining--;
              const remaining = [];
              for (let k = i + 1; k < order.length; k++) {
                if (consumedNormals.has(order[k])) continue;
                remaining.push(order[k]);
              }
              order.splice(i, order.length - i, ...remaining);
              continue;
            }
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

export function renderBands({ bands, itemRatios, W, H, gap }) {
  // Phase 1: solve each band, collect heights.
  const solved = [];
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

  const totalH = solved.reduce((s, b) => s + b.height, 0) + (solved.length - 1) * gap;
  const scale = totalH > H ? H / totalH : 1;
  // When scaling down, scale inter-band gaps too so the total still fits H.
  const interBandGap = gap * scale;

  const placements = [];
  let y = scale === 1 ? (H - totalH) / 2 : 0;
  // Alternate the side that holds the tall tile(s) across consecutive big
  // bands (doubles AND triples share one cycle) so spans don't all cluster
  // on one edge. First big band → tall on LEFT, second → RIGHT, third →
  // LEFT, etc. The random mirror in packLayout adds another coin-flip on
  // top of this, so the visual entropy compounds. The single-band branch
  // does NOT bump this counter (singles have no tall to alternate).
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

      // After scaling, the band's total width is scale*W. Center it
      // horizontally when scale<1 (matches the single-band centering
      // behavior). bandW = max(upperRowW, lowerRowW) is the band's
      // effective horizontal extent including the tall column + the
      // widest non-tall row + their separator gap. Geometry is symmetric:
      // tall on left or right uses the same math, just an x-position flip.
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

      // Non-tall row tiles start where the tall ISN'T. Tall on left →
      // they start after tall.right + innerGap. Tall on right → they
      // start at the band's left edge (xOffset).
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

  return { valid: true, placements };
}

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
  // Asymmetric: only OVER-allocation (talls eating more area than their item
  // share) hurts the score. Under-allocation (talls successfully smaller than
  // their count would suggest) is the desired outcome — give it the maximum
  // balanceTerm of 1.0 instead of penalizing it.
  const balanceTerm = 1 - Math.max(0, tallAreaFrac - tallCountFrac);
  const capPenalty = Math.max(0, tallAreaFrac - areaCap);

  const score = fillWeight * fillRatio + balanceWeight * balanceTerm - capWeight * capPenalty;

  return {
    score, fillRatio, tallAreaFrac, tallCountFrac, balanceTerm, capPenalty, renderedTotalH,
  };
}
