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

const LABELS = { 'not-started': 'Not started', entry: 'Telling', clarify: 'Telling', questions: 'Questions', answering: 'Questions', completed: 'Done', excused: 'Excused', rejected: 'Needs redoing' };

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
    } catch { return { decision: 'failed', message: 'The debrief is not ready to open.' }; }
  }
}
export default SchoolDebriefProgramLauncher;
