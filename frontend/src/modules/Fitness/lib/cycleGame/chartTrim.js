// Where a rider's distance line should begin on the race chart.
//
// A rider held in the penalty box at the start (or who simply hasn't moved yet)
// accrues zero distance for the first ticks. Drawing those as a flat line along
// the x-axis reads like they were racing-but-stuck; instead we begin the line at
// the moment they first move, so a late start (e.g. served a penalty) is obvious.
//
// Returns the index to START plotting at — anchored to the last zero sample just
// before the first movement, so the line emerges from the axis at the late-start
// x rather than mid-air. Returns -1 when the rider never moved (draw nothing —
// no flat zero line at all).
export function plotStartIndex(series) {
  if (!Array.isArray(series) || series.length === 0) return -1;
  const firstMoving = series.findIndex((d) => Number.isFinite(d) && d > 0);
  if (firstMoving === -1) return -1;
  return Math.max(0, firstMoving - 1);
}

export default plotStartIndex;
