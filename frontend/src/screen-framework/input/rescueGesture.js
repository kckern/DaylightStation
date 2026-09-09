/**
 * The screen's last-resort "get me out of here" gesture, as a pure decision.
 *
 * A screen can become unreachable in two different ways, and they need
 * different answers:
 *
 *   1. The input system is DEAD — the adapter never attached, or its keymap
 *      fetch failed and it silently drops every keystroke. Nothing downstream
 *      will ever see the key, so ONE press has to be enough.
 *
 *   2. The input system is HEALTHY and the key is being delivered, but nobody
 *      acts on it. A fullscreen piano game registers an escape interceptor that
 *      reports "handled" and deliberately does nothing, so a stray press cannot
 *      quit a game mid-move; that same interceptor also makes the framework's
 *      hardware-back consumer stand down. On a screen whose only input is the
 *      keypad, that closes every exit at once — which is how the office TV ended
 *      up stuck on a running game with no way to even reload the page.
 *
 * For (2) the answer is deliberate REPETITION. It cannot be reached by accident,
 * it needs no instruction (jabbing at a dead screen is what people already do),
 * and being a property of the gesture rather than of the app underneath it, no
 * interceptor gets a vote on it.
 *
 * Auto-repeat is excluded on purpose: a leaned-on key is one gesture, not five.
 */

/** Presses required to force a reload while input is healthy. */
export const RESCUE_PRESSES = 5;
/** The window those presses must land inside, in ms. */
export const RESCUE_WINDOW_MS = 2000;

/**
 * @param {{presses: number[], now: number, inputHealthy: boolean, repeat?: boolean}} input
 *   `presses` are the timestamps of earlier qualifying presses, oldest first.
 * @returns {{reload: boolean, presses: number[]}} the verdict and the press
 *   history to carry forward. The history is always returned, never mutated in
 *   place, so the caller has no way to keep a stale window by accident.
 */
export function rescueGesture({ presses = [], now, inputHealthy, repeat = false }) {
  // Dead input: the press cannot reach anything else, so it is the whole gesture.
  if (!inputHealthy) return { reload: true, presses: [] };
  if (repeat) return { reload: false, presses };

  const recent = [...presses, now].filter((t) => now - t < RESCUE_WINDOW_MS);
  if (recent.length < RESCUE_PRESSES) return { reload: false, presses: recent };
  return { reload: true, presses: [] };
}
