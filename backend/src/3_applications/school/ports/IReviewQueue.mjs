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
 * @typedef {{ sessionId: string, itemId: string, learnerId: string|null,
 *             unitId: string|null, reason: 'ambiguous'|'blank'|'free_response'|'unscorable'|'machine',
 *             given: *, prompt: string|null, questionNumber: number|null,
 *             rubric: string|null, enqueuedAt: string,
 *             verdict: 'correct'|'incorrect'|null, gradedBy: string|null,
 *             gradedAt: string|null, note: string|null }} ReviewItem
 */
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
   * @param {'correct'|'incorrect'} args.verdict
   * @param {string} args.gradedBy
   * @param {string|null} [args.note] - what the parent wants the child to read:
   *   why it was marked that way. Optional, kept verbatim, and NOT erased by a
   *   later verdict that arrives without one.
   * @param {string} args.at - ISO time (injected; the adapter reads no clock)
   * @returns {Promise<ReviewItem|null>} null when the item is not queued
   */
  async resolve({ sessionId, itemId, verdict, gradedBy, note, at }) {
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
