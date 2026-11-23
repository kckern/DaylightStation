// The beat loop of "Settle into a beat": which beat of the bar the click is on, for a marker above the score.
// Pure. The click is anchored at `anchorMs` (the instant its first beat SOUNDS), so the marker reads the same grid.

/** How long after the run is ready the first click sounds: room for the scheduler to book it. */
export const BEAT_LOOP_LEAD_MS = 200;

/**
 * @param {{anchorMs:number, nowMs:number, periodMs:number, beats:number}} grid
 * @returns {{beat:number, beats:number, index:number}|null} `beat` is 1..beats (0 before the first click);
 *   `index` counts clicks since the first. Null for a grid that cannot be read.
 */
export function beatLoopPosition({ anchorMs, nowMs, periodMs, beats }) {
  if (!Number.isFinite(anchorMs) || !Number.isFinite(nowMs) || !(periodMs > 0) || !Number.isInteger(beats) || beats < 1) return null;
  if (nowMs < anchorMs) return { beat: 0, beats, index: -1 };
  const index = Math.floor((nowMs - anchorMs) / periodMs);
  return { beat: (index % beats) + 1, beats, index };
}
