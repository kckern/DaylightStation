/**
 * resolvePostEpisodeRedirect — pure helper deciding where the app should land
 * after a video OR voice memo completes (covers both X-out close and natural
 * episode end).
 *
 * 2026-05-16: changed the landing from /fitness/users (full-screen chart) to
 * /fitness/home with the just-ended session pre-selected in the fitness:sessions
 * widget. The home screen surfaces session history, suggestions, and the coach —
 * a better landing than the bare chart, and the pre-selection lets the user
 * immediately review the session they just finished.
 *
 * 2026-06-14: short "browse" exits (the video never ran long enough to trigger
 * the voice-memo prompt and no memo was recorded) now prefer returning to the
 * show the user was browsing — `returnToShow`/`showId` signal that. FitnessApp
 * keeps the still-mounted FitnessShow as-is (preserving season selection, scroll
 * position, etc.) instead of bouncing to home. A long workout still lands on home.
 *
 * @param {{ hasActiveSession?: any, sessionId?: string|null,
 *   returnToShow?: boolean, showId?: string|number|null }} [input]
 * @returns {{ view: 'screen', screenId: 'home', sessionId: string|null,
 *   clearActiveModule: true, clearActiveCollection: true, clearSelectedShow: true,
 *   returnToShow?: true, showId?: string
 * } | null}
 */
export function resolvePostEpisodeRedirect(input) {
  if (!input || typeof input !== 'object') return null;
  const base = {
    view: 'screen',
    screenId: 'home',
    // Only pre-select session when one is active; null otherwise (still navigates to home)
    sessionId: input.hasActiveSession ? (input.sessionId ?? null) : null,
    clearActiveModule: true,
    clearActiveCollection: true,
    clearSelectedShow: true,
  };
  // Short browse-out: prefer returning to the show. FitnessApp falls back to the
  // home fields above when no show is actually mounted to return to.
  if (input.returnToShow && input.showId != null) {
    return { ...base, returnToShow: true, showId: String(input.showId) };
  }
  return base;
}

export default resolvePostEpisodeRedirect;
