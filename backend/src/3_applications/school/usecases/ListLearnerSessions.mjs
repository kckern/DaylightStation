/**
 * ListLearnerSessions — a learner's work sessions, optionally filtered to
 * the current 4am→4am study day (`window: 'today'`).
 *
 * A use case rather than a router closure because the filter needs a clock
 * and the household timezone — the lifecycle router's own doctrine is "no
 * clock in the shell; every time rule lives in the use case that owns it".
 * The window math is `#domains/school/studyDay.mjs`'s `studyDayWindow`, the
 * SAME function `GetTeacherToday` buckets by, and the filter field is the
 * same `updatedAt` (falling back to `created` for a session never touched
 * since open) — so the teacher console's drill-in can never disagree with
 * the digest card that opened it.
 *
 * An unknown `window` value returns everything rather than nothing: a typo'd
 * query must degrade to "unfiltered", never to an empty lie.
 */
import { studyDayWindow, withinStudyWindow } from '#domains/school/studyDay.mjs';

export class ListLearnerSessions {
  #sessions; #timezone; #boundaryHour; #clock;

  /**
   * @param {object} deps
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {string|null} [deps.timezone] - IANA zone; null = UTC boundary
   * @param {number} [deps.boundaryHour]
   * @param {() => Date} [deps.clock]
   */
  constructor({ sessions, timezone = null, boundaryHour = 4, clock = () => new Date() } = {}) {
    if (!sessions) throw new Error('ListLearnerSessions requires sessions');
    this.#sessions = sessions;
    this.#timezone = timezone;
    this.#boundaryHour = boundaryHour;
    this.#clock = clock;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {string|null} [args.window] - 'today' filters to the study day
   * @returns {Promise<Array<object>>}
   */
  async execute({ learnerId, window = null } = {}) {
    const rows = await this.#sessions.listForLearner(learnerId);
    if (window !== 'today') return rows;
    const w = studyDayWindow(this.#clock().getTime(), {
      timezone: this.#timezone,
      boundaryHour: this.#boundaryHour,
    });
    return rows.filter((s) => withinStudyWindow(s?.updatedAt ?? s?.created, w));
  }
}
