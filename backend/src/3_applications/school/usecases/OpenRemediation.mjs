/**
 * OpenRemediation — the second half of a failed result (spec §5.2, §12 Q7).
 *
 * `CloseSessionOutcome` prints the retry ticket; scanning it lands here. A
 * remediation is a LINKED session, not a rewind: the original keeps its own
 * evidence and reaches its terminal state (`remediation_opened`), and a new
 * session opens carrying `remediationOf` plus the NEXT VARIANT. Every attempt
 * stays individual evidence while the lineage stays readable — which is the
 * whole reason the spec refuses to let a retry overwrite anything.
 *
 * The variant is what makes a retry a retry rather than the same sheet handed
 * back. It cycles within the unit's declared `retry.variants`, so a unit with
 * three forms gives three genuinely different sheets before it repeats.
 *
 * This is its own use case rather than a branch inside `CloseSessionOutcome`
 * because it is a different business operation happening at a different moment:
 * settling a result is what the grader does, and starting the retry is what the
 * CHILD does, minutes or days later, by scanning.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { noticeDocument } from '#domains/school/documents/receipts.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

export class OpenRemediation {
  #curriculum; #sessions; #clock; #newSessionId; #logger;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {() => Date} [deps.clock]
   * @param {() => string} [deps.newSessionId]
   * @param {object} [deps.logger]
   */
  constructor({ curriculum, sessions, clock = () => new Date(), newSessionId = () => `ses_${shortId(8)}`, logger = console } = {}) {
    if (!curriculum || !sessions) throw new Error('OpenRemediation requires curriculum and sessions');
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#clock = clock;
    this.#newSessionId = newSessionId;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId - the FAILED session the retry hangs off
   * @returns {Promise<{ status: 'opened'|'already_opened'|'unavailable',
   *                     sessionId: string|null, newSessionId: string|null,
   *                     variant: number|null, document: object|null, message: string }>}
   */
  async execute({ sessionId, openedBy = null } = {}) {
    const nowIso = this.#clock().toISOString();
    const state = reduceSession(await this.#sessions.readEvents(sessionId));
    if (!state.sessionId) return this.#unavailable(sessionId, 'We could not find that work.');

    if (state.remediation) {
      // Re-scanning the retry ticket resumes the same fresh sheet; it does not
      // open a third session.
      return {
        status: 'already_opened',
        sessionId,
        newSessionId: state.remediation.newSessionId,
        variant: state.remediation.variant,
        message: 'Your fresh sheet is already waiting. Scan your card to print it.',
        document: null,
      };
    }
    if (state.state !== 'outcome_recorded' || state.outcome?.result !== 'needs_remediation') {
      return this.#unavailable(sessionId, 'There is nothing to try again right now.');
    }

    const unit = await this.#curriculum.getUnit(state.unitId);
    const variants = unit?.retry?.variants ?? 1;
    // Cycles within what the unit actually authored: promising a fourth form of
    // a three-form worksheet would print the first one and call it new.
    const variant = (state.variant + 1) % Math.max(1, variants);
    const newSessionId = this.#newSessionId();

    const opened = createEvent({
      type: 'created', at: nowIso, sessionId: newSessionId,
      learnerId: state.learnerId, unitId: state.unitId, remediationOf: sessionId, variant,
      remediationItemIds: state.missedItemIds, ...(openedBy ? { openedBy } : {}),
    });
    if (opened.errors.length) throw new Error(`OpenRemediation: could not open the retry: ${opened.errors.join('; ')}`);
    await this.#sessions.appendEvent(newSessionId, opened.event);

    // The original closes only AFTER the replacement exists, so a crash between
    // the two leaves a session that can still be retried rather than one that
    // is terminal with nothing behind it.
    const linked = createEvent({ type: 'remediation_opened', at: nowIso, sessionId, newSessionId, variant,
      ...(openedBy ? { openedBy } : {}) });
    if (linked.errors.length) throw new Error(`OpenRemediation: could not link the retry: ${linked.errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, linked.event);

    this.#logger.info?.('school.remediation.opened', {
      sessionId, newSessionId, unitId: state.unitId, variant, variants, openedBy,
    });

    return {
      status: 'opened',
      sessionId,
      newSessionId,
      variant,
      message: 'Printing a fresh sheet to try again.',
      document: null,
    };
  }

  #unavailable(sessionId, line) {
    return {
      status: 'unavailable',
      sessionId: sessionId ?? null,
      newSessionId: null,
      variant: null,
      message: line,
      document: noticeDocument({
        id: `retry-${sessionId ?? 'none'}`,
        headline: 'Nothing to try again',
        lines: [line, 'Scan your card to see what is next.'],
      }),
    };
  }
}

export default OpenRemediation;
