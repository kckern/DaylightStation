// The episode thumbnail's 3×3 grid, as data. The stills arrive in runtime
// order; each cell owns one consecutive slice of them, so cell 0 is always the
// opening minutes and cell 8 the closing ones, and as a cell refreshes it moves
// forward through its own slice. One cell changes per tick, in reading order.

export const CELLS = 9;
export const CELL_MS = 1000;

/**
 * Split the episode's stills (runtime order) into one pool per cell. With nine
 * or more every still is used exactly once; with fewer, the ones there are
 * are spread across the grid in order, one per cell.
 * @param {string[]|null} stills
 * @returns {string[][]}
 */
export function cellPools(stills, cells = CELLS) {
  const n = Array.isArray(stills) ? stills.length : 0;
  if (n === 0) return [];
  if (n < cells) return Array.from({ length: cells }, (_, c) => [stills[Math.floor((c * n) / cells)]]);
  return Array.from({ length: cells }, (_, c) =>
    stills.slice(Math.floor((c * n) / cells), Math.floor(((c + 1) * n) / cells)));
}

/** The cell that refreshes on this tick: top-left, top-centre, top-right, … */
export const cellForTick = (tick, cells = CELLS) => ((tick % cells) + cells) % cells;

/**
 * The cell's next still after the one it shows, wrapping round and stepping
 * over any that failed to load; null when there is nothing else to show.
 * @param {string[]} pool
 * @param {number} current
 * @param {Record<string, 'loaded'|'failed'>} status
 */
export function nextFrame(pool, current, status) {
  const n = pool?.length || 0;
  for (let step = 1; step < n; step += 1) {
    const i = (current + step) % n;
    if (status[pool[i]] !== 'failed') return i;
  }
  return null;
}

// A still whose brightness barely varies edge to edge — a fade to black or
// white, a blank loading screen — reads as an empty cell, so the grid passes
// over it as if it had failed to load. Measured on a 16×9 sample.
export const FLAT_LUMA_SD = 8;
export const LUMA_SAMPLE = { w: 16, h: 9 };

/** @param {number[]|null} lumas 0–255 brightness samples */
export function isFlatLuma(lumas) {
  if (!lumas || lumas.length === 0) return false;
  const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length;
  const variance = lumas.reduce((a, b) => a + (b - mean) ** 2, 0) / lumas.length;
  return Math.sqrt(variance) < FLAT_LUMA_SD;
}

/** Brightness samples of a loaded image, or null when it cannot be read. */
export function sampleLuma(img) {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = LUMA_SAMPLE.w;
    canvas.height = LUMA_SAMPLE.h;
    const ctx = canvas.getContext?.('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, LUMA_SAMPLE.w, LUMA_SAMPLE.h);
    const { data } = ctx.getImageData(0, 0, LUMA_SAMPLE.w, LUMA_SAMPLE.h);
    const lumas = [];
    for (let i = 0; i < data.length; i += 4) lumas.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    return lumas;
  } catch {
    return null; // unreadable (e.g. cross-origin): show it
  }
}
