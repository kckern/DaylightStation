/**
 * IReviewQueue — persistence contract for work a machine must not score.
 * @module applications/school/ports/IReviewQueue
 *
 * Spec §7.3: OMR is "an additional feeder, not a new pipeline". Whatever cannot
 * be scored honestly — a smudged bubble row, an empty one, a free-response
 * answer with no bank item behind it — lands here for a grown-up, and the
 * session waits rather than inventing a verdict.
 *
 * Items are keyed by `(sessionId, itemId)`: enqueueing the same item twice is a
 * retry, not a second thing to mark.
 *
 * `prompt` is WHAT WAS ASKED — the bank item's own question, or the wording
 * printed on the sheet when there is no bank — and `rubric` is HOW THIS UNIT
 * SAYS TO MARK IT, which is the same sentence for every item on a sheet. They
 * were one field once, holding the rubric, and a parent grading six questions
 * read the same line six times with nothing to tell them apart.
 *
 * ONE NAMED EXCEPTION to "the same sentence for every item on a sheet":
 * a `'key-alignment-suspected'` entry's `rubric` is not a marking guide at
 * all — it is a per-entry, PER-SCAN computed evidence sentence naming the
 * literal and shifted score (e.g. "would score 5/6 instead of 2/6"), built
 * once by `keyAlignmentRubric` (`RecordCardScanOutcome.mjs`) from that
 * scan's own `offset`/`literalMatches`/`shiftedMatches`/`itemCount`. It
 * reuses this field rather than adding a new one because it is exactly as
 * grown-up-only and non-child-facing as an ordinary rubric is — never
 * because it repeats across a sheet the way a real rubric does; every other
 * item this queue enqueues for a print unit still leaves `rubric: null`.
 *
 * TWO NOTE FIELDS, NOT ONE (Slice H, 2026-08-22). `note` is what the child
 * reads; `internalNote` is what the record keeps. They are separate fields
 * on purpose, not a convention layered on one shared string: a sign-off
 * explanation ("Eraser signature: leniency applied, spec §5.4") or anything
 * else written for the AUDIT TRAIL belongs in `internalNote` and is invisible
 * to every reader that builds a receipt. `receipts.mjs`'s `reviewNoteLines`
 * — the only path from this queue to a child's paper (the "NOTES FOR YOU"
 * block) — reads `note` alone; it has no parameter that could reach
 * `internalNote` even by accident. A grown-up's note stays child-facing by
 * construction, and machine-written audit text (Slice B's eraser-leniency
 * rationale, `RecordCardScanOutcome.mjs`) has a real home that a receipt
 * builder structurally cannot read from.
 *
 * @typedef {{ sessionId: string, itemId: string, learnerId: string|null,
 *             unitId: string|null, reason: 'ambiguous'|'blank'|'free_response'|'unscorable'|'machine'|'key-alignment-suspected',
 *             given: *, prompt: string|null, questionNumber: number|null,
 *             rubric: string|null, enqueuedAt: string,
 *             verdict: 'correct'|'incorrect'|'void'|null, gradedBy: string|null,
 *             gradedAt: string|null, note: string|null,
 *             internalNote: string|null }} ReviewItem
 */

/**
 * A `'key-alignment-suspected'` item (the OMR key-alignment check) is NOT a
 * printed question — nothing was asked, nothing was answered, there is no
 * bank item behind it. It rides this same queue only because the queue is
 * also the session's "hold before the outcome is final" mechanism. Every
 * reader that turns queue/evidence items into a question roster, a
 * denominator, or a numbered "printed questions" list must exclude it, or
 * resolving it (with a truth-value verdict instead of `void`) changes a
 * child's actual score, or shows a teacher/child a fabricated question.
 *
 * Import `isSyntheticReviewItem` rather than comparing a `reason` field to
 * the literal string at each call site — one shared predicate is how every
 * site is guaranteed to agree; a second hand-written string comparison is
 * exactly how the `AdjustSessionGrade.mjs` instance of this bug (whole-
 * branch review finding #1) was missed when `GradeSubmission.mjs` was fixed.
 */
export const KEY_ALIGNMENT_SUSPECTED_REASON = 'key-alignment-suspected';

/** @param {{ reason?: string }|null|undefined} item @returns {boolean} */
export const isSyntheticReviewItem = (item) => item?.reason === KEY_ALIGNMENT_SUSPECTED_REASON;

export class IReviewQueue {
  /**
   * Add (or refresh) items awaiting a person. Already-resolved items are left
   * alone: a re-submission must not un-mark what a parent already marked.
   *
   * @param {ReviewItem[]} items
   * @returns {Promise<ReviewItem[]>} the session's full queue after the write
   */
  async enqueue(items) {
    throw new Error('IReviewQueue.enqueue must be implemented');
  }

  /**
   * @param {string} sessionId
   * @returns {Promise<ReviewItem[]>} empty when there is nothing to mark
   */
  async listForSession(sessionId) {
    throw new Error('IReviewQueue.listForSession must be implemented');
  }

  /**
   * Record a person's verdict on one item.
   *
   * @param {object} args
   * @param {string} args.sessionId
   * @param {string} args.itemId
   * @param {'correct'|'incorrect'|'void'} args.verdict - `void` is "not
   *   markable from the evidence": it RESOLVES the item (so it stops holding
   *   the session open and stops appearing in `listPending`) without giving
   *   it a truth value, and the grading use case leaves it out of the score's
   *   denominator entirely. It is never a synonym for wrong.
   * @param {string} args.gradedBy
   * @param {string|null} [args.note] - what the parent wants the CHILD to
   *   read: why it was marked that way. Optional, kept verbatim, and NOT
   *   erased by a later verdict that arrives without one. THIS is the field
   *   `reviewNoteLines`/the result receipt's "NOTES FOR YOU" block reads.
   * @param {string|null} [args.internalNote] - the record-only explanation
   *   (audit trail). Same keep-verbatim/not-erased treatment as `note`, but
   *   NEVER printed and NEVER surfaced to the learner — no receipt builder
   *   reads this field. Use it for anything written for a grown-up's own
   *   reference rather than the child (a machine-generated leniency
   *   rationale, an internal cross-reference), never `note`.
   * @param {string} args.at - ISO time (injected; the adapter reads no clock)
   * @returns {Promise<ReviewItem|null>} null when the item is not queued
   */
  async resolve({ sessionId, itemId, verdict, gradedBy, note, internalNote, at }) {
    throw new Error('IReviewQueue.resolve must be implemented');
  }

  /**
   * Everything still awaiting a person, across sessions — the parent queue.
   * @returns {Promise<ReviewItem[]>}
   */
  async listPending() {
    throw new Error('IReviewQueue.listPending must be implemented');
  }

  /**
   * A learner's own RESOLVED items, newest-first — the feedback a child can
   * see (spec R7): what a grown-up already marked and why, never a pending
   * item still awaiting a verdict.
   *
   * @param {string} learnerId
   * @param {object} [opts]
   * @param {number} [opts.limit=20]
   * @returns {Promise<ReviewItem[]>}
   */
  async listForLearner(learnerId, { limit = 20 } = {}) {
    throw new Error('IReviewQueue.listForLearner must be implemented');
  }
}

export default IReviewQueue;
