/** School launcher for one terminal, standalone Language Reel unit. */
export class LanguageReelsProgramLauncher {
  #service; #grants; #donow;
  constructor({ service, grants, donow = null } = {}) { this.#service = service; this.#grants = grants; this.#donow = donow; }
  get id() { return 'language-reels'; }
  get surface() { return 'portal'; }
  get locationHint() { return 'on the Portal'; }
  async status({ userId, programInstance = null }) { return this.#service.status({ userId, reelId: programInstance }); }
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
