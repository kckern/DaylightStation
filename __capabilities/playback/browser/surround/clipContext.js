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

/**
 * The whole a clip was cut from: its id less the `#n` the queue adds per clip
 * (`plex:619381#21` -> `plex:619381`). Two clips with the same work are two
 * pieces of one concert; the band says so, and says so differently when the
 * next clip comes from another.
 */
export function clipWork(entry) {
  const id = entry?.contentId ?? entry?.id ?? null;
  if (id == null || id === '') return null;
  return String(id).split('#')[0] || null;
}

const describeEntry = (entry) => {
  if (!entry) return null;
  const piece = entry.surround && typeof entry.surround === 'object' ? entry.surround.piece ?? null : null;
  return {
    title: entry.title ?? null,
    subtitle: entry.subtitle ?? null,
    work: clipWork(entry),
    // The concert the next clip is from, when its own surround names it.
    workTitle: piece?.title ?? null,
    workYear: piece?.year ?? null,
  };
};

/**
 * @param {object|null} item - The now-playing item (`getNowPlaying().item`)
 * @param {object|null} handle - The Player's imperative handle
 * @returns {{ segment: {start: number, end: number}, title: string|null,
 *   work: string|null, index: number|null, total: number|null,
 *   next: {title: string|null, subtitle: string|null, work: string|null,
 *     workTitle: string|null, workYear: number|null}|null }|null}
 *   null when the item is not a clip.
 */
const isClip = (entry) => {
  const segment = entry && typeof entry === 'object' ? entry.segment : null;
  return !!segment && isFiniteNumber(segment.start) && isFiniteNumber(segment.end) && segment.end > segment.start;
};

export function clipContext(item, handle) {
  if (!isClip(item)) return null;
  const { segment } = item;
  const nowPlaying = call(handle?.getNowPlaying?.bind(handle));
  const snapshot = call(handle?.getQueueSnapshot?.bind(handle));
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const index = Number.isInteger(nowPlaying?.queuePosition) ? nowPlaying.queuePosition : null;
  const total = items.length ? items.length : (Number.isInteger(nowPlaying?.queueLength) ? nowPlaying.queueLength : null);

  // Next is what the Player will actually play after this: the second entry of
  // its execution order (shuffle and Up Next already applied), and only by
  // position when the snapshot carries no order.
  const order = Array.isArray(snapshot?.executionOrder) ? snapshot.executionOrder : null;
  let upcoming = [];
  if (order) {
    upcoming = order.slice(1).map((id) => items.find((entry) => entry?.queueItemId === id) ?? null);
  } else if (index != null) {
    upcoming = items.slice(index + 1);
  }
  // A break between clips (a commercial, a family photo; see the sequence
  // `breaks:` rule) is not what the band means by next: name the next CLIP.
  // With no clip ahead at all, the plain next entry stands.
  const next = upcoming.find((entry) => isClip(entry)) ?? upcoming[0] ?? null;

  return {
    segment: { start: segment.start, end: segment.end },
    // The clip's OWN name (the piece sounding), which no surround payload
    // holds: the payload is the concert's.
    title: item.title ?? null,
    work: clipWork(item),
    index,
    total,
    next: describeEntry(next),
  };
}

/** A string that changes only when something a clip module shows changes. */
export function clipKey(clip) {
  if (!clip) return '';
  return JSON.stringify([clip.segment.start, clip.segment.end, clip.title, clip.work, clip.index, clip.total, clip.next]);
}
