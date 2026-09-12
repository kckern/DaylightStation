import { PlaySessionEndReason } from '#domains/gaming/entities/PlaySession.mjs';

/**
 * Settle sessions left open by a backend that stopped without closing them.
 *
 * Run at startup. The naive version — close everything open — is wrong: a
 * process that restarts in thirty seconds while a child is still playing should
 * RESUME that session, not orphan it. `playedMs` is persisted for exactly that
 * reason, and the tracker's next observation continues the same session with its
 * accumulated time intact.
 *
 * So staleness, not restart, is what ends a session here. A session whose last
 * observation is older than the tolerance cannot be resumed honestly — we have
 * no idea what happened in the gap — and is closed as `lost` so it settles
 * conservatively and shows up as something to look at, rather than sitting open
 * forever and quietly accruing nothing.
 */
export class ReconcileOpenSessions {
  #sessions; #announcer; #logger;

  constructor({ sessions, announcer = null, logger = console }) {
    if (!sessions) throw new Error('ReconcileOpenSessions requires a sessions repository');
    this.#sessions = sessions;
    this.#announcer = announcer;
    this.#logger = logger;
  }

  /**
   * @param {Object} input
   * @param {string[]} input.deviceIds   Devices to reconcile.
   * @param {string} input.now           ISO instant.
   * @param {number} input.staleAfterMs  Older than this and the session cannot be resumed.
   */
  async execute({ deviceIds = [], now, staleAfterMs }) {
    const at = Date.parse(now);
    const result = { resumed: [], lost: [] };

    for (const deviceId of deviceIds) {
      let session;
      try {
        session = await this.#sessions.findOpenForDevice(deviceId);
      } catch (error) {
        this.#logger.warn?.('play.reconcile.read_failed', { deviceId, error: error.message });
        continue;
      }
      if (!session) continue;

      const last = Date.parse(session.lastObservedAt || session.startedAt || now);
      const age = at - last;

      if (Number.isFinite(age) && age <= staleAfterMs) {
        // Still fresh: the tracker will pick it up and keep accruing.
        result.resumed.push(session.id);
        this.#logger.info?.('play.session.resumed', {
          sessionId: session.id, deviceId, playedMs: session.playedMs, ageMs: age,
        });
        continue;
      }

      session.end({ endedAt: now, reason: PlaySessionEndReason.LOST });
      await this.#sessions.save(session);
      result.lost.push(session.id);
      this.#logger.warn?.('play.session.lost', {
        sessionId: session.id, deviceId, playedMs: session.playedMs, ageMs: age,
        reason: 'no observation within the staleness tolerance at startup',
      });
      await this.#announce(session);
    }

    return result;
  }

  async #announce(session) {
    if (!this.#announcer?.ended) return;
    try {
      await this.#announcer.ended(session);
    } catch (error) {
      this.#logger.warn?.('play.session.announce_failed', { kind: 'ended', sessionId: session.id, error: error.message });
    }
  }
}

export default ReconcileOpenSessions;
