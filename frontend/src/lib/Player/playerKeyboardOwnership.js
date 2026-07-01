/**
 * Player keyboard ownership.
 *
 * When a fullscreen video player is active, its key bindings (Space =
 * play/pause, arrows = seek, Esc = close, …) must WIN over any other global
 * keydown handlers mounted beneath it — most importantly the base Menu, whose
 * own `window` keydown handler treats Space/Enter as "select the focused item".
 * Without this, a single Space press both paused the video AND launched a
 * hidden menu item beneath it (e.g. a music playlist).
 *
 * The player `acquire`s ownership while mounted and `release`s on unmount.
 * Other handlers call `isPlayerKeyboardActive()` and stand down while it's true.
 *
 * Ref-counted so overlapping players (e.g. a crossfade between two videos)
 * don't prematurely re-arm the menu; ownership drops only when the last holder
 * releases.
 */

let count = 0;
const listeners = new Set();

function notify() {
  const active = isPlayerKeyboardActive();
  for (const listener of listeners) {
    try { listener(active); } catch { /* a bad subscriber must not break others */ }
  }
}

/**
 * Claim keyboard ownership for a fullscreen video player.
 * @returns {() => void} release — idempotent; safe to call multiple times.
 */
export function acquirePlayerKeyboard() {
  count += 1;
  if (count === 1) notify();
  let released = false;
  return function release() {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    if (count === 0) notify();
  };
}

/** @returns {boolean} true while any fullscreen video player owns the keyboard. */
export function isPlayerKeyboardActive() {
  return count > 0;
}

/**
 * Subscribe to ownership changes. Fires only on 0<->1 transitions.
 * @param {(active: boolean) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribePlayerKeyboard(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only reset. */
export function __resetPlayerKeyboardOwnership() {
  count = 0;
  listeners.clear();
}
