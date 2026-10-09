/**
 * Shared fake media element for Player hook tests.
 *
 * Tracks listener registrations so a test can dispatch synthetic media events
 * (`_fire`) exactly the way the browser would to the listeners a hook attaches.
 * This is a superset of the three near-identical copies that previously lived
 * inline in useMediaResilience.ledger / usePlaybackHealth / useEndOfContentWatchdog
 * tests — it carries every default field and inspection surface all three need.
 *
 * @param {Object} [initial] - field overrides (currentTime, duration, paused, …)
 * @returns fake element with addEventListener/removeEventListener plus:
 *   _fire(ev)     — invoke every listener registered for `ev`
 *   _count(ev)    — how many listeners are registered for `ev`
 *   _listeners    — the raw { event: fn[] } registry (for assertions on cleanup)
 */
export function makeFakeEl(initial = {}) {
  const listeners = {};
  return {
    currentTime: 0,
    duration: 0,
    paused: false,
    ended: false,
    seeking: false,
    buffered: { length: 0 },
    ...initial,
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener: (ev, fn) => {
      const arr = listeners[ev];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    _fire: (ev) => { (listeners[ev] || []).forEach((fn) => fn()); },
    _count: (ev) => (listeners[ev] || []).length,
    _listeners: listeners
  };
}
