/**
 * Did the household actually play this, or did the player just stop?
 *
 * `Player.handleResilienceExhausted` calls the SAME `clear()` callback as a real
 * ending, so "the media element said it ended" proves nothing. The evidence that
 * does prove something is coverage: the union of the ranges the browser reports
 * it actually rendered, banked across reloads.
 *
 * WHY 95% AND NOT 100. Recordings carry trailing silence, and a final progress
 * sample is lost whenever the tab is closed on the last second. A strict 100%
 * strands a child who genuinely listened and leaves them no way to say so. 5% of
 * a forty-minute lecture is two minutes, which is not enough to skip anything a
 * gate cares about.
 *
 * WHY RATE IS HERE. Coverage alone is satisfied by playing at 2x. The rate is
 * the child's, not the file's, so it travels with the coverage report and is
 * checked in the same place.
 *
 * Pure: no clock, no I/O.
 */
export const SATISFACTION_THRESHOLD = 0.95;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Normalise a bag of `[start, end]` pairs into sorted, non-overlapping ranges.
 * Unusable entries are DROPPED rather than thrown on: this input arrives from a
 * browser across a network, and one malformed pair must not cost a child the
 * coverage they earned.
 *
 * Ranges that merely touch (`[0,10]`, `[10,20]`) are joined — they describe one
 * continuous listen split by a progress report landing between them.
 */
export function mergeRanges(ranges) {
  const usable = (Array.isArray(ranges) ? ranges : [])
    .filter((r) => Array.isArray(r) && isFiniteNumber(r[0]) && isFiniteNumber(r[1]) && r[1] > r[0])
    .map(([start, end]) => [Math.max(0, start), end])
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [start, end] of usable) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Total seconds covered by the union of the ranges. */
export function coveredSeconds(ranges) {
  return mergeRanges(ranges).reduce((total, [start, end]) => total + (end - start), 0);
}

/** 0..1. Zero when the duration is unknown — never a division by nothing. */
export function coverageFraction({ ranges, duration } = {}) {
  if (!isFiniteNumber(duration) || duration <= 0) return 0;
  return Math.min(1, coveredSeconds(ranges) / duration);
}

/**
 * @param {{ranges: Array<[number, number]>, duration: number, maxRate?: number}} args
 *   `maxRate` is the fastest playback rate observed during the play; absent means
 *   normal speed, because a client that never changed it has nothing to report.
 */
export function isSatisfied({ ranges, duration, maxRate = 1 } = {}) {
  if (isFiniteNumber(maxRate) && maxRate > 1) return false;
  return coverageFraction({ ranges, duration }) >= SATISFACTION_THRESHOLD;
}

export default {
  SATISFACTION_THRESHOLD, mergeRanges, coveredSeconds, coverageFraction, isSatisfied,
};
