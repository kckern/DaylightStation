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
import { collectProgramStatuses } from './programStatusCollection.mjs';
import { studyDayWindow } from '#domains/school/studyDay.mjs';

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
    const { sections } = planDailyAgenda({
      plan, sessions: history, programStatuses, now: nowIso, timezone: this.#timezone, logger: this.#logger,
    });
    const { state, excused, faults } = resolveDayCompletion({ sections, planErrors: plan.errors });
    const { startAtMs } = studyDayWindow(Date.parse(nowIso), { timezone: this.#timezone });
    const studyDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.#timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(startAtMs));
    return { learnerId, studyDate, state, excused, faults };
  }

  /** Mirrors `BuildAgenda#collectProgramStatuses` exactly: one read-only
   * `status()` per distinct program instance, degrading to `{ error: true }` on
   * any failure so a broken launcher never blanks the whole read. */
  async #collectProgramStatuses(plan, learnerId) {
    return collectProgramStatuses({
      plan, learnerId, launchers: this.#launchers, logger: this.#logger,
      logEvent: 'school.completion.launcher-failed',
    });
  }
}

export default GetLearnerDayCompletion;
