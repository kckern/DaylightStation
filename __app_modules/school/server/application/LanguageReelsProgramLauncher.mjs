/** School launcher for one terminal, standalone Language Reel unit. */
export class LanguageReelsProgramLauncher {
  #service; #grants; #donow;
  constructor({ service, grants, donow = null } = {}) { this.#service = service; this.#grants = grants; this.#donow = donow; }
  get id() { return 'language-reels'; }
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
  async status({ userId, programInstance = null }) {
    const status = await this.#service.status({ userId, reelId: programInstance });
    return {
      ...status,
      // A reel's plan entry is day-scoped (`language-reel-<day>-<reel>`), so the
      // identity here is the REEL — stable wherever it is offered, and never
      // mistakable for the day's entry id.
      servedWork: status?.doneToday ? [{ unitId: `language-reels:${programInstance}`, title: 'Language reel' }] : [],
    };
  }
  issueLaunchTarget({ userId, programInstance, unitId }) {
    const { revision } = this.#service.getReel(programInstance);
    return { kind: 'program', program: 'language-reels', reelId: programInstance, unitId,
      reelGrant: this.#grants.issue({ learnerId: userId, unitId, reelId: programInstance, revision }) };
  }
  async launch({ userId, corpusId = null, programInstance = null, unitId = null }) {
    const reelId = programInstance ?? corpusId;
    if (!this.#donow) return { decision: 'failed', message: 'The Portal is not available right now.' };
    try {
      const target = this.issueLaunchTarget({ userId, programInstance: reelId, unitId });
      return await this.#donow.dispatch({
        surface: 'portal', action: { target }, learnerId: userId,
        requestedBy: 'school-program', ref: `language-reels:${reelId}`,
        programId: 'language-reels', force: 'never_ask',
      });
    } catch {
      return { decision: 'failed', message: 'This reel is not ready to open.' };
    }
  }
}
export default LanguageReelsProgramLauncher;
