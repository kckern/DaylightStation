/** Portal lifecycle adapter for a standalone assigned flashcard deck. */
export class FlashcardProgramLauncher {
  #study; #assignments; #donow;
  constructor({ studyService, assignments, donow = null } = {}) {
    if (!studyService || !assignments) throw new Error('FlashcardProgramLauncher requires studyService and assignments');
    this.#study = studyService; this.#assignments = assignments; this.#donow = donow;
  }
  get id() { return 'flashcards'; }
  get surface() { return 'portal'; }
  get locationHint() { return 'on the Portal'; }
  async #enrollment(userId, deckId) {
    const assignment = await this.#assignments.get(userId);
    return (assignment?.programs ?? []).find((row) => row?.programId === 'flashcards' && (row.deckId ?? row.corpusId) === deckId) ?? null;
  }
  async status({ userId, programInstance = null }) {
    if (!programInstance) return { doneToday: false, progressLabel: 'Choose a flashcard deck', score: null };
    const [summary, enrollment] = await Promise.all([
      this.#study.summary({ userId, deckId: programInstance }), this.#enrollment(userId, programInstance),
    ]);
    const policy = enrollment?.policy ?? {};
    const assessment = await this.#study.assessmentStatus?.({ userId, deckId: programInstance, policy }) ?? { passed: policy.quizRequired !== true };
    const today = summary.today ?? summary.counts;
    const total = summary.counts.new + summary.counts.learning + summary.counts.mastered;
    const mastery = total ? Math.round((summary.counts.mastered / total) * 100) : 0;
    const requirements = [
      policy.activeMinutes === undefined || today.activeSeconds >= policy.activeMinutes * 60,
      policy.minimumReviews === undefined || today.reviewed >= policy.minimumReviews,
      policy.masteryPercent === undefined || mastery >= policy.masteryPercent,
      policy.quizRequired !== true || assessment.passed === true,
    ];
    const doneToday = requirements.every(Boolean) && (summary.counts.due === 0 || policy.minimumReviews !== undefined);
    return { doneToday, progressLabel: `${summary.counts.due} due · ${mastery}% mastered${assessment.required ? ` · test ${assessment.passed ? 'passed' : 'needed'}` : ''}`, score: mastery, summary, assessment };
  }
  async issueLaunchTarget({ userId, programInstance, unitId }) {
    if (!userId || !programInstance) throw new Error('Flashcard launch requires learner and deck');
    const enrollment = await this.#enrollment(userId, programInstance);
    return { kind: 'program', program: 'flashcards', deckId: programInstance, unitId, policy: enrollment?.policy ?? {} };
  }
  async launch({ userId, corpusId = null, programInstance = null, unitId = null }) {
    const deckId = programInstance ?? corpusId;
    if (!this.#donow) return { decision: 'failed', message: 'The Portal is not available right now.' };
    try {
      await this.#study.getDeck(deckId);
      const target = await this.issueLaunchTarget({ userId, programInstance: deckId, unitId });
      return await this.#donow.dispatch({
        surface: 'portal', action: { target }, learnerId: userId,
        requestedBy: 'school-program', ref: `flashcards:${deckId}`,
        programId: 'flashcards', force: 'never_ask',
      });
    } catch { return { decision: 'failed', message: 'This flashcard deck is not ready to open.' }; }
  }
}
export default FlashcardProgramLauncher;
