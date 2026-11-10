/**
 * Grid cells, rectangles and region tracks.
 *
 * Cells are numbered row-major from 0 within an n x n grid over the video
 * picture. Grids nest when the fine size is a multiple of the coarse one
 * (3 -> 6, 4 -> 8). A region track is a list of keyframes, each holding
 * until the next: { in, grid, cells, box? }; a final keyframe with no cells
 * ends the track.
 */

export function cellRect(grid, cell) {
  const r = Math.floor(cell / grid); const c = cell % grid;
  return { x: c / grid, y: r / grid, w: 1 / grid, h: 1 / grid };
}

/** The fine-grid cells inside one coarse cell. */
export function subCells(coarse, cell, fine) {
  if (fine % coarse) throw new Error(`grid ${fine} does not nest in ${coarse}`);
  const k = fine / coarse;
  const r = Math.floor(cell / coarse); const c = cell % coarse;
  const out = [];
  for (let dr = 0; dr < k; dr++) for (let dc = 0; dc < k; dc++) out.push((r * k + dr) * fine + (c * k + dc));
  return out;
}

/** Smallest rectangle covering a set of cells. */
export function boundingRect(grid, cells) {
  if (!cells.length) return null;
  const rows = cells.map((c) => Math.floor(c / grid)); const cols = cells.map((c) => c % grid);
  const r0 = Math.min(...rows); const r1 = Math.max(...rows); const c0 = Math.min(...cols); const c1 = Math.max(...cols);
  return round({ x: c0 / grid, y: r0 / grid, w: (c1 - c0 + 1) / grid, h: (r1 - r0 + 1) / grid });
}

function round(r) {
  const f = (v) => Math.round(v * 1000) / 1000;
  return { x: f(r.x), y: f(r.y), w: f(r.w), h: f(r.h) };
}

/** Fraction of the picture a cell set covers. */
export function coverage(grid, cells) {
  return new Set(cells).size / (grid * grid);
}

/** Jaccard overlap of two cell sets on the same grid. */
export function overlap(a, b) {
  const A = new Set(a); const B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 1;
}

/**
 * Judge a track: trackable, or whole-frame with a reason.
 * @param {Array<{ in: number, grid: number, cells: number[]|null }>} keys - cells null = model abstained
 * @param {{ minOverlap?: number, maxCoverage?: number, maxAbstain?: number }} [opts]
 */
export function assessTrack(keys, { minOverlap = 0.5, maxCoverage = 0.5, maxAbstain = 0.25 } = {}) {
  const live = keys.filter((k) => k.cells != null);
  const abstain = (keys.length - live.length) / Math.max(1, keys.length);
  if (abstain > maxAbstain) return { trackable: false, reason: 'abstain' };
  if (!live.length) return { trackable: false, reason: 'abstain' };
  if (live.some((k) => coverage(k.grid, k.cells) > maxCoverage)) return { trackable: false, reason: 'covers-most' };
  for (let i = 1; i < live.length; i++) {
    if (live[i].cuts) continue; // a cut may legitimately jump
    const a = live[i - 1]; const b = live[i];
    if (a.grid !== b.grid || !a.cells.length || !b.cells.length) continue;
    // Content that moves stays near where it was: overlap, or touching cells
    if (overlap(a.cells, b.cells) < minOverlap && !touching(a.grid, a.cells, b.cells)) return { trackable: false, reason: 'jumpy' };
  }
  return { trackable: true };
}

/** Some cell of `a` is the same as, or next to (incl. diagonally), some cell of `b`. */
export function touching(grid, a, b) {
  return a.some((x) => b.some((y) => Math.abs(Math.floor(x / grid) - Math.floor(y / grid)) <= 1 && Math.abs((x % grid) - (y % grid)) <= 1));
}

/** Drop keyframes that repeat the previous one's cells. */
export function simplifyTrack(keys) {
  const out = [];
  for (const k of keys) {
    const prev = out[out.length - 1];
    if (prev && prev.grid === k.grid && sameCells(prev.cells, k.cells)) continue;
    out.push(k);
  }
  return out;
}

function sameCells(a, b) {
  const A = [...new Set(a || [])].sort(); const B = [...new Set(b || [])].sort();
  return A.length === B.length && A.every((x, i) => x === B[i]);
}
