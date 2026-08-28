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
import { statesAccepting } from '#domains/school/sessions/sessionEvents.mjs';

/**
 * The one legality check for "may this session still be abandoned" —
 * `execute`, `listStale`, and `sweepUntouched` all ask THIS, never their own
 * copy of the state list. A null/unknown state is not permission: `Set#has`
 * on `null` or a name the table has never heard of is simply `false`.
 */
function isAbandonable(state) {
  return statesAccepting('abandoned').has(state);
}

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
    // The event machine is the authority (M8 fix): `abandoned` is legal from
    // only some states. Appending it anyway would record a permanent anomaly
    // WITHOUT changing state — the row would 'succeed' and then reappear.
    if (!isAbandonable(row.state)) {
      throw new ValidationError(
        `session ${sessionId} is ${row.state} — that work settles through grading/close, not abandonment`,
      );
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
   *
   * `abandonable` is stamped here so the panel that renders this list never
   * has to ask the question itself — the client cannot import the domain
   * table, and a second copy of it in JSX is the exact mistake
   * `statesAccepting` was extracted to prevent. A row whose state is null or
   * unknown is not abandonable: an unknown state is not permission.
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
        .forEach((r) => {
          const state = r.state ?? null;
          stale.push({
            sessionId: r.sessionId,
            learnerId: learner.id,
            unitId: r.unitId ?? null,
            state,
            updatedAt: r.updatedAt,
            abandonable: isAbandonable(state),
          });
        });
    }
    return stale.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
  }

  /**
   * THE SWEEP: close out work that was handed to a child and never came back.
   *
   * Nothing scheduled ever called `listStale`. It was reachable only through a
   * manual, teacher-gated `GET /sessions/stale`, so the seven-day threshold
   * written into that route was never once consulted — which is how Learner-Four's
   * 2026-08-14 session was still live eight days later and resumed as if it
   * were that morning's work.
   *
   * UNTOUCHED WORK ONLY (KC's call, 2026-08-23). A session is swept only when
   * the child produced nothing to grade:
   *
   *   - the state machine must permit `abandoned` from its state. This is the
   *     load-bearing guard and it is structural, not a list maintained here:
   *     `TRANSITIONS` allows `abandoned` from `created`, `issued`, `reprinted`,
   *     `media_dispatched`, `media_stalled` and `launch_dispatched` — every one
   *     of them pre-submission. Anything `submitted` or later cannot be swept
   *     even if this method tried.
   *   - and it must carry no attempt ids. Belt to that brace: a session that
   *     somehow accumulated graded evidence without advancing is exactly the
   *     anomaly a sweep must leave for a person.
   *
   * NO TEACHER GATE, deliberately, and this is the one place in this class
   * that skips it. The gate exists so a PERSON cannot close a child's work
   * without authority; a threshold the household configured IS that authority,
   * and a cron job has no PIN to offer. The authorship requirement is honoured
   * rather than dropped — every event this writes names `system:stale-sweep`
   * and carries a reason saying how old the work was.
   *
   * @param {object} [args]
   * @param {number} [args.olderThanDays=14]
   * @param {boolean} [args.dryRun=false] - report what WOULD be swept, write nothing
   * @returns {Promise<{swept: Array, skipped: Array, olderThanDays: number, dryRun: boolean}>}
   */
  async sweepUntouched({ olderThanDays = 14, dryRun = false } = {}) {
    const candidates = await this.listStale({ olderThanDays });
    const swept = [];
    const skipped = [];

    for (const row of candidates) {
      // `candidates` came from `listStale`, which already stamped this.
      if (!row.abandonable) {
        skipped.push({ ...row, reason: 'state-settles-through-grading' });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const events = await this.#sessions.readEvents(row.sessionId).catch(() => null);
      if (!events) {
        skipped.push({ ...row, reason: 'events-unreadable' });
        continue;
      }
      const attempts = events.filter((event) => Array.isArray(event?.attemptIds) && event.attemptIds.length);
      if (attempts.length) {
        skipped.push({ ...row, reason: 'has-graded-attempts' });
        continue;
      }

      const ageDays = Math.floor((this.#clock().getTime() - Date.parse(row.updatedAt)) / 86400000);
      if (dryRun) {
        swept.push({ ...row, ageDays });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.#sessions.appendEvent(row.sessionId, {
          type: 'abandoned',
          at: this.#clock().toISOString(),
          sessionId: row.sessionId,
          reason: `untouched for ${ageDays} days — swept automatically`,
          decidedBy: 'system:stale-sweep',
        });
        swept.push({ ...row, ageDays });
        this.#logger.info?.('school.session.swept', {
          sessionId: row.sessionId, learnerId: row.learnerId, state: row.state, ageDays,
        });
      } catch (error) {
        // One unwritable session must never abort the rest of the sweep.
        skipped.push({ ...row, reason: 'append-failed', error: error?.message ?? String(error) });
        this.#logger.warn?.('school.session.sweep-failed', {
          sessionId: row.sessionId, error: error?.message ?? String(error),
        });
      }
    }

    this.#logger.info?.('school.session.sweep-complete', {
      olderThanDays, dryRun, swept: swept.length, skipped: skipped.length,
    });
    return { swept, skipped, olderThanDays, dryRun };
  }
}

export default MarkSessionAbandoned;
