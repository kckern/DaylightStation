/**
 * GetTeacherToday — the household teacher's one-glance digest: per roster
 * learner, what happened TODAY and what is waiting on a grown-up's mark.
 *
 * "Today" is the same 4am study-day boundary the rest of School uses
 * (`#domains/school/studyDay.mjs`'s `offsetMinutesFor` + boundary-hour
 * arithmetic), not the plain UTC calendar date — a session opened at 11pm
 * still belongs to "today" until the boundary rolls, exactly as
 * `isSameStudyDay`/`agenda.mjs` already treat it everywhere else.
 *
 * The boundary is a WINDOW of real instants, `[startAtMs, endAtMs)`, not a
 * single calendar-date string. `readAttemptDay`/session rows are bucketed by
 * the RAW UTC date of `at`/`created` (`YamlSchoolDatastore`/
 * `YamlWorkSessionDatastore`'s own on-disk sharding), which does NOT line up
 * with the boundary-shifted date around 4am: comparing a plain date string
 * either misses attempts filed under tomorrow's raw date that are still
 * "today" study-day-wise (e.g. 03:15Z, queried at 03:30Z, before the 4am
 * roll), or wrongly counts attempts filed under today's raw date that
 * actually belong to YESTERDAY's study day (e.g. 02:00Z, queried at 04:30Z,
 * after the roll). The fix: compute the window as instants, read every raw
 * calendar-date day-file the window can touch (at most two, since the window
 * is exactly 24h), and filter every attempt/session by its OWN timestamp
 * against the window — never by a precomputed date-string match.
 */
import { studyDayWindow, withinStudyWindow as withinWindow } from '#domains/school/studyDay.mjs';

const DEFAULT_BOUNDARY_HOUR = 4;

/** Every raw calendar date (`YYYY-MM-DD`) the window can touch — one or two. */
function daysTouchedBy({ startAtMs, endAtMs }) {
  const fromDay = new Date(startAtMs).toISOString().slice(0, 10);
  const toDay = new Date(endAtMs - 1).toISOString().slice(0, 10);
  return fromDay === toDay ? [fromDay] : [fromDay, toDay];
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
    const window = studyDayWindow(this.#clock().getTime(), {
      timezone: this.#timezone, boundaryHour: this.#boundaryHour,
    });
    const days = daysTouchedBy(window);
    const learners = await this.#learnerDirectory.listLearners();
    const pending = this.#reviewQueue ? await this.#reviewQueue.listPending() : [];

    const results = [];
    for (const learner of learners) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await this.#sessions.listForLearner(learner.id);
      // Read every raw-date file the window can touch, THEN filter by each
      // attempt's own timestamp — the day file a row lands in and the study
      // day it belongs to are not the same thing around the 4am boundary.
      const attemptsToday = days
        .flatMap((day) => this.#datastore.readAttemptDay(learner.id, day) ?? [])
        .filter((a) => withinWindow(a.at, window));
      results.push({
        learnerId: learner.id,
        attemptsToday: attemptsToday.length,
        correctToday: attemptsToday.filter((a) => a.correct === true).length,
        sessionsToday: rows
          .filter((row) => withinWindow(row.updatedAt, window))
          .map((row) => ({ unitId: row.unitId ?? null, state: row.state ?? null })),
        pendingReview: pending.filter((item) => item.learnerId === learner.id).length,
      });
    }
    this.#logger.debug?.('school.teacher-today.built', { days, learners: results.length });
    return results;
  }
}

export default GetTeacherToday;
