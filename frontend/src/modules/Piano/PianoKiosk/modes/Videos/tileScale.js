// tileScale.js — overlay scale math for CourseGrid.jsx's course tiles, split
// out so Fast Refresh can hot-reload the grid component on its own.

/**
 * Overlay scale for the sequential badge + progress-ring chips (see
 * `--tile-scale` in PianoApp.scss), keyed off row count. Those overlays are
 * fixed-size (1.7rem badge, 1.85rem ring) against the --posters grid's fixed
 * 12.75rem tile; once balancedGrid needs 3+ rows to stay on one page the
 * tile itself has shrunk well below that, so the overlay must shrink too or
 * it dominates/clips a small poster. 1 = no shrink (≤2 rows, tiles still
 * near full size); steps down at 3/4/5+ rows.
 */
export function tileScaleFor(rows) {
  if (rows >= 5) return 0.55;
  if (rows >= 4) return 0.7;
  if (rows >= 3) return 0.85;
  return 1;
}
