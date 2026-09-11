import { RUBIKS_CUBE_COURSE_ID, RUBIKS_CUBE_REVISION } from './rubiksCube/courseCatalog.mjs';

/** School's small adapter around the cube course service and Portal dispatch. */
export class RubiksCubeProgramLauncher {
  #service; #grants; #donow;
  constructor({ service, grants, donow = null } = {}) { this.#service = service; this.#grants = grants; this.#donow = donow; }
  get id() { return 'rubiks-cube'; }
  get surface() { return 'portal'; }
  get locationHint() { return 'on the Portal'; }
  /**
   * WHY A LAUNCHER REPORTS ITS SERVED WORK. `AgendaStatusBoard` draws one disc
   * per assignment from PLAN ∪ EVIDENCE, and a finished program is in neither
   * set: the agenda stops offering it (`next` goes null) the moment it reports
   * `doneToday`, and `BuildAgenda` never opens a work session for a program
   * entry, so the evidence side has nothing either. Without a `servedWork` row
   * the disc does not turn green when a child finishes — it disappears. Same
   * durable-identity fix `StoryTimeProgramLauncher` already carries.
   *
   * The row names the WORK only; `planDailyAgenda` stamps `assignmentUnitId`
   * onto it from the program entry that owns this program.
   */
  async status({ userId }) {
    const status = await this.#service.status({ userId });
    return {
      ...status,
      // The COURSE, not the activity finished today: one cube assignment is one
      // disc, and the course id is the identity it keeps tomorrow.
      servedWork: status?.doneToday
        ? [{ unitId: `rubiks-cube:${RUBIKS_CUBE_COURSE_ID}`, title: "Rubik's cube" }]
        : [],
    };
  }
  issueLaunchTarget({ userId, unitId }) {
    return { kind: 'program', program: 'rubiks-cube', courseId: RUBIKS_CUBE_COURSE_ID, unitId,
      cubeGrant: this.#grants.issue({ learnerId: userId, unitId: unitId || 'rubiks-cube', courseId: RUBIKS_CUBE_COURSE_ID, revision: RUBIKS_CUBE_REVISION }) };
  }
  async launch({ userId, unitId = null }) {
    if (!this.#donow) return { decision: 'failed', message: 'The Portal is not available right now.' };
    return this.#donow.dispatch({ surface: 'portal', action: { target: this.issueLaunchTarget({ userId, unitId }) }, learnerId: userId,
      requestedBy: 'school-program', ref: 'rubiks-cube:beginner-v1', programId: this.id, force: 'never_ask' });
  }
}
export default RubiksCubeProgramLauncher;
