/**
 * What "the playhead is stuck" means, defined once for both sides of the wire.
 *
 * Two detectors read the same 5s device-state heartbeat and must reach the same
 * verdict, for different reasons: the backend PlaybackStallDetector alerts a
 * human, and the kiosk's own watch files a feedback report carrying the client
 * log ring the backend never sees. If they disagreed, one of them would either
 * page nobody or page constantly, and the exclusions below are exactly where
 * that drift would happen.
 *
 * The rules are conservative by design. A detector that cries wolf is ignored,
 * so every ambiguous case resolves to "not a stall".
 */

/**
 * Seconds of movement below which the playhead counts as unchanged. Media
 * elements report fractional drift while genuinely frozen, so exact equality
 * would miss real stalls.
 */
export const POSITION_EPSILON_SEC = 0.25;

/** How close to the declared duration counts as parked at the end. */
export const END_OF_ITEM_EPSILON_SEC = 1.5;

/** How long a motionless playhead must persist before it is a verdict. */
export const STALL_THRESHOLD_MS = 60_000;

/** Fewest observations that can support a verdict; below this it is a guess. */
export const STALL_MIN_SAMPLES = 3;

/**
 * Whether this item's playhead is expected to advance at all.
 *
 * Live content has no meaningful position to compare. So does content whose
 * duration we were never told — an absent duration is exactly how a live stream
 * presents in a SessionSnapshot, so we decline to guess rather than page
 * somebody about a livestream that is behaving normally.
 *
 * @param {object|null} item - a PlayableItem from SessionSnapshot.currentItem
 * @returns {boolean}
 */
export function isStallableItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.isLive === true || item.live === true || item.format === 'live') return false;
  const duration = Number(item.duration);
  return Number.isFinite(duration) && duration > 0;
}

/**
 * Whether the playhead is sitting on the tail of the item. That is a finished
 * item waiting to advance, which the end-of-content watchdog owns, not a stall.
 *
 * @param {object|null} item
 * @param {number} position - seconds
 * @returns {boolean}
 */
export function isAtEndOfItem(item, position) {
  const duration = Number(item?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return false;
  return position >= duration - END_OF_ITEM_EPSILON_SEC;
}

/**
 * Whether the playhead moved. Movement in EITHER direction counts: a backwards
 * seek is progress too, because it proves the player is still responding.
 *
 * @param {number} previous - seconds
 * @param {number} next - seconds
 * @param {number} [epsilon=POSITION_EPSILON_SEC]
 * @returns {boolean}
 */
export function positionAdvanced(previous, next, epsilon = POSITION_EPSILON_SEC) {
  return Math.abs(next - previous) > epsilon;
}

/**
 * Whether a snapshot is one this detector has any opinion about. Only a device
 * insisting it is `playing` can be stuck: paused, buffering (a long seek can sit
 * there for minutes), loading, stalled, ended, error and idle all have a
 * legitimate reason for a motionless playhead.
 *
 * @param {object|null} snapshot - a SessionSnapshot
 * @returns {boolean}
 */
export function isProgressExpected(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (snapshot.state !== 'playing') return false;
  if (!isStallableItem(snapshot.currentItem)) return false;
  const position = Number(snapshot.position);
  if (!Number.isFinite(position)) return false;
  return !isAtEndOfItem(snapshot.currentItem, position);
}
