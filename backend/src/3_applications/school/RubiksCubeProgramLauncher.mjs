import { RUBIKS_CUBE_COURSE_ID, RUBIKS_CUBE_REVISION } from './rubiksCube/courseCatalog.mjs';

/** School's small adapter around the cube course service and Portal dispatch. */
export class RubiksCubeProgramLauncher {
  #service; #grants; #donow;
  constructor({ service, grants, donow = null } = {}) { this.#service = service; this.#grants = grants; this.#donow = donow; }
  get id() { return 'rubiks-cube'; }
  get surface() { return 'portal'; }
  get locationHint() { return 'on the Portal'; }
  status({ userId }) { return this.#service.status({ userId }); }
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
