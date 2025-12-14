/**
 * Send Quiz Question Use Case
 * @module journalist/application/usecases/SendQuizQuestion
 * 
 * Sends a quiz question with inline buttons for choices.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';
import { MessageQueue } from '../../domain/entities/MessageQueue.mjs';

/**
 * Send quiz question use case
 */
export class SendQuizQuestion {
  #messagingGateway;
  #quizRepository;
  #messageQueueRepository;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.quizRepository) throw new Error('quizRepository is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#quizRepository = deps.quizRepository;
    this.#messageQueueRepository = deps.messageQueueRepository;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'journalist' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.chatId
   * @param {string} [input.category] - Optional category filter
   */
  async execute(input) {
    const { chatId, category } = input;

    this.#logger.debug('quiz.send.start', { chatId, category });

    try {
      // 1. Load questions for category
      const questions = await this.#quizRepository.loadQuestions(category);

      if (questions.length === 0) {
        this.#logger.warn('quiz.send.noQuestions', { chatId, category });
        return { success: false, error: 'No questions available' };
      }

      // 2. Select next unasked question
      const selectedQuestion = this.#selectNextQuestion(questions);

      // 3. Queue remaining questions in category
      if (this.#messageQueueRepository) {
        const remainingQuestions = questions.filter(q => q.uuid !== selectedQuestion.uuid);
        if (remainingQuestions.length > 0) {
          const queueItems = remainingQuestions.slice(0, 4).map((q, index) => 
            MessageQueue.create({
              chatId,
              queuedMessage: q.question,
              foreignKey: { quiz: q.uuid, queueIndex: index + 1 },
            })
          );
          await this.#messageQueueRepository.saveToQueue(chatId, queueItems);
        }
      }

      // 4. Build keyboard with choices
      const keyboard = this.#buildQuizKeyboard(selectedQuestion.choices);

      // 5. Send question with inline buttons
      const { messageId } = await this.#messagingGateway.sendMessage(
        chatId,
        `📋 ${selectedQuestion.question}`,
        {
          choices: keyboard,
          inline: true,
          foreignKey: { quiz: selectedQuestion.uuid },
        }
      );

      // 6. Mark question as asked
      const askedQuestion = selectedQuestion.markAsked();
      await this.#quizRepository.recordAnswer?.(askedQuestion.uuid, null); // Mark as asked

      this.#logger.info('quiz.send.complete', { 
        chatId, 
        questionUuid: selectedQuestion.uuid,
        messageId,
      });

      return {
        success: true,
        messageId,
        questionUuid: selectedQuestion.uuid,
        question: selectedQuestion.question,
      };
    } catch (error) {
      this.#logger.error('quiz.send.error', { chatId, error: error.message });
      throw error;
    }
  }

  /**
   * Build quiz keyboard from choices
   * @private
   */
  #buildQuizKeyboard(choices) {
    // Each choice as separate row for inline keyboard
    return choices.map(choice => [choice]);
  }

  /**
   * Select next question (prefer unasked, then rotate)
   * @private
   */
  #selectNextQuestion(questions) {
    // Prefer unasked questions
    const unasked = questions.filter(q => !q.hasBeenAsked);
    if (unasked.length > 0) {
      return unasked[0];
    }

    // All asked - sort by oldest asked and pick first
    const sorted = [...questions].sort((a, b) => {
      const dateA = a.lastAsked ? new Date(a.lastAsked) : new Date(0);
      const dateB = b.lastAsked ? new Date(b.lastAsked) : new Date(0);
      return dateA - dateB;
    });

    return sorted[0];
  }
}

export default SendQuizQuestion;
