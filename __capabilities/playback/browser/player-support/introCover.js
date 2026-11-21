/**
 * Whether an installed intro scene is covering the player's loading screen.
 * The intro gate (useIntroGate) sets it; PlayerOverlayLoading reads it to hide
 * the plain spinner (never the exhausted/held recovery UI). A module singleton
 * because the producer (VideoPlayer) and consumer (the overlay, mounted by Player
 * and SinglePlayer) share no props path.
 */
let covering = false;
const listeners = new Set();

export function setIntroCovering(next) {
  const v = !!next;
  if (v === covering) return;
  covering = v;
  listeners.forEach((cb) => { try { cb(); } catch (_) { /* ignore */ } });
}

export function isIntroCovering() {
  return covering;
}

/** Subscribe to changes (for useSyncExternalStore). Returns an unsubscribe fn. */
export function subscribeIntroCover(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
