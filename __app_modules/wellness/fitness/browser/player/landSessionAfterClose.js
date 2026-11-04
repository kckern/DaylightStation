import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { publishLivePlayback, SESSION_SAVED_EVENT } from '../lib/liveSessionStore.js';

/**
 * Hand a closed player's session over to the screen it lands on.
 *
 * Closing the player does not end the session, so nothing else writes the voice
 * memo or the end of playback until the next autosave, up to 15 s later. This
 * saves them now and publishes the observations right away, so the landing page
 * shows them before the save returns. The promise settles once that save has
 * landed (it never rejects); the event tells an open detail to re-read it.
 */
export function landSessionAfterClose(session) {
  if (!session) return Promise.resolve();
  const sessionId = session.sessionId ?? null;
  const flushed = session.flushForLanding
    ? session.flushForLanding()
    : session.whenFinalPersistSettled?.();
  publishLivePlayback(sessionId, session.timeline?.events);
  return Promise.resolve(flushed)
    .catch((error) => {
      getLogger().warn('fitness.session.landing_save_failed', { sessionId, error: error?.message });
    })
    .then(() => {
      getLogger().debug('fitness.session.landing_saved', { sessionId });
      if (sessionId && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(SESSION_SAVED_EVENT, { detail: { sessionId } }));
      }
    });
}
