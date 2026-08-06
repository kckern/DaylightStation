/**
 * MarkSessionAbandoned — the writer the `abandoned` terminal event never had
 * (admin advocacy A5): the domain defined it with required `{reason,
 * decidedBy}` and nothing in applications, API, or CLI could ever append it,
 * so an issued-never-scanned session read as `in_progress` forever —
 * indistinguishable from a child working right now.
 *
 * Gate-checked like every teacher verb, reason REQUIRED (the no-silent-verbs
 * contract: closing out a child's stuck work is a decision with an author and
 * a why, not housekeeping). Refuses terminal sessions — settling real work is
 * CloseSessionOutcome's job, not this one's; this is only for work that never
 * came back.
 *
 * `listStale` is the companion read: non-terminal sessions untouched for
 * `olderThanDays`, roster-wide, oldest first — what the Repair tab lists so
 * somebody finally NOTICES.
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

export class MarkSessionAbandoned {
  #sessions; #teacherGate; #learnerDirectory; #clock; #logger;

  constructor({ sessions, teacherGate, learnerDirectory = null, clock = () => new Date(), logger = console } = {}) {
    if (!sessions) throw new Error('MarkSessionAbandoned requires sessions');
    if (!teacherGate) throw new Error('MarkSessionAbandoned requires teacherGate');
    this.#sessions = sessions;
    this.#teacherGate = teacherGate;
    this.#learnerDirectory = learnerDirectory;
    this.#clock = clock;
    this.#logger = logger;
  }

  async execute({ sessionId, learnerId, reason, decidedBy = null, pin = null } = {}) {
    this.#teacherGate.assert({ userId: decidedBy, pin, action: 'sessions.abandon', context: { sessionId } });
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new ValidationError('a reason is required — abandoning a child\'s session is a decision, not housekeeping');
    }
    const rows = await this.#sessions.listForLearner(learnerId);
    const row = rows.find((r) => r.sessionId === sessionId);
    if (!row) throw new EntityNotFoundError('session', sessionId);
    if (row.terminal) {
      throw new ValidationError(`session ${sessionId} is already settled (${row.state}) — nothing to abandon`);
    }
    await this.#sessions.appendEvent(sessionId, {
      type: 'abandoned',
      at: this.#clock().toISOString(),
      sessionId,
      reason: reason.trim(),
      decidedBy,
    });
    this.#logger.info?.('school.session.abandoned', { sessionId, learnerId, decidedBy, reason: reason.trim() });
    return { sessionId, state: 'abandoned' };
  }

  /**
   * Non-terminal sessions untouched for `olderThanDays`, roster-wide, oldest
   * first. This is the "who notices" read the advocate found missing.
   */
  async listStale({ olderThanDays = 7 } = {}) {
    if (!this.#learnerDirectory) return [];
    const cutoff = this.#clock().getTime() - olderThanDays * 86400000;
    const learners = await this.#learnerDirectory.listLearners();
    const stale = [];
    for (const learner of learners) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await this.#sessions.listForLearner(learner.id).catch(() => []);
      rows
        .filter((r) => !r.terminal && r.updatedAt && Date.parse(r.updatedAt) < cutoff)
        .forEach((r) => stale.push({
          sessionId: r.sessionId,
          learnerId: learner.id,
          unitId: r.unitId ?? null,
          state: r.state ?? null,
          updatedAt: r.updatedAt,
        }));
    }
    return stale.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
  }
}

export default MarkSessionAbandoned;
