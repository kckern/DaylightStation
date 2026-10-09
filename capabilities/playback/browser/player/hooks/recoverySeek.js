/**
 * Decide the recovery seek position. A Plex transcode that wedges at a segment
 * makes re-seeking to the same offset reproduce the stall forever (June 8
 * incident). After `maxSamePositionRetries` consecutive failures at the same
 * position, nudge the seek forward by `nudgeSeconds` to move past the poisoned
 * segment. A changed base position resets the counter.
 *
 * @param {object} args
 * @param {number} args.baseSeekMs - the seek the resilience layer would use
 * @param {{lastSeekMs:number|null, sameCount:number}} args.tracker - prior state
 * @param {{nudgeSeconds:number, maxSamePositionRetries:number}} args.config
 * @returns {{seekMs:number, tracker:{lastSeekMs:number, sameCount:number}}}
 */
export function computeRecoverySeekMs({ baseSeekMs, tracker, config }) {
  const base = Number.isFinite(baseSeekMs) ? Math.max(0, baseSeekMs) : 0;
  const samePosition = tracker?.lastSeekMs != null && Math.abs(tracker.lastSeekMs - base) < 1000;

  if (!samePosition) {
    return { seekMs: base, tracker: { lastSeekMs: base, sameCount: 1 } };
  }

  const nextCount = (tracker.sameCount || 0) + 1;
  if (nextCount > config.maxSamePositionRetries) {
    const nudged = base + config.nudgeSeconds * 1000;
    return { seekMs: nudged, tracker: { lastSeekMs: nudged, sameCount: 1 } };
  }
  return { seekMs: base, tracker: { lastSeekMs: base, sameCount: nextCount } };
}
