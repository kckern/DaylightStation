/**
 * Record Quiz Answer Use Case
 * @module journalist/usecases/RecordQuizAnswer
 *
 * Records a user's answer to a quiz question.
 */

import { QuizAnswer } from '../../../1_domains/journalist/entities/QuizAnswer.mjs';
import { nowDate } from '../../../0_infrastructure/utils/time.mjs';

/**
 * Record quiz answer use case
 */
export class RecordQuizAnswer {
  #quizRepository;
  #messageQueueRepository;
  #logger;

  constructor(deps) {
    // TODO: Make quizRepository required once it's implemented
    // if (!deps.quizRepository) throw new Error('quizRepository is required');

    this.#quizRepository = deps.quizRepository || null;
    this.#messageQueueRepository = deps.messageQueueRepository;
    this.#logger = deps.logger || console;
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

    this.#logger.debug?.('quiz.recordAnswer.start', { chatId, questionUuid });

    // If quizRepository is not available, log warning and skip
    if (!this.#quizRepository) {
      this.#logger.warn?.('quiz.recordAnswer.repository-not-available', { chatId, questionUuid });
      return {
        success: false,
        error: 'Quiz repository not implemented yet',
      };
    }

    try {
      // 1. Create QuizAnswer entity
      const quizAnswer = QuizAnswer.create({
        questionUuid,
        chatId,
        date: date || nowDate(),
        answer,
      });

      // 2. Record in repository
      await this.#quizRepository.recordAnswer(questionUuid, quizAnswer);

      this.#logger.info?.('quiz.recordAnswer.complete', {
        chatId,
        questionUuid,
        answerUuid: quizAnswer.uuid,
      });

      return {
        success: true,
        answerUuid: quizAnswer.uuid,
      };
    } catch (error) {
      this.#logger.error?.('quiz.recordAnswer.error', { chatId, error: error.message });
      throw error;
    }
  }
}

export default RecordQuizAnswer;
