/**
 * ReassignEvidence — attribution repair (spec D1): move one assessment's
 * attempt events for one day from the mis-credited learner to the right
 * one. The move IS the design ("the log is the source of truth, so a later
 * reassignment moves the evidence and the statistics together"); every
 * derived rollup follows automatically. Gated; audited in the moved events
 * themselves (reassignedFrom/By/At) and in the returned receipt.
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ReassignEvidence {
  #datastore; #teacherGate; #clock; #notes;

  constructor({ datastore, teacherGate, notes = null, clock = () => new Date() } = {}) {
    if (!datastore) throw new Error('ReassignEvidence requires datastore');
    if (!teacherGate) throw new Error('ReassignEvidence requires teacherGate');
    this.#datastore = datastore;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#notes = notes;
  }

  async execute({ fromLearnerId, toLearnerId, day, assessmentId, reassignedBy = null, pin = null } = {}) {
    this.#teacherGate.assert({
      userId: reassignedBy, pin, action: 'evidence.reassign',
      context: { fromLearnerId, toLearnerId, day, assessmentId },
    });
    if (typeof fromLearnerId !== 'string' || !fromLearnerId.trim()) throw new ValidationError('fromLearnerId is required');
    if (typeof toLearnerId !== 'string' || !toLearnerId.trim()) throw new ValidationError('toLearnerId is required');
    if (fromLearnerId === toLearnerId) throw new ValidationError('from and to must differ');
    if (typeof day !== 'string' || !DAY_RE.test(day)) throw new ValidationError('day must be YYYY-MM-DD');
    if (typeof assessmentId !== 'string' || !assessmentId.trim()) throw new ValidationError('assessmentId is required');
    const moved = this.#datastore.moveAttempts({
      fromUserId: fromLearnerId, toUserId: toLearnerId, day, assessmentId,
      reassignedBy, at: this.#clock().toISOString(),
    });
    if (!moved) throw new EntityNotFoundError('assessment attempts', `${fromLearnerId}/${day}/${assessmentId}`);
    // No silent verbs about children (student-advocacy A5): both kids hear
    // what happened to the record in their own feed.
    await this.#tellKids({ fromLearnerId, toLearnerId, day, reassignedBy });
    return { moved, fromLearnerId, toLearnerId, day, assessmentId };
  }

  async #tellKids({ fromLearnerId, toLearnerId, day, reassignedBy }) {
    if (!this.#notes) return;
    const at = this.#clock().toISOString();
    const mk = (learnerId, note) => this.#notes.append({
      id: `note_${Math.random().toString(36).slice(2, 10)}`, at, from: reassignedBy, learnerId, note,
    });
    try {
      await mk(fromLearnerId, `Some work recorded on your account on ${day} was moved to the right person. Ask a grown-up if that seems wrong.`);
      await mk(toLearnerId, `Some work you did on ${day} was credited to you — it had landed on the wrong account.`);
    } catch { /* the move already succeeded; the note is best-effort */ }
  }
}
