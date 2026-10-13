/**
 * Tiny reactive singleton flagging that a content-filter skip-card is currently
 * PAUSED (deliberately, to buffer behind the card). useContentFilter sets it;
 * PlayerOverlayLoading reads it (via useSyncExternalStore) to suppress the
 * buffering spinner during that intentional pause — otherwise the seek/pause reads
 * as a stall and the spinner covers the card.
 *
 * A module singleton (not React state/context) because the producer (a hook inside
 * VideoPlayer) and the consumer (PlayerOverlayLoading, a sibling under Player.jsx)
 * live in different subtrees with no shared props path.
 */
let paused = false;
const listeners = new Set();

export function setSkipCardPaused(next) {
  const v = !!next;
  if (v === paused) return;
  paused = v;
  listeners.forEach((cb) => { try { cb(); } catch (_) { /* ignore */ } });
}

export function isSkipCardPaused() {
  return paused;
}

/** Subscribe to changes (for useSyncExternalStore). Returns an unsubscribe fn. */
export function subscribeSkipCard(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
