// The clip context the surround frame draws its `clip:` regions from.
//
// A queue item that carries a `segment` window plays only that slice of its
// media (a single piece cut from a whole concert). The frame swaps to the
// definition's `clip:` regions for it, and the modules there need three things
// no payload holds: the window itself, where the clip sits in the queue, and
// what plays next. The host reads them off the Player handle on its poll and
// puts them on the payload as `data.clip`; modules never read the player.

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

const call = (fn) => {
  try { return typeof fn === 'function' ? fn() : null; } catch (_) { return null; }
};

const describeEntry = (entry) => (entry
  ? { title: entry.title ?? null, subtitle: entry.subtitle ?? null }
  : null);

/**
 * @param {object|null} item - The now-playing item (`getNowPlaying().item`)
 * @param {object|null} handle - The Player's imperative handle
 * @returns {{ segment: {start: number, end: number}, index: number|null,
 *   total: number|null, next: {title: string|null, subtitle: string|null}|null }|null}
 *   null when the item is not a clip.
 */
export function clipContext(item, handle) {
  const segment = item && typeof item === 'object' ? item.segment : null;
  if (!segment || !isFiniteNumber(segment.start) || !isFiniteNumber(segment.end) || segment.end <= segment.start) {
    return null;
  }
  const nowPlaying = call(handle?.getNowPlaying?.bind(handle));
  const snapshot = call(handle?.getQueueSnapshot?.bind(handle));
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const index = Number.isInteger(nowPlaying?.queuePosition) ? nowPlaying.queuePosition : null;
  const total = items.length ? items.length : (Number.isInteger(nowPlaying?.queueLength) ? nowPlaying.queueLength : null);

  // Next is what the Player will actually play after this: the second entry of
  // its execution order (shuffle and Up Next already applied), and only by
  // position when the snapshot carries no order.
  let next = null;
  const order = Array.isArray(snapshot?.executionOrder) ? snapshot.executionOrder : null;
  if (order) {
    const nextId = order[1];
    next = nextId != null ? items.find((entry) => entry?.queueItemId === nextId) ?? null : null;
  } else if (index != null) {
    next = items[index + 1] ?? null;
  }

  return {
    segment: { start: segment.start, end: segment.end },
    index,
    total,
    next: describeEntry(next),
  };
}

/** A string that changes only when something a clip module shows changes. */
export function clipKey(clip) {
  if (!clip) return '';
  return JSON.stringify([clip.segment.start, clip.segment.end, clip.index, clip.total, clip.next]);
}
