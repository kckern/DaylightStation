import { ArcadeGameSession, ArcadeGameSessionEndReason } from '#domains/gaming/entities/ArcadeGameSession.mjs';
import { ArcadeGameSessionState } from '#domains/gaming/value-objects/ArcadeGameSessionState.mjs';

/**
 * Fold one observation of a device into its play session.
 *
 * This is the single convergence point for every play surface in the house. A
 * surface that reports its own lifecycle calls it through the API; a surface we
 * can only watch from outside is polled by a scheduler that calls it with the
 * same shape. Neither this use case nor the domain beneath it knows which kind
 * of surface produced the observation — only how precisely it was measured.
 *
 * Debouncing belongs to the SOURCE, not here. A momentary flicker in how a
 * device is watched is an artifact of the watching, so the adapter settles it
 * before reporting. By the time an observation arrives it is taken at face
 * value, which keeps this use case free of "is it really gone?" heuristics.
 */
export class RecordArcadeGameObservation {
  #sessions; #announcer; #newSessionId; #trustedGapMs; #logger;

  constructor({ sessions, announcer = null, newSessionId, trustedGapMs, logger = console }) {
    if (!sessions) throw new Error('RecordArcadeGameObservation requires a sessions repository');
    if (typeof newSessionId !== 'function') throw new Error('RecordArcadeGameObservation requires newSessionId()');
    if (!Number.isFinite(trustedGapMs) || trustedGapMs <= 0) {
      throw new Error('RecordArcadeGameObservation requires a positive trustedGapMs');
    }
    this.#sessions = sessions;
    this.#announcer = announcer;
    this.#newSessionId = newSessionId;
    this.#trustedGapMs = trustedGapMs;
    this.#logger = logger;
  }

  /**
   * @param {Object} input
   * @param {string} input.deviceId
   * @param {string} input.surface        Kind of play surface, never a vendor name.
   * @param {string|null} [input.userId]  Who the time belongs to.
   * @param {string|null} [input.grantRef] The authorisation this play is charged against.
   * @param {Object} input.observation    { state, observedAt, confidenceMs, content }
   */
  async execute({ deviceId, surface, userId = null, grantRef = null, observation }) {
    const {
      state, observedAt, confidenceMs = 0, content = null,
      loadId = null, loadedAt = null, controllers = null,
    } = observation || {};
    // Compatibility for the original observation shape. New producers must say
    // whether a game is loaded; an identified game was necessarily loaded.
    const loaded = observation && Object.prototype.hasOwnProperty.call(observation, 'loaded')
      ? observation.loaded
      : (content?.contentId ? true : null);
    let session = await this.#sessions.findOpenForDevice(deviceId);
    const result = { session: null, started: false, ended: null, accruedMs: 0, switched: false };

    const nowPlayingId = content?.contentId ?? null;
    const openContentId = session?.content?.contentId ?? null;
    const loadChanged = Boolean(session && (
      (loadId && session.loadId && loadId !== session.loadId)
      || (!loadId && !session.loadId && nowPlayingId && openContentId && nowPlayingId !== openContentId)
    ));

    // Nothing is loaded any more, or a different game is: the old session is
    // over. Content identity changing is a real end plus a real start, so time
    // is never silently carried from one title to the next.
    if (session && (loaded === false || loadChanged)) {
      session.end({
        endedAt: observedAt,
        reason: loadChanged ? ArcadeGameSessionEndReason.SWITCHED : ArcadeGameSessionEndReason.QUIT,
      });
      await this.#sessions.save(session);
      this.#logger.info?.('arcade.session.ended', {
        sessionId: session.id, deviceId, surface, userId: session.userId,
        grantRef: session.grantRef, contentId: openContentId,
        playedMs: session.playedMs, confidenceMs: session.confidenceMs,
        reason: session.endReason, switched: loadChanged,
      });
      await this.#announce('ended', session);
      result.ended = session;
      result.switched = loadChanged;
      session = null;
    }

    // An unknown play state can neither open nor bill a session. It remains
    // inert while load state is also unknown, but a definitive unload or load
    // switch above still closes the old session.
    if (state === ArcadeGameSessionState.UNKNOWN) {
      if (!session) return result;
      session.observe({ state, observedAt, confidenceMs, controllers });
      await this.#sessions.save(session);
      await this.#announce('progress', session, observation);
      result.session = session;
      return result;
    }

    if (!session) {
      // Only a confirmed PLAYING observation may open a session (FR-1): a game
      // that is merely loaded, or paused at a menu, has not started.
      if (state !== ArcadeGameSessionState.PLAYING || loaded !== true) return result;
      session = ArcadeGameSession.open({
        id: this.#newSessionId(), deviceId, surface, userId, content, loadId, loadedAt, grantRef,
        trustedGapMs: this.#trustedGapMs,
      });
    } else {
      const contentAttribution = session.attributeContent(content);
      const userAttribution = session.attributeUser(userId);
      const loadAttribution = session.attributeLoad({ loadId, loadedAt });
      if (contentAttribution.attributed || userAttribution.attributed || loadAttribution.attributed) {
        this.#logger.info?.('arcade.session.attributed', {
          sessionId: session.id, deviceId, userId: session.userId,
          contentId: session.content?.contentId ?? null, loadId: session.loadId,
        });
      }
    }

    const folded = session.observe({ state, observedAt, confidenceMs, controllers });
    await this.#sessions.save(session);

    result.session = session;
    result.started = folded.started;
    result.accruedMs = folded.accruedMs;

    if (folded.started) {
      this.#logger.info?.('arcade.session.started', {
        sessionId: session.id, deviceId, surface, userId,
        contentId: nowPlayingId, grantRef, startedAt: session.startedAt,
        confidenceMs: session.confidenceMs,
      });
      await this.#announce('started', session);
    } else if (!folded.stale) {
      await this.#announce('progress', session, observation);
    }

    if (folded.truncatedMs > 0) {
      // The observer went quiet mid-session. The unbillable remainder is a blind
      // spot for reconciliation, and is loud on purpose — silent gaps are how a
      // meter drifts without anyone noticing.
      this.#logger.warn?.('arcade.session.gap_truncated', {
        sessionId: session.id, deviceId,
        accruedMs: folded.accruedMs, truncatedMs: folded.truncatedMs,
      });
    }

    return result;
  }

  async #announce(kind, session, observation) {
    if (!this.#announcer) return;
    try {
      await this.#announcer[kind](session, observation);
    } catch (error) {
      // Losing a broadcast is a visibility problem; losing the session would be
      // a money problem. Never let the former become the latter.
      this.#logger.warn?.('arcade.session.announce_failed', {
        kind, sessionId: session?.id, error: error.message,
      });
    }
  }
}

export default RecordArcadeGameObservation;
