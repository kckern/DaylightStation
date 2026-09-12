import { PlaySession, PlaySessionEndReason } from '#domains/gaming/entities/PlaySession.mjs';
import { PlayState } from '#domains/gaming/value-objects/PlayState.mjs';

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
export class RecordPlayObservation {
  #sessions; #announcer; #newSessionId; #trustedGapMs; #logger;

  constructor({ sessions, announcer = null, newSessionId, trustedGapMs, logger = console }) {
    if (!sessions) throw new Error('RecordPlayObservation requires a sessions repository');
    if (typeof newSessionId !== 'function') throw new Error('RecordPlayObservation requires newSessionId()');
    if (!Number.isFinite(trustedGapMs) || trustedGapMs <= 0) {
      throw new Error('RecordPlayObservation requires a positive trustedGapMs');
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
    const { state, observedAt, confidenceMs = 0, content = null } = observation || {};
    let session = await this.#sessions.findOpenForDevice(deviceId);
    const result = { session: null, started: false, ended: null, accruedMs: 0, switched: false };

    // An unknown observation can neither open, close, nor bill a session. It is
    // recorded against an open session so staleness is visible, and otherwise
    // does nothing at all.
    if (state === PlayState.UNKNOWN) {
      if (!session) return result;
      session.observe({ state, observedAt, confidenceMs });
      await this.#sessions.save(session);
      await this.#announce('progress', session, observation);
      result.session = session;
      return result;
    }

    const nowPlayingId = content?.contentId ?? null;
    const openContentId = session?.content?.contentId ?? null;

    // Nothing is loaded any more, or a different game is: the old session is
    // over. Content identity changing is a real end plus a real start, so time
    // is never silently carried from one title to the next.
    if (session && nowPlayingId !== openContentId) {
      session.end({ endedAt: observedAt, reason: PlaySessionEndReason.QUIT });
      await this.#sessions.save(session);
      await this.#announce('ended', session);
      result.ended = session;
      result.switched = nowPlayingId !== null;
      session = null;
    }

    if (!session) {
      // Only a confirmed PLAYING observation may open a session (FR-1): a game
      // that is merely loaded, or paused at a menu, has not started.
      if (state !== PlayState.PLAYING || !nowPlayingId) return result;
      session = PlaySession.open({
        id: this.#newSessionId(), deviceId, surface, userId, content, grantRef,
        trustedGapMs: this.#trustedGapMs,
      });
    }

    const folded = session.observe({ state, observedAt, confidenceMs });
    await this.#sessions.save(session);

    result.session = session;
    result.started = folded.started;
    result.accruedMs = folded.accruedMs;

    if (folded.started) {
      this.#logger.info?.('play.session.started', {
        sessionId: session.id, deviceId, surface, userId,
        contentId: nowPlayingId, grantRef, startedAt: session.startedAt,
      });
      await this.#announce('started', session);
    } else if (!folded.stale) {
      await this.#announce('progress', session, observation);
    }

    if (folded.truncatedMs > 0) {
      // The observer went quiet mid-session. The unbillable remainder is a blind
      // spot for reconciliation, and is loud on purpose — silent gaps are how a
      // meter drifts without anyone noticing.
      this.#logger.warn?.('play.session.gap_truncated', {
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
      this.#logger.warn?.('play.session.announce_failed', {
        kind, sessionId: session?.id, error: error.message,
      });
    }
  }
}

export default RecordPlayObservation;
