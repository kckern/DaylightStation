/**
 * Whether an installed intro scene is covering the player's loading screen.
 * Two parts of the Player claim it: the intro host in SinglePlayer (the scene
 * started from the play request, before play info arrives) and the intro gate
 * in VideoPlayer (useIntroGate). The cover is on while either holds a claim.
 * PlayerOverlayLoading reads it to hide the plain spinner (never a state with
 * something to say: exhausted/held recovery, the source-healing notice and
 * Skip, the link notice), and PlayerOverlayPaused reads it to keep the pause
 * scrim off the intro's hold. A module singleton because the producers and
 * consumers (the overlays, mounted by Player and SinglePlayer) share no props
 * path. Being page-global, two players on one page share it.
 */
const claims = new Set();
const listeners = new Set();

/** Claim (true) or release (false) the cover for `owner` ('gate' by default). */
export function setIntroCovering(next, owner = 'gate') {
  const before = claims.size > 0;
  if (next) claims.add(owner); else claims.delete(owner);
  if ((claims.size > 0) === before) return;
  listeners.forEach((cb) => { try { cb(); } catch (_) { /* ignore */ } });
}

export function isIntroCovering() {
  return claims.size > 0;
}

/** Subscribe to changes (for useSyncExternalStore). Returns an unsubscribe fn. */
export function subscribeIntroCover(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
