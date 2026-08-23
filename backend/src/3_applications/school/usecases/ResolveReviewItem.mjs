/**
 * ResolveReviewItem — a grown-up marks one piece of work (spec §7.3).
 *
 * WHY THIS EXISTS AS A USE CASE. The router used to call `IReviewQueue.resolve`
 * directly with whatever `gradedBy` string arrived in the body, and the store
 * wrote it verbatim. Nothing checked it against the roster, so the only thing
 * standing between a child and their own sign-off was the parent UI's grown-up
 * picker — a usability affordance that curl does not have to use.
 *
 * So the check lives here, in front of the write, exactly as `PrintService`
 * gates approval of a print. A forged `gradedBy` posted straight at the HTTP
 * route reaches this method and is refused before the queue is touched.
 *
 * IDENTITY IS CHECKED FIRST, before the verdict is even looked at: someone who
 * may not mark this does not get to find out whether their payload was
 * well-formed.
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const VERDICTS = new Set(['correct', 'incorrect']);

export class ResolveReviewItem {
  #reviewQueue; #grownUps; #teacherGate; #clock; #logger; #gradeSubmission; #closeSessionOutcome;

  /**
   * @param {object} deps
   * @param {import('../ports/IReviewQueue.mjs').IReviewQueue} deps.reviewQueue
   * @param {import('../GrownUpGate.mjs').GrownUpGate} deps.grownUps
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    reviewQueue, grownUps, teacherGate = null,
    // Optional finishers (student-advocacy A1): with both present, resolving
    // the LAST pending item of a session grades and closes it in the same
    // act. Absent (tests, partial wiring) → resolve-only, as before.
    gradeSubmission = null, closeSessionOutcome = null,
    clock = () => new Date(), logger = console,
  } = {}) {
    if (!reviewQueue) throw new Error('ResolveReviewItem requires a reviewQueue');
    if (!grownUps) throw new Error('ResolveReviewItem requires grownUps (a GrownUpGate)');
    this.#reviewQueue = reviewQueue;
    this.#grownUps = grownUps;
    this.#teacherGate = teacherGate;
    this.#gradeSubmission = gradeSubmission;
    this.#closeSessionOutcome = closeSessionOutcome;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId
   * @param {string} args.itemId
   * @param {'correct'|'incorrect'} args.verdict
   * @param {string} args.gradedBy - a roster id that must be a grown-up's
   * @param {string|null} [args.note] - what the parent wants the CHILD to
   *   read (Slice H, 2026-08-22): this is the only note field that reaches
   *   the result receipt's "NOTES FOR YOU" block (`reviewNoteLines` reads
   *   `note` alone).
   * @param {string|null} [args.internalNote] - the record-only explanation
   *   (audit trail) — NEVER printed, never surfaced to the learner. Use this,
   *   not `note`, for anything written for the household's own reference.
   * @returns {Promise<object>} the resolved review item
   * @throws {import('#domains/school/errors.mjs').GuestForbiddenError} not a grown-up
   * @throws {ValidationError} the verdict is not correct|incorrect
   * @throws {EntityNotFoundError} nothing with that itemId is queued
   */
  async execute({
    sessionId, itemId, verdict, gradedBy = null, note = null, internalNote = null, pin = null,
  } = {}) {
    // TeacherGate (spec §1) subsumes the grown-up rule and adds role + pin;
    // absent (pre-console composition, paper flows' tests) → legacy gate.
    if (this.#teacherGate) this.#teacherGate.assert({ userId: gradedBy, pin, action: 'review.resolve', context: { sessionId, itemId } });
    else this.#grownUps.assert(gradedBy, 'Only a grown-up can sign off schoolwork', {
      action: 'review.resolve', sessionId, itemId,
    });

    if (!VERDICTS.has(verdict)) {
      throw new ValidationError(`verdict must be correct|incorrect, got: ${verdict}`);
    }

    const item = await this.#reviewQueue.resolve({
      sessionId, itemId, verdict, gradedBy, note, internalNote, at: this.#clock().toISOString(),
    });
    if (!item) throw new EntityNotFoundError('review-item', `${sessionId}/${itemId}`);

    this.#logger.info?.('school.review.resolved', {
      sessionId, itemId, verdict, gradedBy, note: Boolean(note), internalNote: Boolean(internalNote),
    });

    // The review loop closes itself (student-advocacy A1): if that was the
    // session's LAST pending item, grade and settle NOW — a child's finished
    // work must never wait on an actor nobody wired. Failures here degrade
    // to resolve-only (the verdict is safely on record either way) and log.
    let sessionFinished = null;
    if (this.#gradeSubmission && this.#closeSessionOutcome) {
      try {
        const remaining = (await this.#reviewQueue.listForSession(sessionId))
          .filter((row) => row.verdict !== 'correct' && row.verdict !== 'incorrect');
        if (remaining.length === 0) {
          const graded = await this.#gradeSubmission.execute({ sessionId });
          if (graded?.status === 'graded') {
            const outcome = await this.#closeSessionOutcome.execute({ sessionId });
            sessionFinished = {
              result: outcome?.result ?? null,
              percent: graded.percent ?? null,
              passingPercent: graded.passingPercent ?? null,
            };
            this.#logger.info?.('school.review.session-finished', { sessionId, ...sessionFinished });
          }
        }
      } catch (err) {
        this.#logger.warn?.('school.review.finish-failed', { sessionId, error: err.message });
      }
    }
    return sessionFinished ? { ...item, sessionFinished } : item;
  }
}

export default ResolveReviewItem;
