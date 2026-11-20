/**
 * ClaimMakeupLesson — pin a session to the missed day a makeup-sheet code
 * was printed for (`makeup_claimed`), so its pass counts for that day and
 * not for the day it is done (`domain/makeup.mjs` `honouredMakeupClaim`).
 *
 * Called by the two paths that act on a ticket, `RunSelfServiceAction`
 * (typed code) and `ResolveScanAction` (scanned QR), after the session is
 * ensured and before the work is handed out. It claims the OLDEST day the
 * ticket names that still lacks a LESSON in the subject (`GetMakeupWork`
 * `lacksLesson`; a claim moves a lesson, so a day owing only a program is
 * never claimed) and that no other open session already claims. When nothing qualifies the lesson
 * stays today's, the old behaviour.
 *
 * Never throws: a claim that cannot be written costs the attribution, never
 * the child's sheet.
 */
import { createEvent, reduceSession } from "../../domain/sessions/sessionEvents.mjs";

export class ClaimMakeupLesson {
  #sessions; #getMakeupWork; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {{execute: Function}} deps.getMakeupWork
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({ sessions, getMakeupWork, clock = () => new Date(), logger = console } = {}) {
    if (!sessions || !getMakeupWork) throw new Error('ClaimMakeupLesson requires sessions and getMakeupWork');
    this.#sessions = sessions;
    this.#getMakeupWork = getMakeupWork;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {{sessionId: string, learnerId: string, subject: string, forDays?: string[]}} args
   * @returns {Promise<{claimed: string|null, reason: string|null}>}
   */
  async execute({ sessionId, learnerId, subject, forDays } = {}) {
    try {
      return await this.#claim({ sessionId, learnerId, subject, forDays });
    } catch (error) {
      this.#logger.warn?.('school.makeup.claim-failed', {
        sessionId, learnerId, subject, error: error?.message ?? String(error),
      });
      return { claimed: null, reason: 'failed' };
    }
  }

  async #claim({ sessionId, learnerId, subject, forDays }) {
    const days = (Array.isArray(forDays) ? forDays : []).filter((day) => typeof day === 'string');
    if (!days.length || !sessionId || !learnerId || !subject) return { claimed: null, reason: 'not_makeup' };
    const state = reduceSession(await this.#sessions.readEvents(sessionId));
    if (state.learnerId !== learnerId) return { claimed: null, reason: 'wrong_learner' };
    if (state.makeupFor) return { claimed: state.makeupFor, reason: 'already_claimed' };
    // Settled credit is never moved by a scan; only a repair does that.
    if (state.terminal) return { claimed: null, reason: 'settled' };

    const { deadline, items } = await this.#getMakeupWork.execute({ learnerId });
    const owed = (items ?? [])
      .filter((item) => item.subject === subject && item.lacksLesson === true && days.includes(item.day))
      .map((item) => item.day)
      .sort();
    if (!owed.length || !deadline) return { claimed: null, reason: 'nothing_owed' };
    const taken = new Set((await this.#sessions.listForLearner(learnerId))
      .filter((fact) => fact.sessionId !== sessionId && fact.terminal !== true
        && fact.makeupSubject === subject && typeof fact.makeupFor === 'string')
      .map((fact) => fact.makeupFor));
    const forDay = owed.find((day) => !taken.has(day));
    if (!forDay) return { claimed: null, reason: 'claimed_elsewhere' };

    const { errors, event } = createEvent({
      type: 'makeup_claimed', at: this.#clock().toISOString(), sessionId, forDay, subject, deadline,
    });
    if (errors.length) {
      this.#logger.warn?.('school.makeup.claim-invalid', { sessionId, learnerId, errors });
      return { claimed: null, reason: 'invalid' };
    }
    await this.#sessions.appendEvent(sessionId, event);
    this.#logger.info?.('school.makeup.claimed', {
      learnerId, sessionId, subject, forDay, deadline, unitId: state.unitId ?? null,
    });
    return { claimed: forDay, reason: null };
  }
}

export default ClaimMakeupLesson;
