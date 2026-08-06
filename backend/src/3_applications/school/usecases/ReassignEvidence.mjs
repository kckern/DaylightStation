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
  #datastore; #teacherGate; #clock;

  constructor({ datastore, teacherGate, clock = () => new Date() } = {}) {
    if (!datastore) throw new Error('ReassignEvidence requires datastore');
    if (!teacherGate) throw new Error('ReassignEvidence requires teacherGate');
    this.#datastore = datastore;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
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
    return { moved, fromLearnerId, toLearnerId, day, assessmentId };
  }
}
