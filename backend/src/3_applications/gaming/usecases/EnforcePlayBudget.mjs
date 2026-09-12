import { IPlaySessionAnnouncer } from '#apps/gaming/ports/IPlaySessionAnnouncer.mjs';
import { assessBudget, describeRemaining } from '#domains/gaming/services/playBudget.mjs';
import { PlaySessionEndReason } from '#domains/gaming/entities/PlaySession.mjs';

/**
 * Warns, then stops, when purchased time runs out.
 *
 * Shaped as an announcer so it rides the same fan-out as everything else that
 * reacts to a session: it sees every progress tick without the tracker needing
 * to know enforcement exists.
 *
 * It is the ONLY caller of the terminator, and it is deliberately hard to reach
 * that path:
 *
 *  - No grant provider wired ⇒ nothing is enforced at all. Observation still
 *    runs; the meter measures and says nothing.
 *  - No grant for a session ⇒ nothing is enforced. A missing grant is not an
 *    unlimited one, and it is certainly not a reason to kill a game.
 *  - An unlimited grant ⇒ nothing to count down, nothing to expire.
 *
 * Because stopping an emulator cannot make it save first, expiry destroys
 * unsaved progress. The warning ladder is therefore a precondition, not a
 * courtesy, and every rung is announced on screen and out loud together.
 */
export class EnforcePlayBudget extends IPlaySessionAnnouncer {
  #grants; #terminator; #speaker; #notify; #sessions; #logger;
  #warned = new Map();

  constructor({ grants, terminator, speaker = null, notify = null, sessions = null, logger = console }) {
    super();
    if (!grants?.forSession) throw new Error('EnforcePlayBudget requires a grants port');
    if (!terminator?.endPlay) throw new Error('EnforcePlayBudget requires a terminator port');
    this.#grants = grants;
    this.#terminator = terminator;
    this.#speaker = speaker;
    this.#notify = notify;
    this.#sessions = sessions;
    this.#logger = logger;
  }

  async started(session) { this.#warned.delete(session.id); }

  async ended(session) { this.#warned.delete(session.id); }

  async progress(session) {
    if (!session || session.isEnded?.()) return;

    let grant = null;
    try {
      grant = await this.#grants.forSession(session);
    } catch (error) {
      // Cannot price the session ⇒ cannot enforce it. Never guess.
      this.#logger.warn?.('play.budget.grant_unavailable', { sessionId: session.id, error: error.message });
      return;
    }
    if (!grant) return;

    const warned = this.#warned.get(session.id) || [];
    const assessment = assessBudget({
      playedMs: session.playedMs, grantedMs: grant.grantedMs, warnedMs: warned,
    });
    if (assessment.unlimited) return;

    if (assessment.dueWarningMs !== null) {
      this.#warned.set(session.id, [...warned, assessment.dueWarningMs]);
      await this.#warn(session, assessment);
      return;
    }
    if (assessment.expired) await this.#expire(session);
  }

  async #warn(session, assessment) {
    const phrase = describeRemaining(assessment.dueWarningMs);
    this.#logger.info?.('play.budget.warning', {
      sessionId: session.id, deviceId: session.deviceId,
      remainingMs: assessment.remainingMs, rungMs: assessment.dueWarningMs,
    });
    await this.#safely('notify', () => this.#notify?.(session, {
      warning: `${phrase.toUpperCase()} LEFT — SAVE YOUR GAME`,
      remainingMs: assessment.remainingMs,
    }));
    await this.#safely('speak', () => this.#speaker?.say(
      session.deviceId, `${phrase} of arcade time left. Please save your game.`,
    ));
  }

  async #expire(session) {
    this.#logger.warn?.('play.budget.expired', {
      sessionId: session.id, deviceId: session.deviceId, playedMs: session.playedMs,
    });
    await this.#safely('speak', () => this.#speaker?.say(session.deviceId, 'Arcade time is over.'));

    const result = await this.#terminator.endPlay(session.deviceId);
    if (!result?.ok) {
      // A failed stop must not be recorded as a completed session — the game is
      // still running, and the next tick will try again.
      this.#logger.error?.('play.budget.terminate_failed', {
        sessionId: session.id, deviceId: session.deviceId, error: result?.error,
      });
      return;
    }

    if (this.#sessions && !session.isEnded()) {
      session.end({ endedAt: new Date().toISOString(), reason: PlaySessionEndReason.EXPIRED });
      await this.#sessions.save(session);
    }
    this.#warned.delete(session.id);
  }

  async #safely(what, fn) {
    try { await fn?.(); } catch (error) {
      this.#logger.warn?.(`play.budget.${what}_failed`, { error: error.message });
    }
  }
}

export default EnforcePlayBudget;
