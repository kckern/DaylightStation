// S/application/SchoolDebriefProgramLauncher.mjs
/**
 * The after-school debrief program (spec 2026-10-21-school-debrief-design §3).
 * Story-time shaped: the debrief store is the evidence; one debrief per study
 * day is the obligation; never terminal. Mounts on the Portal panel.
 */
import { studyDayForInstant } from "../domain/studyDay.mjs";
import { scheduleVerdict } from "../domain/schoolCalendar.mjs";
import {
  SCHOOL_DEBRIEF_PROGRAM_ID, SCHOOL_DEBRIEF_UNIT_ID, SCHOOL_DEBRIEF_TITLE, deriveDebriefState, previousStudyDay,
} from "../domain/schoolDebrief.mjs";

const nextDay = (day) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const LABELS = { 'not-started': 'Not started', entry: 'Telling', clarify: 'Telling', questions: 'Questions', answering: 'Questions', completed: 'Done', excused: 'Excused', rejected: 'Talk to a grown-up' };
const HISTORY_OWED_DAYS = 14;
const HISTORY_LOOKBACK_LIMIT = 70; // calendar days searched for the default 14 owed days

export class SchoolDebriefProgramLauncher {
  #debriefs; #assignments; #grants; #householdSchedule; #timezone; #clock; #logger; #donow;
  constructor({ debriefs, assignments, grants = null, householdSchedule = null, timezone = null, clock = () => new Date(), logger = console, donow = null } = {}) {
    if (!debriefs) throw new Error('SchoolDebriefProgramLauncher requires a debriefs store');
    if (!assignments) throw new Error('SchoolDebriefProgramLauncher requires an assignments store');
    this.#debriefs = debriefs; this.#assignments = assignments; this.#grants = grants;
    this.#householdSchedule = householdSchedule; this.#timezone = timezone; this.#clock = clock; this.#logger = logger; this.#donow = donow;
  }
  get id() { return SCHOOL_DEBRIEF_PROGRAM_ID; }
  get locationHint() { return 'on the school screen'; }
  get entryAction() { return null; }
  get surface() { return 'portal'; }
  get replayable() { return true; }
  /** One fact row per owed day in [week.from, week.to] (spec §5). Null when not enrolled. Throws when a day cannot be read. */
  async weekFacts({ learnerId, week, quizPassRatio, substantiveScore }) {
    const enrollment = await this.#enrollment(learnerId);
    if (!enrollment) return null;
    const today = this.studyDay(); const graceDay = previousStudyDay(today);
    const rows = [];
    for (const day of this.#owedBetween(enrollment, week.from, week.to)) {
      const state = await this.#state(learnerId, day);
      if (!state) throw new Error(`debrief day unreadable: ${day}`);
      const quiz = state.summary?.quiz ?? { right: 0, graded: 0 };
      const done = ['completed', 'excused', 'rejected'].includes(state.phase);
      rows.push({
        day, state: done ? state.phase : (day >= graceDay ? 'open' : 'missed'),
        timeliness: state.late ? 'late' : 'on-time',
        substantive: !state.late && state.questioner === 'model' && Number.isInteger(state.substance) && state.substance >= substantiveScore,
        // A fallback day's questions come from the child's own words: no quiz bonus (substantive is already false).
        quiz, quizPassed: state.questioner !== 'fallback' && quiz.graded > 0 && quiz.right / quiz.graded >= quizPassRatio,
      });
    }
    return rows;
  }

  /**
   * Owed study days in [from, to], never past today. With no `from`, the last 14 owed days
   * ending at `to` (default today). [] when not enrolled. Used by the teacher history so a
   * missed day with no file can still be excused.
   */
  async owedDays(learnerId, { from = null, to = null } = {}) {
    const enrollment = await this.#enrollment(learnerId);
    if (!enrollment) return [];
    const today = this.studyDay();
    const end = to && to < today ? to : today;
    if (from) return this.#owedBetween(enrollment, from, end);
    const out = [];
    for (let day = end, n = 0; out.length < HISTORY_OWED_DAYS && n < HISTORY_LOOKBACK_LIMIT; day = previousStudyDay(day), n += 1) {
      if (this.#owed(day, enrollment)) out.unshift(day);
    }
    return out;
  }
  #owedBetween(enrollment, from, to) {
    const out = [];
    for (let day = from; day <= to; day = nextDay(day)) if (this.#owed(day, enrollment)) out.push(day);
    return out;
  }

  studyDay() { return studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone }); }

  async #enrollment(userId) {
    const assignment = await this.#assignments.get(userId);
    if (!assignment) return null;
    return (assignment.programs ?? []).find((p) => p?.programId === SCHOOL_DEBRIEF_PROGRAM_ID) ?? false;
  }
  #owed(day, enrollment) {
    if (!scheduleVerdict(day, enrollment.schedule ?? null).schoolDay) return false;
    if (this.#householdSchedule && !scheduleVerdict(day, this.#householdSchedule).schoolDay) return false;
    return true;
  }
  async #state(userId, day) {
    const { status, events } = await this.#debriefs.read(userId, day);
    if (status === 'unreadable' || status === 'corrupt') return null;
    return deriveDebriefState(events);
  }

  async status({ userId, day: replayDay = null }) {
    const day = replayDay ?? this.studyDay();
    let enrollment;
    try { enrollment = await this.#enrollment(userId); } catch (err) {
      this.#logger.error?.('school.debrief.enrollment-unreadable', { userId, day, error: err.message });
      return this.#unavailable('Debrief assignment unavailable');
    }
    if (enrollment === null) return this.#unavailable('Debrief assignment unavailable');
    if (!enrollment) return { error: false, enrolled: false, doneToday: false, progressLabel: 'No debrief assignment', score: null, terminal: false, obligationProgress: null, servedWork: [] };
    let state;
    try { state = await this.#state(userId, day); } catch (err) { state = null; this.#logger.error?.('school.debrief.store-unreadable', { userId, day, error: err.message }); }
    if (!state) return this.#unavailable('Debrief record unavailable', true);
    const doneToday = state.phase === 'completed' || state.phase === 'excused';
    return {
      error: false, enrolled: true, doneToday, excused: state.phase === 'excused',
      progressLabel: LABELS[state.phase], score: null, terminal: false,
      subject: enrollment.subject, schedule: enrollment.schedule ?? null, state,
      obligationProgress: { completed: doneToday ? 1 : 0, total: 1 },
      servedWork: state.phase === 'completed' ? [{ unitId: SCHOOL_DEBRIEF_UNIT_ID, title: enrollment.title ?? SCHOOL_DEBRIEF_TITLE }] : [],
    };
  }
  #unavailable(progressLabel, enrolled = null) {
    return { error: true, enrolled, doneToday: false, progressLabel, score: null, terminal: false, obligationProgress: null, servedWork: [] };
  }

  /** Yesterday, when it was owed and has no completed/excused debrief. Today's grace window. */
  async lateDayOffered(userId) {
    const enrollment = await this.#enrollment(userId);
    if (!enrollment) return null;
    const yesterday = previousStudyDay(this.studyDay());
    if (!this.#owed(yesterday, enrollment)) return null;
    const state = await this.#state(userId, yesterday);
    if (!state) return null;
    return ['completed', 'excused', 'rejected'].includes(state.phase) ? null : yesterday;
  }
  async writableDays(userId) {
    const late = await this.lateDayOffered(userId);
    return late ? [this.studyDay(), late] : [this.studyDay()];
  }
  async issueLaunchTarget({ userId }) {
    if (!this.#grants) throw new Error('Debrief grants unavailable');
    const days = await this.writableDays(userId);
    return { kind: 'program', program: SCHOOL_DEBRIEF_PROGRAM_ID, learnerId: userId, debriefGrant: this.#grants.issue({ learnerId: userId, days }), today: days[0], lateDay: days[1] ?? null };
  }
  async launch({ userId, unitId = null }) {
    if (!this.#donow) return { decision: 'failed', message: 'The Portal is not available right now.' };
    try {
      const target = await this.issueLaunchTarget({ userId, unitId });
      return await this.#donow.dispatch({ surface: 'portal', action: { target }, learnerId: userId, requestedBy: 'school-program', ref: `${SCHOOL_DEBRIEF_PROGRAM_ID}:daily`, programId: SCHOOL_DEBRIEF_PROGRAM_ID, force: 'never_ask' });
    } catch (err) {
      this.#logger.warn?.('school.debrief.launch-failed', { userId, error: err?.message });
      return { decision: 'failed', message: 'The debrief is not ready to open.' };
    }
  }
}
export default SchoolDebriefProgramLauncher;
