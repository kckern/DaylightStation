// Live edge of a media element: the end of its last seekable range (a live
// HLS/DASH stream's newest playable moment), or a finite duration for a
// progressive source. Shared by the local Media controller ("Go to live") and
// the screen receiver that executes a remote `goLive` command.

/** @returns {number|null} seconds, or null when the element offers no edge. */
export function liveEdgeSeconds(el) {
  if (!el) return null;
  const ranges = el.seekable;
  if (ranges && ranges.length > 0) {
    const end = ranges.end(ranges.length - 1);
    if (Number.isFinite(end) && end >= 0) return end;
  }
  if (Number.isFinite(el.duration) && el.duration > 0) return el.duration;
  return null;
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
