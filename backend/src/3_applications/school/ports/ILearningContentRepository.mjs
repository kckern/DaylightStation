/**
 * Resolves content referenced by a School lesson. Sources may be authored
 * files, generated banks, or another published-content adapter.
 */
export class ILearningContentRepository {
  /** @returns {Promise<object|null>} published lecture-note document */
  async getDocument(documentId) { // eslint-disable-line no-unused-vars
    throw new Error('ILearningContentRepository.getDocument must be implemented');
  }

  /** @returns {Promise<object|null>} raw standard School question bank */
  async getQuestionBank(bankId) { // eslint-disable-line no-unused-vars
    throw new Error('ILearningContentRepository.getQuestionBank must be implemented');
  }

  /** @returns {Promise<object|null>} authored rich flashcard deck */
  async getFlashcardDeck(deckId) { // eslint-disable-line no-unused-vars
    throw new Error('ILearningContentRepository.getFlashcardDeck must be implemented');
  }

  /** @returns {Promise<object|null>} server-side learning-action definition */
  async getLearningAction(actionId) { // eslint-disable-line no-unused-vars
    throw new Error('ILearningContentRepository.getLearningAction must be implemented');
  }
}

export default ILearningContentRepository;
