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
