/**
 * One shared "a human just did something" timestamp for the kiosk.
 *
 * Extracted so the game-budget meter can pause AND resume at seconds
 * granularity (design Modified #5). useInactivityReturn keeps its private
 * minutes-granularity onIdle contract untouched — it now also bumps this
 * signal at the same three places it already bumps its own ref, so the two
 * can never disagree about what counts as activity (MIDI, pointerdown,
 * keydown, keepAlive).
 */
const listeners = new Set();
let last = Date.now();

export const activitySignal = {
  bump() {
    last = Date.now();
    for (const cb of listeners) { try { cb(last); } catch { /* listener's problem */ } }
  },
  lastActivityAt: () => last,
  subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
};

export default activitySignal;
