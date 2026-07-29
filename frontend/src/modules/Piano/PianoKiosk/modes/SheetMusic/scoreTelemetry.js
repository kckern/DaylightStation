/**
 * scoreTelemetry — pure timing math for the sheet-music player's logs-only
 * telemetry. No logging here (callers emit); this just turns raw deltas into the
 * numbers the log events carry, so it's unit-testable off the DOM.
 */
// A stall is the VISUAL plane falling behind by a musically meaningful amount.
// A fixed ms budget is wrong at both ends of the tempo range — 120ms is
// inaudible at 60bpm and half a beat at 216bpm — so scale to the beat and clamp
// to a band that stays sane at extreme tempi.
const STALL_BEAT_FRACTION = 0.25;
const STALL_FLOOR_MS = 60;
const STALL_CEIL_MS = 250;

/** Drift (ms) past which a fire counts as a stall, at a given tempo. */
export function stallThresholdMs(bpm) {
  const b = Number.isFinite(bpm) && bpm > 0 ? bpm : 90;
  const quarterBeat = (60000 / b) * STALL_BEAT_FRACTION;
  return Math.min(STALL_CEIL_MS, Math.max(STALL_FLOOR_MS, quarterBeat));
}

export function summarizeDrift(deltas, { stallMs = 120 } = {}) {
  const d = (deltas || []).filter((x) => Number.isFinite(x));
  if (!d.length) return { count: 0, meanDriftMs: 0, p95DriftMs: 0, maxDriftMs: 0, stalls: 0 };
  const sorted = [...d].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const sum = d.reduce((a, b) => a + b, 0);
  return {
    count: d.length,
    meanDriftMs: sum / d.length,
    p95DriftMs: p95,
    maxDriftMs: sorted[sorted.length - 1],
    stalls: d.filter((x) => x >= stallMs).length,
  };
}

const TIGHT_MS = 25;
export function classifyFollowHit({ expectedMs, actualMs }) {
  const driftMs = Math.round(actualMs - expectedMs);
  const feel = Math.abs(driftMs) <= TIGHT_MS ? 'tight' : driftMs < 0 ? 'rush' : 'drag';
  return { driftMs, feel };
}

/**
 * Learn is SELF-PACED: the cursor waits for the player, so "drift" against the
 * written note duration is meaningless there (expectedMs is ~94ms, so every human
 * response classifies as `drag` and `tight` is unreachable — 24 of 31 field records
 * were `drag`, audit M5b). Summarize the user's own step-to-step intervals
 * instead — a median and a tail, no verdict.
 *
 * Median convention: for an even count this takes the UPPER of the two middle
 * values rather than their mean. These are pacing samples, not a statistic anyone
 * averages downstream, so an actual observed interval is preferable to a synthetic
 * midpoint.
 */
export function summarizeStepIntervals(intervals) {
  const d = (intervals || []).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!d.length) return { count: 0, medianStepMs: 0, p95StepMs: 0 };
  return {
    count: d.length,
    medianStepMs: Math.round(d[Math.floor(d.length / 2)]),
    p95StepMs: Math.round(d[Math.min(d.length - 1, Math.floor(d.length * 0.95))]),
  };
}

// classifyFollowHit stays exported but is NO LONGER called from the Learn path:
// Polish is graded at tempo, where a written-duration comparison is meaningful.
export default { summarizeDrift, classifyFollowHit, stallThresholdMs, summarizeStepIntervals };
