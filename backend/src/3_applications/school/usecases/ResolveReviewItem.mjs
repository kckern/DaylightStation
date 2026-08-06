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
  #reviewQueue; #grownUps; #teacherGate; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('../ports/IReviewQueue.mjs').IReviewQueue} deps.reviewQueue
   * @param {import('../GrownUpGate.mjs').GrownUpGate} deps.grownUps
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({ reviewQueue, grownUps, teacherGate = null, clock = () => new Date(), logger = console } = {}) {
    if (!reviewQueue) throw new Error('ResolveReviewItem requires a reviewQueue');
    if (!grownUps) throw new Error('ResolveReviewItem requires grownUps (a GrownUpGate)');
    this.#reviewQueue = reviewQueue;
    this.#grownUps = grownUps;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId
   * @param {string} args.itemId
   * @param {'correct'|'incorrect'} args.verdict
   * @param {string} args.gradedBy - a roster id that must be a grown-up's
   * @param {string|null} [args.note] - what the parent wants the child to read
   * @returns {Promise<object>} the resolved review item
   * @throws {import('#domains/school/errors.mjs').GuestForbiddenError} not a grown-up
   * @throws {ValidationError} the verdict is not correct|incorrect
   * @throws {EntityNotFoundError} nothing with that itemId is queued
   */
  async execute({ sessionId, itemId, verdict, gradedBy = null, note = null, pin = null } = {}) {
    // TeacherGate (spec §1) subsumes the grown-up rule and adds role + pin;
    // absent (pre-console composition, paper flows' tests) → legacy gate.
    if (this.#teacherGate) this.#teacherGate.assert({ userId: gradedBy, pin, action: 'review.resolve' });
    else this.#grownUps.assert(gradedBy, 'Only a grown-up can sign off schoolwork', {
      action: 'review.resolve', sessionId, itemId,
    });

    if (!VERDICTS.has(verdict)) {
      throw new ValidationError(`verdict must be correct|incorrect, got: ${verdict}`);
    }

    const item = await this.#reviewQueue.resolve({
      sessionId, itemId, verdict, gradedBy, note, at: this.#clock().toISOString(),
    });
    if (!item) throw new EntityNotFoundError('review-item', `${sessionId}/${itemId}`);

    this.#logger.info?.('school.review.resolved', {
      sessionId, itemId, verdict, gradedBy, note: Boolean(note),
    });
    return item;
  }
}

export default ResolveReviewItem;
