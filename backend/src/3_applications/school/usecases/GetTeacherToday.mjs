/**
 * GetTeacherToday — the household teacher's one-glance digest: per roster
 * learner, what happened TODAY and what is waiting on a grown-up's mark.
 *
 * "Today" is the same 4am study-day boundary the rest of School uses
 * (`#domains/school/studyDay.mjs`'s `offsetMinutesFor` + boundary-hour
 * arithmetic), not the plain UTC calendar date — a session opened at 11pm
 * still belongs to "today" until the boundary rolls, exactly as
 * `isSameStudyDay`/`agenda.mjs` already treat it everywhere else.
 */
import { offsetMinutesFor } from '#domains/school/studyDay.mjs';

const DEFAULT_BOUNDARY_HOUR = 4;

/** The calendar date (YYYY-MM-DD) of the current study day, boundary-shifted. */
function todayStudyDay(nowMs, { timezone = null, boundaryHour = DEFAULT_BOUNDARY_HOUR } = {}) {
  const offsetMinutes = offsetMinutesFor(timezone, nowMs);
  const shifted = new Date(nowMs + offsetMinutes * 60_000 - boundaryHour * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

export class GetTeacherToday {
  #learnerDirectory; #datastore; #sessions; #reviewQueue; #timezone; #boundaryHour; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('../ports/ISchoolCohortDirectory.mjs').ISchoolCohortDirectory} deps.learnerDirectory
   * @param {object} deps.datastore - `YamlSchoolDatastore`-shaped: `readAttemptDay`
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('../ports/IReviewQueue.mjs').IReviewQueue|null} [deps.reviewQueue]
   * @param {string|null} [deps.timezone] - IANA zone; null = UTC boundary
   * @param {number} [deps.boundaryHour]
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    learnerDirectory, datastore, sessions, reviewQueue = null,
    timezone = null, boundaryHour = DEFAULT_BOUNDARY_HOUR, clock = () => new Date(), logger = console,
  } = {}) {
    if (!learnerDirectory) throw new Error('GetTeacherToday requires learnerDirectory');
    if (!datastore) throw new Error('GetTeacherToday requires datastore');
    if (!sessions) throw new Error('GetTeacherToday requires sessions');
    this.#learnerDirectory = learnerDirectory;
    this.#datastore = datastore;
    this.#sessions = sessions;
    this.#reviewQueue = reviewQueue;
    this.#timezone = timezone;
    this.#boundaryHour = boundaryHour;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @returns {Promise<Array<{learnerId: string, attemptsToday: number,
   *   correctToday: number, sessionsToday: Array<{unitId: string|null, state: string|null}>,
   *   pendingReview: number}>>}
   */
  async execute() {
    const today = todayStudyDay(this.#clock().getTime(), {
      timezone: this.#timezone, boundaryHour: this.#boundaryHour,
    });
    const learners = await this.#learnerDirectory.listLearners();
    const pending = this.#reviewQueue ? await this.#reviewQueue.listPending() : [];

    const results = [];
    for (const learner of learners) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await this.#sessions.listForLearner(learner.id);
      const attemptsToday = this.#datastore.readAttemptDay(learner.id, today) ?? [];
      results.push({
        learnerId: learner.id,
        attemptsToday: attemptsToday.length,
        correctToday: attemptsToday.filter((a) => a.correct === true).length,
        sessionsToday: rows
          .filter((row) => row.day === today)
          .map((row) => ({ unitId: row.unitId ?? null, state: row.state ?? null })),
        pendingReview: pending.filter((item) => item.learnerId === learner.id).length,
      });
    }
    this.#logger.debug?.('school.teacher-today.built', { today, learners: results.length });
    return results;
  }
}

export default GetTeacherToday;
