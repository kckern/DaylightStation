/**
 * ReassignSession — re-credit ONE work session to the child who actually did
 * it. The writer the `reassigned` event never had: the type was declared,
 * validated, folded by the reducer and listed in `ANNOTATION_EVENTS`, and
 * nothing in the codebase could append it, so the fact it models could not be
 * recorded at all.
 *
 * The twin of `ReassignEvidence`, and deliberately NOT merged with it. That
 * one moves ATTEMPT EVENTS between learner shards — the repair when a machine
 * recorded answers under the wrong name. Work with no machine attempts (a
 * program-served lesson, paper a grown-up marked by hand, a launch outcome)
 * has no attempts to move, and until this existed could not be re-credited by
 * any means. Two repairs over two kinds of evidence; the console offers both
 * and neither pretends to be the other.
 *
 * The move is one APPENDED event. Nothing already written is edited: the log
 * stays append-only, and every derived read follows on the next read because
 * `reduceSession` rewrites `state.learnerId` from the annotation (which is
 * what `listForLearner` buckets on).
 *
 * Gated like every teacher verb, reason required, and both children told —
 * the same posture as `ReassignEvidence`'s `#recordAudit`/`#tellKids`: the
 * append has already committed by the time either runs, so neither a broken
 * audit log nor a broken notes store can block or unwind the move.
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

export class ReassignSession {
  #sessions; #teacherGate; #clock; #notes; #auditLog; #logger;

  constructor({ sessions, teacherGate, notes = null, auditLog = null, clock = () => new Date(), logger = console } = {}) {
    if (!sessions) throw new Error('ReassignSession requires sessions');
    if (!teacherGate) throw new Error('ReassignSession requires teacherGate');
    this.#sessions = sessions;
    this.#teacherGate = teacherGate;
    this.#notes = notes;
    this.#auditLog = auditLog;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId - the work session to re-credit
   * @param {string} args.toLearnerId - the child it actually belongs to
   * @param {string} args.reason - why; mandatory, and stored in the event
   * @param {string|null} [args.reassignedBy] - the acting teacher's stamp
   * @param {string|object|null} [args.pin] - console pin or capability tokens
   */
  async execute({ sessionId, toLearnerId, reason, reassignedBy = null, pin = null } = {}) {
    this.#teacherGate.assert({
      userId: reassignedBy, pin, action: 'sessions.reassign',
      context: { sessionId, toLearnerId },
    });
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new ValidationError('sessionId is required');
    const events = await this.#sessions.readEvents(sessionId);
    if (!events.length) throw new EntityNotFoundError('work session', sessionId);
    const before = reduceSession(events);
    if (!before.learnerId) {
      throw new ValidationError(`session ${sessionId} has no learner on record — there is nothing to re-credit`);
    }
    const fromLearnerId = before.learnerId;
    // The event schema owns the payload rules — both learners named, the two
    // of them different, a reason present. Building through `createEvent`
    // SURFACES its refusal rather than restating it here: a second copy of
    // "a reassignment to the same learner records no fact" is a copy free to
    // drift from the one the reducer and the datastore both consult.
    const { errors, event } = createEvent({
      type: 'reassigned',
      at: this.#clock().toISOString(),
      sessionId,
      fromLearnerId,
      toLearnerId,
      reviewedBy: reassignedBy,
      reason: typeof reason === 'string' ? reason.trim() : reason,
    });
    if (errors.length) throw new ValidationError(errors.join('; '));
    // Legality at the CURRENT state is the datastore's call, inside its append
    // lock (`reassigned` is an annotation and is legal at every state, terminal
    // included — see TERMINAL_ANNOTATIONS). A refusal from here propagates.
    const stored = await this.#sessions.appendEvent(sessionId, event);
    // The study day the work belongs to, for the trail and for what the kids
    // are told. `studyDay` when the session recorded one; otherwise the day it
    // was opened, which is the same answer for everything the agenda mints.
    const day = before.studyDay ?? (String(events[0]?.at ?? '').slice(0, 10) || null);
    const result = {
      sessionId, fromLearnerId, toLearnerId, day,
      unitId: before.unitId ?? null, seq: stored?.seq ?? null,
    };
    this.#logger.info?.('school.session.reassigned', {
      sessionId, fromLearnerId, toLearnerId, reassignedBy, seq: result.seq,
    });
    await this.#recordAudit({ ...result, reason: event.reason, reassignedBy });
    // No silent verbs about children (student-advocacy A5): both kids hear
    // what happened to the record in their own feed.
    await this.#tellKids({ fromLearnerId, toLearnerId, day, reassignedBy });
    return result;
  }

  async #recordAudit({ sessionId, fromLearnerId, toLearnerId, day, reason, reassignedBy }) {
    if (!this.#auditLog) return;
    try {
      await this.#auditLog.append({
        at: this.#clock().toISOString(), fromLearnerId, toLearnerId, day,
        // `kind` is what keeps the shared trail honest: an attempt move and a
        // session re-credit are different repairs and a reader must be able to
        // tell them apart. `assessmentId` carries the session id so the
        // existing `GET /audit` projection still names the work that moved.
        kind: 'session', sessionId, assessmentId: sessionId, moved: 1, reason, reassignedBy,
      });
    } catch (err) {
      this.#logger.warn?.('school.session.reassign-audit-failed', {
        sessionId, fromLearnerId, toLearnerId, error: err?.message,
      });
    }
  }

  async #tellKids({ fromLearnerId, toLearnerId, day, reassignedBy }) {
    if (!this.#notes) return;
    const at = this.#clock().toISOString();
    const mk = (learnerId, note) => this.#notes.append({
      id: `note_${Math.random().toString(36).slice(2, 10)}`, at, from: reassignedBy, learnerId, note,
    });
    try {
      await mk(fromLearnerId, `A lesson recorded on your account on ${day} was moved to the right person. Ask a grown-up if that seems wrong.`);
      await mk(toLearnerId, `A lesson you did on ${day} was credited to you — it had landed on the wrong account.`);
    } catch (err) {
      // The move already succeeded and must not be undone by a failed note —
      // but both children were told something about their own record that they
      // then did not hear, which is exactly what a later review needs to find.
      this.#logger.warn?.('school.session.reassign-note-failed', {
        fromLearnerId, toLearnerId, day, error: err?.message,
      });
    }
  }
}

export default ReassignSession;
