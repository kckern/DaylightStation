// gridLayout.js — how big the cover tiles are, and how they are arranged.
//
// The arcade holds a handful of games per console, not a library of hundreds,
// and it is read from across a garage. A fixed tile size cannot serve both ends
// of that: at the size that fits a full shelf, one game is a stamp adrift in a
// black field. So the tiles are sized to the room they have.
//
// The box art is the whole interface here — there is no caption, no chrome, no
// metadata. Making it big is the design.

/** Never smaller than this, however many games appear. */
export const MIN_TILE = 120;
/** Never larger than this, so a single game reads as a poster and not a wall. */
export const MAX_TILE = 420;
/** Share of the panel a single row may occupy before the cap takes over. */
export const HEIGHT_BUDGET = 0.86;
/** One gutter value for both axes: an even grid reads as deliberate. */
export const GAP = 28;
/**
 * A taller arrangement must beat the current best by this much to be worth an
 * extra row. Without it, four games flip between one row and two on a
 * one-pixel difference, which looks arbitrary from the outside.
 */
const ROW_BIAS = 1.02;

/**
 * Largest tile height that fits `count` tiles of `aspect` into `width`x`height`.
 *
 * Rows are tried shortest-first, so a single row wins ties and the shelf stays
 * a shelf until a second row genuinely buys space.
 *
 * @param {object} args
 * @param {number} args.width   available px
 * @param {number} args.height  available px
 * @param {number} args.count   number of tiles
 * @param {number} [args.aspect] tile width / height (1 = square)
 * @param {number} [args.gap]
 * @returns {{ tile: number, columns: number, rows: number, gap: number }}
 */
export function computeGridLayout({ width, height, count, aspect = 1, gap = GAP }) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const n = Math.max(0, Math.floor(count) || 0);
  if (n === 0) return { tile: MIN_TILE, columns: 1, rows: 0, gap };
  if (!(width > 0) || !(height > 0)) return { tile: MIN_TILE, columns: n, rows: 1, gap };

  let best = { tile: 0, columns: n, rows: 1 };
  for (let rows = 1; rows <= n; rows += 1) {
    const columns = Math.ceil(n / rows);
    const cellW = (width - gap * (columns - 1)) / columns;
    const cellH = (height - gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    // Fit the tile inside the cell: height is the constant we solve for.
    const tile = Math.min(cellH, cellW / a);
    if (tile > best.tile * ROW_BIAS) best = { tile, columns, rows };
  }

  const ceiling = Math.min(MAX_TILE, height * HEIGHT_BUDGET);
  const tile = Math.max(MIN_TILE, Math.min(best.tile, ceiling));
  return { tile: Math.floor(tile), columns: best.columns, rows: best.rows, gap };
}

export default computeGridLayout;
