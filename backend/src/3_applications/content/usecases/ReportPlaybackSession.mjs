/**
 * ReportPlaybackSession — present a surface's playback to the media server as a
 * real client.
 *
 * Orchestration only. The session's rules live in the domain entity, the wire
 * format lives in the adapter, and this decides which of them to call.
 *
 * ONE-WAY, always. Nothing the remote says is read back, so it can never
 * overwrite a school or piano completion. That is why this does not go through
 * `ProgressSyncService`, whose whole job is reconciling and letting a remote win.
 *
 * Whether a surface has an identity is `identityFor`'s decision, not this
 * class's. Composition currently resolves one for every caller — a declared
 * surface gets its own, anything else shares a web identity — because a
 * playback that reached the media server is a real play wherever it was
 * started. A null is still honoured (reported: false) so that policy can
 * change without touching this.
 *
 * Three ways a session ends, and they are NOT interchangeable:
 *   completed  the item played to its natural end -> closed AND marked watched
 *   stop()     someone stopped it -> closed, NOT marked watched
 *   sweep()    the surface went quiet without saying so -> closed, NOT watched
 */

export class ReportPlaybackSession {
  #registry;
  #gateway;
  #identityFor;
  #logger;

  /**
   * @param {object} deps
   * @param {import('../runtime/PlaybackSessionRegistry.mjs').PlaybackSessionRegistry} deps.sessionRegistry
   * @param {import('../ports/IPlaybackSessionGateway.mjs').IPlaybackSessionGateway} deps.sessionGateway
   * @param {(surfaceId: string) => (import('#domains/media/value-objects/PlexClientIdentity.mjs').PlexClientIdentity|null)} deps.identityFor
   *   Resolves a surface's declared client identity. Supplied by composition
   *   from the device registry; returns null for surfaces that are not clients.
   * @param {object} [deps.logger]
   */
  constructor({ sessionRegistry, sessionGateway, identityFor, logger = console }) {
    if (!sessionRegistry) throw new Error('ReportPlaybackSession requires sessionRegistry');
    if (!sessionGateway) throw new Error('ReportPlaybackSession requires sessionGateway');
    if (typeof identityFor !== 'function') throw new Error('ReportPlaybackSession requires identityFor');
    this.#registry = sessionRegistry;
    this.#gateway = sessionGateway;
    this.#identityFor = identityFor;
    this.#logger = logger;
  }

  /**
   * A progress report from a surface.
   *
   * @param {object} report
   * @param {string} report.surfaceId - which screen, from the device registry
   * @param {string} report.contentId - e.g. `plex:674737`
   * @param {number} [report.positionMs]
   * @param {number} [report.durationMs]
   * @param {boolean} [report.completed] - the item finished naturally
   * @param {number} report.at - epoch ms
   * @returns {Promise<{reported: boolean, opened?: boolean, completed?: boolean}>}
   */
  async execute({ surfaceId, contentId, positionMs = 0, durationMs = 0, completed = false, at }) {
    if (!surfaceId || !contentId) return { reported: false };

    const identity = this.#identityFor(surfaceId);
    if (!identity) return { reported: false };

    const { session, opened, superseded } = this.#registry.record({
      surfaceId, contentId, positionMs, durationMs, at,
    });

    // Close the thing this replaced BEFORE announcing the new one, so the
    // dashboard never shows one screen playing two items.
    if (superseded) await this.#gateway.closeSession(identity, superseded);

    if (opened) await this.#gateway.openSession(identity, session);
    else await this.#gateway.heartbeat(identity, session);

    if (completed) {
      const closed = this.#registry.close({ surfaceId, at });
      if (closed) await this.#gateway.closeSession(identity, closed);
      // Stopping and finishing are different facts; only a natural end is watched.
      await this.#gateway.markWatched(identity, contentId);
      this.#logger.info?.('plex.session.completed', { surfaceId, contentId, player: identity.displayName });
      return { reported: true, opened, completed: true };
    }

    if (opened) {
      this.#logger.info?.('plex.session.opened', { surfaceId, contentId, player: identity.displayName });
    }
    return { reported: true, opened, completed: false };
  }

  /**
   * A surface stopped playing, without finishing.
   *
   * Deliberately NOT `execute({completed: true})`: that marks the item watched,
   * and stopping a story halfway is not finishing it. A child who abandons a
   * book must not have it written into history as read.
   *
   * Idempotent — stopping an already-stopped surface is a no-op, so a caller
   * that reports `idle` on every poll can call this freely.
   *
   * @param {{surfaceId: string, at: number}} input
   * @returns {Promise<{stopped: boolean}>}
   */
  async stop({ surfaceId, at }) {
    if (!surfaceId) return { stopped: false };

    const identity = this.#identityFor(surfaceId);
    if (!identity) return { stopped: false };

    const closed = this.#registry.close({ surfaceId, at });
    if (!closed) return { stopped: false };

    await this.#gateway.closeSession(identity, closed);
    this.#logger.info?.('plex.session.stopped', {
      surfaceId, contentId: closed.contentId, player: identity.displayName,
    });
    return { stopped: true };
  }

  /**
   * End sessions whose surface stopped reporting.
   *
   * @param {{now: number, ttlMs?: number}} input
   * @returns {Promise<number>} how many were reaped
   */
  async sweep({ now, ttlMs = 60_000 }) {
    const reaped = this.#registry.reapStale({ now, ttlMs });
    for (const session of reaped) {
      const identity = this.#identityFor(session.surfaceId);
      if (!identity) continue;
      await this.#gateway.closeSession(identity, session);
      this.#logger.info?.('plex.session.reaped', {
        surfaceId: session.surfaceId,
        contentId: session.contentId,
        quietForMs: now - session.lastHeartbeatAt,
      });
    }
    return reaped.length;
  }

  /**
   * Keep live sessions alive. Measured `play/log` cadence is a median of 3.7s
   * but reaches 21.5s, beyond what a remote will tolerate — so heartbeats
   * cannot depend on client pings alone.
   *
   * @returns {Promise<number>} how many were refreshed
   */
  async keepAlive() {
    const live = this.#registry.live();
    for (const session of live) {
      const identity = this.#identityFor(session.surfaceId);
      if (!identity) continue;
      await this.#gateway.heartbeat(identity, session);
    }
    return live.length;
  }
}

export default ReportPlaybackSession;
