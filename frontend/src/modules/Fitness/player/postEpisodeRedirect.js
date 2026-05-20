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
 * @param {{ hasActiveSession?: any, sessionId?: string|null }} [input]
 * @returns {null | {
 *   view: 'screen', screenId: 'home', sessionId: string|null,
 *   clearActiveModule: true, clearActiveCollection: true, clearSelectedShow: true
 * }}
 */
export function resolvePostEpisodeRedirect(input) {
  if (!input || typeof input !== 'object') return null;
  if (!input.hasActiveSession) return null;
  return {
    view: 'screen',
    screenId: 'home',
    sessionId: input.sessionId ?? null,
    clearActiveModule: true,
    clearActiveCollection: true,
    clearSelectedShow: true,
  };
}

export default resolvePostEpisodeRedirect;
