/**
 * gridNav — pure index math for keyboard/gamepad navigation of a wrapping grid.
 *
 * The arcade grid is centered and wraps, so the column count is measured from
 * the DOM at render time and passed in here. Movement clamps at edges (no wrap)
 * except left/right which flow across rows for a natural linear feel.
 */

/**
 * @param {object} opts
 * @param {number} opts.index    current focused index
 * @param {number} opts.count    total tiles
 * @param {number} opts.columns  measured columns in the grid (>=1)
 * @param {'up'|'down'|'left'|'right'} opts.dir
 * @returns {number} next index (clamped to [0, count-1])
 */
export function nextGridIndex({ index, count, columns, dir }) {
  if (count <= 0) return 0;
  const cols = Math.max(1, columns | 0);
  const i = Math.max(0, Math.min(count - 1, index | 0));
  switch (dir) {
    case 'left':
      return Math.max(0, i - 1);
    case 'right':
      return Math.min(count - 1, i + 1);
    case 'up': {
      const up = i - cols;
      return up >= 0 ? up : i; // stay put if already on the top row
    }
    case 'down': {
      const down = i + cols;
      return down < count ? down : i; // stay put if no tile below
    }
    default:
      return i;
  }
}

export default { nextGridIndex };
