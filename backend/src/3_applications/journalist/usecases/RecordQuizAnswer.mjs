/**
 * Record Quiz Answer Use Case
 * @module journalist/usecases/RecordQuizAnswer
 *
 * Records a user's answer to a quiz question.
 */

import { QuizAnswer } from '#domains/journalist/entities/QuizAnswer.mjs';
import { nowDate, nowTs24 } from '#system/utils/time.mjs';

/**
 * Record quiz answer use case
 */
export class RecordQuizAnswer {
  #quizRepository;
  #messageQueueRepository;
  #logger;

  constructor(deps) {
    // quizRepository is optional - gracefully degrades if not available
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

    // If quizRepository is not available, log and return success (graceful degradation)
    if (!this.#quizRepository) {
      this.#logger.debug?.('quiz.recordAnswer.repository-not-available', { chatId, questionUuid });
      return {
        success: true,
        skipped: true,
        reason: 'quizRepository not configured',
      };
    }

    try {
      // 1. Create QuizAnswer entity
      const quizAnswer = QuizAnswer.create({
        questionUuid,
        chatId,
        date: date || nowDate(),
        answer,
        answeredAt: nowTs24(),
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
