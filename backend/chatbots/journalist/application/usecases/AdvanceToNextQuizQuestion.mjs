/**
 * Advance to Next Quiz Question Use Case
 * @module journalist/application/usecases/AdvanceToNextQuizQuestion
 * 
 * Advances to the next quiz question or transitions to journaling.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Advance to next quiz question use case
 */
export class AdvanceToNextQuizQuestion {
  #messagingGateway;
  #messageQueueRepository;
  #journalEntryRepository;
  #initiateJournalPrompt;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#messageQueueRepository = deps.messageQueueRepository;
    this.#journalEntryRepository = deps.journalEntryRepository;
    this.#initiateJournalPrompt = deps.initiateJournalPrompt;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'journalist' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.chatId
   * @param {string} input.messageId - Current quiz message ID to update/delete
   */
  async execute(input) {
    const { chatId, messageId } = input;

    this.#logger.debug('quiz.advance.start', { chatId, messageId });

    try {
      // 1. Load next item from queue
      let nextItem = null;
      if (this.#messageQueueRepository) {
        const queue = await this.#messageQueueRepository.loadUnsentQueue(chatId);
        nextItem = queue.find(item => item.foreignKey?.quiz && !item.isSent());
      }

      // 2. If next item has quiz foreignKey, update existing message
      if (nextItem && nextItem.foreignKey?.quiz) {
        // Build keyboard (we'd need to load question choices)
        // For now, use a simple approach
        const keyboard = [['Continue'], ['🎲 Change Subject', '❌ Cancel']];

        await this.#messagingGateway.updateMessage(chatId, messageId, {
          text: `📋 ${nextItem.queuedMessage}`,
          choices: keyboard,
        });

        // Mark queue item as sent
        if (this.#messageQueueRepository) {
          await this.#messageQueueRepository.markSent(nextItem.uuid, messageId);
        }

        this.#logger.info('quiz.advance.nextQuestion', { 
          chatId, 
          questionUuid: nextItem.foreignKey.quiz,
        });

        return {
          success: true,
          action: 'next_question',
          questionUuid: nextItem.foreignKey.quiz,
        };
      }

      // 3. No more quiz questions - transition to journal
      // Delete the quiz message
      try {
        await this.#messagingGateway.deleteMessage(chatId, messageId);
      } catch (e) {
        // Ignore delete errors
      }

      // Initiate journal prompt if available
      if (this.#initiateJournalPrompt) {
        const result = await this.#initiateJournalPrompt.execute({ chatId });
        
        this.#logger.info('quiz.advance.transitionToJournal', { chatId });

        return {
          success: true,
          action: 'transition_to_journal',
          journalResult: result,
        };
      }

      this.#logger.info('quiz.advance.complete', { chatId, action: 'quiz_complete' });

      return {
        success: true,
        action: 'quiz_complete',
      };
    } catch (error) {
      this.#logger.error('quiz.advance.error', { chatId, error: error.message });
      throw error;
    }
  }
}

export default AdvanceToNextQuizQuestion;
