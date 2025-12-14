/**
 * Record Quiz Answer Use Case
 * @module journalist/application/usecases/RecordQuizAnswer
 * 
 * Records a user's answer to a quiz question.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';
import { QuizAnswer } from '../../domain/entities/QuizAnswer.mjs';

/**
 * Record quiz answer use case
 */
export class RecordQuizAnswer {
  #quizRepository;
  #messageQueueRepository;
  #logger;

  constructor(deps) {
    if (!deps.quizRepository) throw new Error('quizRepository is required');

    this.#quizRepository = deps.quizRepository;
    this.#messageQueueRepository = deps.messageQueueRepository;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'journalist' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.chatId
   * @param {string} input.questionUuid
   * @param {string|number} input.answer
   * @param {string} [input.date] - Optional date override (defaults to today)
   */
  async execute(input) {
    const { chatId, questionUuid, answer, date } = input;

    this.#logger.debug('quiz.recordAnswer.start', { chatId, questionUuid });

    try {
      // 1. Create QuizAnswer entity
      const quizAnswer = QuizAnswer.create({
        questionUuid,
        chatId,
        date: date || new Date().toISOString().split('T')[0],
        answer,
      });

      // 2. Record in repository
      await this.#quizRepository.recordAnswer(questionUuid, quizAnswer);

      this.#logger.info('quiz.recordAnswer.complete', { 
        chatId, 
        questionUuid,
        answerUuid: quizAnswer.uuid,
      });

      return {
        success: true,
        answerUuid: quizAnswer.uuid,
      };
    } catch (error) {
      this.#logger.error('quiz.recordAnswer.error', { chatId, error: error.message });
      throw error;
    }
  }
}

export default RecordQuizAnswer;
