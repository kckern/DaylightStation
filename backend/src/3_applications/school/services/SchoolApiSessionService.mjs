import { EntityNotFoundError } from '#domains/core/errors/EntityNotFoundError.mjs';

/** Coordinates School's legacy, catalog-learning, and flashcard session entry points. */
export class SchoolApiSessionService {
  constructor({ school, flashcards = null, openCatalogLearning = null }) {
    this.school = school;
    this.flashcards = flashcards;
    this.openCatalogLearning = openCatalogLearning;
  }
  async bankHealth() { await this.school.warmBanks(); return this.school.bankHealth(); }
  async listBanks(options) { await this.school.warmBanks(); return this.school.listBanks(options); }
  async listQuizRequests(options) { await this.school.warmBanks(); return this.school.listQuizRequests(options); }
  async open(input) {
    const { userId = null, bankId, mode, learning = null, purpose = null, testPlan = null, fresh = false } = input;
    if (purpose === 'flashcard_assessment') {
      if (!this.flashcards) throw new EntityNotFoundError('flashcard study', 'not configured');
      return this.flashcards.assessment({ userId, deckId: input.deckId, testPlan, learning, open: true });
    }
    if (learning !== null) {
      if (!this.openCatalogLearning) throw new EntityNotFoundError('School Catalog sessions', 'not configured');
      return this.openCatalogLearning.execute({ learnerId: userId, bankId, mode, learning, purpose, testPlan, fresh: fresh === true });
    }
    return this.school.openSession({ userId, bankId, mode, fresh: fresh === true });
  }
}

export default SchoolApiSessionService;
