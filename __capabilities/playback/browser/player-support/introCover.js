/**
 * Whether an installed intro scene is covering the player's loading screen.
 * The intro gate (useIntroGate) sets it; PlayerOverlayLoading reads it to hide
 * the plain spinner (never a state with something to say: exhausted/held
 * recovery, the source-healing notice and Skip, the link notice), and
 * PlayerOverlayPaused reads it to keep the pause scrim off the intro's hold.
 * A module singleton because the producer (VideoPlayer) and consumers (the
 * overlays, mounted by Player and SinglePlayer) share no props path. Being
 * page-global, two VideoPlayers on one page share it.
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
