/**
 * Flags that the provenance handoff is deliberately holding the video paused
 * behind its scene, so the player's loading overlay does not read the pause as
 * a stall. Same shape as content-filter/skipCardState.js (a module singleton:
 * producer and consumer live in different subtrees).
 */
let holding = false;
const listeners = new Set();

export function setProvenanceHolding(next) {
  const v = !!next;
  if (v === holding) return;
  holding = v;
  listeners.forEach((cb) => { try { cb(); } catch (_) { /* ignore */ } });
}

export function isProvenanceHolding() {
  return holding;
}

export function subscribeProvenanceHold(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
