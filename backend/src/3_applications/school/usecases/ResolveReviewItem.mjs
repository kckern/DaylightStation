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

/**
 * `void` is the third honest answer (teacher-coverage 1.1). A grown-up looking
 * at a torn scan, or at a question that needs the child in the room, previously
 * had two options and neither was true: guess, which corrupts the record, or
 * leave it pending, which strands the WHOLE work session at `submitted` — a
 * state `abandoned` is illegal from, so nothing could ever clear it.
 *
 * A voided item resolves its queue row (it stops blocking the session) and is
 * taken out of the score's denominator by `GradeSubmission`: the percent
 * becomes "of the questions we could mark". It is never counted wrong — an
 * unreadable answer is not a wrong answer.
 */
const VERDICTS = new Set(['correct', 'incorrect', 'void']);

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
   * @param {'correct'|'incorrect'|'void'} args.verdict - `void` means "not
   *   markable from the evidence"; see the VERDICTS comment above.
   * @param {string} args.gradedBy - a roster id that must be a grown-up's
   * @param {string|null} [args.note] - what the parent wants the CHILD to
   *   read (Slice H, 2026-08-22): this is the only note field that reaches
   *   the result receipt's "NOTES FOR YOU" block (`reviewNoteLines` reads
   *   `note` alone). OPTIONAL on `correct`/`incorrect`, REQUIRED on `void`:
   *   a question quietly dropped from a child's score with no sentence
   *   explaining it is exactly the silent verb this household does not allow.
   * @param {string|null} [args.internalNote] - the record-only explanation
   *   (audit trail) — NEVER printed, never surfaced to the learner. Use this,
   *   not `note`, for anything written for the household's own reference.
   * @returns {Promise<object>} the resolved review item
   * @throws {import('#domains/school/errors.mjs').GuestForbiddenError} not a grown-up
   * @throws {ValidationError} the verdict is not correct|incorrect|void, or a
   *   `void` arrived with nothing to tell the child
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
      throw new ValidationError(`verdict must be correct|incorrect|void, got: ${verdict}`);
    }

    // Voiding takes a question out of a child's score. That is a decision
    // about their work, and the house rule is that no such decision happens
    // silently — so the sentence they will read is part of the verdict, not
    // an optional extra, and the write is refused without it. `correct` and
    // `incorrect` are unchanged: the mark itself already says something.
    if (verdict === 'void' && !(typeof note === 'string' && note.trim())) {
      throw new ValidationError('marking a question unmarkable needs a note the child can read — they will see this question missing from their score, and deserve to know why');
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
        // `void` counts as RESOLVED here. A voided row has had its grown-up
        // moment — it is not waiting on anybody — so it must not hold the
        // session open; leaving it out of this list is the whole point of the
        // verdict existing.
        const remaining = (await this.#reviewQueue.listForSession(sessionId))
          .filter((row) => !VERDICTS.has(row.verdict));
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
