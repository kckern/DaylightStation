/**
 * Handle Quiz Answer Use Case
 * @module journalist/application/usecases/HandleQuizAnswer
 * 
 * Coordinates recording a quiz answer and advancing to next question.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';

/**
 * Handle quiz answer use case
 */
export class HandleQuizAnswer {
  #recordQuizAnswer;
  #advanceToNextQuizQuestion;
  #messageQueueRepository;
  #logger;

  constructor(deps) {
    if (!deps.recordQuizAnswer) throw new Error('recordQuizAnswer is required');
    if (!deps.advanceToNextQuizQuestion) throw new Error('advanceToNextQuizQuestion is required');

    this.#recordQuizAnswer = deps.recordQuizAnswer;
    this.#advanceToNextQuizQuestion = deps.advanceToNextQuizQuestion;
    this.#messageQueueRepository = deps.messageQueueRepository;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'journalist' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.chatId
   * @param {string} input.messageId
   * @param {string} input.questionUuid
   * @param {string|number} input.answer
   * @param {string} [input.queueUuid] - Optional queue item UUID
   */
  async execute(input) {
    const { chatId, messageId, questionUuid, answer, queueUuid } = input;

    this.#logger.debug('quiz.handleAnswer.start', { chatId, questionUuid });

    try {
      // 1. Mark queue item as sent (if queueUuid provided)
      if (queueUuid && this.#messageQueueRepository) {
        await this.#messageQueueRepository.markSent(queueUuid, messageId);
      }

      // 2. Record quiz answer
      const recordResult = await this.#recordQuizAnswer.execute({
        chatId,
        questionUuid,
        answer,
      });

      // 3. Advance to next question
      const advanceResult = await this.#advanceToNextQuizQuestion.execute({
        chatId,
        messageId,
      });

      this.#logger.info('quiz.handleAnswer.complete', { 
        chatId, 
        questionUuid,
        action: advanceResult.action,
      });

      return {
        success: true,
        answerUuid: recordResult.answerUuid,
        nextAction: advanceResult.action,
        advanceResult,
      };
    } catch (error) {
      this.#logger.error('quiz.handleAnswer.error', { chatId, error: error.message });
      throw error;
    }
  }
}

export default HandleQuizAnswer;
