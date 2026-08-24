/**
 * GetLearnerDayCompletion — the read-only twin of `BuildAgenda`'s planning
 * path (design: 2026-08-23-student-completion-state-machine). Reuses the
 * exact same assignment/units/session/program-status reads and the exact
 * same `planLearnerWork` -> `planDailyAgenda` sequence, but stops there:
 * no session is created, no token is minted, no document is built. A status
 * read must never carry `BuildAgenda`'s paper-issuing side effects, because
 * it is read far more often than paper is printed.
 */
import { planLearnerWork } from '#domains/school/planner.mjs';
import { planDailyAgenda } from '#domains/school/agenda.mjs';
import { resolveDayCompletion } from '#domains/school/completion.mjs';

export class GetLearnerDayCompletion {
  #curriculum; #assignments; #sessions; #launchers; #timezone; #clock; #logger;

  constructor({
    curriculum, assignments, sessions, launchers = new Map(),
    timezone = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!curriculum || !assignments || !sessions) {
      throw new Error('GetLearnerDayCompletion requires curriculum, assignments and sessions');
    }
    this.#curriculum = curriculum;
    this.#assignments = assignments;
    this.#sessions = sessions;
    this.#launchers = launchers;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @returns {Promise<{ learnerId: string, state: 'incomplete'|'complete'|'no_work_today',
   *                      excused: Array<{subject: string|null, reason: string}> }>}
   */
  async execute({ learnerId } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      throw new Error('GetLearnerDayCompletion requires learnerId');
    }
    const nowIso = this.#clock().toISOString();
    const [assignment, units, works, history] = await Promise.all([
      this.#assignments.get(learnerId),
      this.#curriculum.listUnits(),
      this.#curriculum.listWorks?.() ?? [],
      this.#sessions.listForLearner(learnerId),
    ]);
    const coursePolicies = Object.fromEntries((works ?? []).map((work) => [work.work, work.progression]).filter(([, p]) => p));
    const plan = planLearnerWork({ learnerId, assignment, units, sessions: history, now: nowIso, timezone: this.#timezone, coursePolicies });
    const programStatuses = await this.#collectProgramStatuses(plan, learnerId);
    const { sections } = planDailyAgenda({ plan, sessions: history, programStatuses, now: nowIso, timezone: this.#timezone });
    const { state, excused } = resolveDayCompletion({ sections, planErrors: plan.errors });
    return { learnerId, state, excused };
  }

  /** Mirrors `BuildAgenda#collectProgramStatuses` exactly: one read-only
   * `status()` per distinct program id, degrading to `{ error: true }` on
   * any failure so a broken launcher never blanks the whole read. */
  async #collectProgramStatuses(plan, learnerId) {
    const programIds = [...new Set((plan.entries ?? []).filter((e) => e.program).map((e) => e.program))];
    const statuses = {};
    await Promise.all(programIds.map(async (programId) => {
      try {
        const launcher = this.#launchers.get(programId);
        if (!launcher) throw new Error(`no launcher registered for program "${programId}"`);
        statuses[programId] = await launcher.status({ userId: learnerId });
      } catch (err) {
        this.#logger.warn?.('school.completion.launcher-failed', {
          learnerId, program: programId, error: err?.message ?? String(err),
        });
        statuses[programId] = { error: true };
      }
    }));
    return statuses;
  }
}

export default GetLearnerDayCompletion;
