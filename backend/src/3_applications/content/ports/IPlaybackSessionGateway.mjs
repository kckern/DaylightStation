// backend/src/3_applications/content/ports/IPlaybackSessionGateway.mjs

/**
 * Port: report a surface's playback to an external media server as a real client.
 *
 * This is deliberately ONE-WAY. The remote never tells us what our own state is,
 * so nothing it says can overwrite a school or piano completion. That is the
 * whole reason this port exists alongside `IRemoteProgressProvider` rather than
 * extending it: that one reconciles and can let the remote win.
 *
 * Implementations are anti-corruption layers. Everything here speaks in domain
 * terms — an identity and a session — and the adapter alone knows the wire
 * format (for Plex: `/:/timeline` state transitions and `/:/scrobble`).
 *
 * @interface IPlaybackSessionGateway
 */
export class IPlaybackSessionGateway {
  /**
   * Announce that a surface has started playing. After this the session should
   * be visible to anything watching the media server's live session list.
   *
   * @param {import('#domains/media/value-objects/PlexClientIdentity.mjs').PlexClientIdentity} identity
   * @param {import('#domains/media/entities/PlaybackSession.mjs').PlaybackSession} session
   * @returns {Promise<void>}
   */
  async openSession(_identity, _session) {
    throw new Error('IPlaybackSessionGateway.openSession must be implemented');
  }

  /**
   * Keep the session alive and move the playhead. Called both when the surface
   * reports progress and on a timer, because client pings are not dependable
   * enough on their own to satisfy a remote's heartbeat expectations.
   *
   * @returns {Promise<void>}
   */
  async heartbeat(_identity, _session) {
    throw new Error('IPlaybackSessionGateway.heartbeat must be implemented');
  }

  /**
   * End the session. Must be safe to call more than once: a natural end, a
   * user stop and the stale reaper can all race for the same session.
   *
   * @returns {Promise<void>}
   */
  async closeSession(_identity, _session) {
    throw new Error('IPlaybackSessionGateway.closeSession must be implemented');
  }

  /**
   * Record that the content was watched to completion.
   *
   * Separate from `closeSession` because stopping and finishing are different
   * facts: abandoning something halfway closes a session but must not mark it
   * watched.
   *
   * @param {import('#domains/media/value-objects/PlexClientIdentity.mjs').PlexClientIdentity} identity
   * @param {string} contentId
   * @returns {Promise<void>}
   */
  async markWatched(_identity, _contentId) {
    throw new Error('IPlaybackSessionGateway.markWatched must be implemented');
  }
}

/**
 * Validates that an object implements the IPlaybackSessionGateway interface.
 * @param {any} gateway
 * @throws {Error} If validation fails
 */
export function validatePlaybackSessionGateway(gateway) {
  for (const method of ['openSession', 'heartbeat', 'closeSession', 'markWatched']) {
    if (typeof gateway?.[method] !== 'function') {
      throw new Error(`PlaybackSessionGateway must implement ${method}()`);
    }
  }
}

export default IPlaybackSessionGateway;
