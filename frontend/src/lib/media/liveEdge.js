// Live edge of a media element: the end of its last seekable range (a live
// HLS/DASH stream's newest playable moment), or a finite duration for a
// progressive source. Shared by the local Media controller ("Go to live") and
// the screen receiver that executes a remote `goLive` command.

/**
 * The newest moment the element can show: the furthest of the last seekable
 * range's end, the last buffered range's end and a finite duration. (A live
 * HLS/DASH stream reports its edge through `seekable`; a live progressive
 * stream reports an empty seekable range and a duration that grows with the
 * stream.)
 * @returns {number|null} seconds, or null when the element offers no edge.
 */
export function liveEdgeSeconds(el) {
  if (!el) return null;
  const ends = [];
  for (const ranges of [el.seekable, el.buffered]) {
    if (ranges && ranges.length > 0) ends.push(ranges.end(ranges.length - 1));
  }
  if (Number.isFinite(el.duration) && el.duration > 0) ends.push(el.duration);
  const finite = ends.filter((end) => Number.isFinite(end) && end > 0);
  return finite.length ? Math.max(...finite) : null;
}

/**
 * Move an element to its live edge and make sure it is playing.
 * @returns {{ ok: boolean, edge?: number, code?: string }}
 */
export function seekToLiveEdge(el) {
  const edge = liveEdgeSeconds(el);
  if (edge == null) return { ok: false, code: 'NO_LIVE_EDGE' };
  try {
    el.currentTime = edge;
    const started = el.play?.();
    if (started && typeof started.catch === 'function') started.catch(() => {});
  } catch {
    return { ok: false, code: 'LIVE_EDGE_SEEK_FAILED' };
  }
  return { ok: true, edge };
}
