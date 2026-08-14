/**
 * ReassignEvidence — attribution repair (spec D1): move one assessment's
 * attempt events for one day from the mis-credited learner to the right
 * one. The move IS the design ("the log is the source of truth, so a later
 * reassignment moves the evidence and the statistics together"); every
 * derived rollup follows automatically. Gated; audited in the moved events
 * themselves (reassignedFrom/By/At) and in the returned receipt. Optionally
 * also appended to a standalone audit trail (`auditLog`, Task 12 / debt
 * M5) — a queryable "who moved what, when" history distinct from the
 * per-event provenance stamps. That append is BEST-EFFORT: the move has
 * already committed by the time it runs, so a broken/corrupt log can
 * never block or unwind it (same posture as `#tellKids` below).
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ReassignEvidence {
  #datastore; #teacherGate; #clock; #notes; #auditLog; #logger;

  constructor({ datastore, teacherGate, notes = null, auditLog = null, clock = () => new Date(), logger = console } = {}) {
    if (!datastore) throw new Error('ReassignEvidence requires datastore');
    if (!teacherGate) throw new Error('ReassignEvidence requires teacherGate');
    this.#datastore = datastore;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#notes = notes;
    this.#auditLog = auditLog;
    this.#logger = logger;
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
    // The standalone audit trail (Task 12, debt M5) — best-effort, after the
    // move already committed; see class doc.
    await this.#recordAudit({ fromLearnerId, toLearnerId, day, assessmentId, moved, reassignedBy });
    // No silent verbs about children (student-advocacy A5): both kids hear
    // what happened to the record in their own feed.
    await this.#tellKids({ fromLearnerId, toLearnerId, day, reassignedBy });
    return { moved, fromLearnerId, toLearnerId, day, assessmentId };
  }

  async #recordAudit({ fromLearnerId, toLearnerId, day, assessmentId, moved, reassignedBy }) {
    if (!this.#auditLog) return;
    try {
      await this.#auditLog.append({
        at: this.#clock().toISOString(), fromLearnerId, toLearnerId, day, assessmentId, moved, reassignedBy,
      });
    } catch (err) {
      this.#logger.warn?.('school.reassign.audit-failed', { fromLearnerId, toLearnerId, day, assessmentId, error: err?.message });
    }
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
    } catch (err) {
      // The move already succeeded and must not be undone by a failed note —
      // but both children were told something about their own record that they
      // then did not hear, which is exactly what a later review needs to find.
      this.#logger.warn?.('school.reassign.note-failed', {
        fromLearnerId, toLearnerId, day, error: err?.message,
      });
    }
  }
}
