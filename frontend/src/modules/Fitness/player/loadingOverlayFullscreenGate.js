/**
 * Whether a tap inside the buffering/stall loading overlay is allowed to toggle
 * fullscreen.
 *
 * `waitingToPlay` / `stalled` come from the Player's resilience state and are generic
 * — they fire for study-mode content exactly as much as for workouts. But study mode
 * must never let a tap collapse the footer (that is the exact failure it exists to
 * prevent), so this must resolve `false` whenever `studyUx` is true, no matter what
 * the resilience state says.
 *
 * Consumed by FitnessPlayer.jsx to gate BOTH whether the global loading-overlay
 * pointerdown listener is installed at all, and (belt-and-suspenders) inside the
 * listener body itself.
 */
export function computeAllowLoadingOverlayFullscreen({ studyUx, waitingToPlay, stalled } = {}) {
  return !studyUx && Boolean(waitingToPlay || stalled);
}

export default computeAllowLoadingOverlayFullscreen;
