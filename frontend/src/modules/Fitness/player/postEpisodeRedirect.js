/**
 * resolvePostEpisodeRedirect — pure helper deciding where the app should land
 * after a video OR voice memo completes (bug bash F3).
 *
 * @param {{ hasActiveSession?: any }} [input]
 * @returns {null | { view: 'users', clearActiveModule: true,
 *                    clearActiveCollection: true, clearSelectedShow: true }}
 */
export function resolvePostEpisodeRedirect(input) {
  if (!input || typeof input !== 'object') return null;
  if (!input.hasActiveSession) return null;
  return {
    view: 'users',
    clearActiveModule: true,
    clearActiveCollection: true,
    clearSelectedShow: true,
  };
}

export default resolvePostEpisodeRedirect;
