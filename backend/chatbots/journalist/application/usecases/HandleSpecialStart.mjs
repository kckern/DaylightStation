/**
 * Handle Special Start Use Case
 * @module journalist/application/usecases/HandleSpecialStart
 * 
 * Handles special start commands like 🎲 (roll) and ❌ (cancel).
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Handle special start use case
 */
export class HandleSpecialStart {
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
   * @param {string} input.messageId
   * @param {string} input.text - The special start text (🎲 or ❌)
   */
  async execute(input) {
    const { chatId, messageId, text } = input;

    this.#logger.debug('specialStart.handle.start', { chatId, text });

    try {
      // 1. Delete unprocessed queue
      if (this.#messageQueueRepository) {
        await this.#messageQueueRepository.deleteUnprocessed(chatId);
      }

      // 2. Delete user's special start message
      try {
        await this.#messagingGateway.deleteMessage(chatId, messageId);
      } catch (e) {
        // Ignore delete errors - message may already be gone
      }

      // 3. Delete recent bot messages (within 1 minute)
      await this.#deleteRecentBotMessages(chatId);

      // 4. Determine action based on text
      const isRoll = text.includes('🎲') || text.toLowerCase().includes('change');
      const isCancel = text.includes('❌') || text.toLowerCase().includes('cancel');

      if (isRoll) {
        // Roll - initiate new topic
        if (this.#initiateJournalPrompt) {
          const result = await this.#initiateJournalPrompt.execute({ 
            chatId, 
            instructions: 'change_subject',
          });

          this.#logger.info('specialStart.handle.roll', { chatId });

          return {
            success: true,
            action: 'roll',
            promptResult: result,
          };
        }
      }

      if (isCancel) {
        // Cancel - just clear state, no new prompt
        this.#logger.info('specialStart.handle.cancel', { chatId });

        return {
          success: true,
          action: 'cancel',
        };
      }

      // Unknown special start - treat as cancel
      this.#logger.info('specialStart.handle.unknown', { chatId, text });

      return {
        success: true,
        action: 'unknown',
      };
    } catch (error) {
      this.#logger.error('specialStart.handle.error', { chatId, error: error.message });
      throw error;
    }
  }

  /**
   * Delete recent bot messages
   * @private
   */
  async #deleteRecentBotMessages(chatId) {
    if (!this.#journalEntryRepository?.getRecentBotMessages) {
      return;
    }

    try {
      const recentMessages = await this.#journalEntryRepository.getRecentBotMessages(chatId, 1);
      
      for (const msg of recentMessages) {
        // Check if within 1 minute
        const msgTime = new Date(msg.timestamp).getTime();
        const now = Date.now();
        const oneMinute = 60 * 1000;

        if (now - msgTime < oneMinute) {
          try {
            await this.#messagingGateway.deleteMessage(chatId, msg.messageId);
          } catch (e) {
            // Ignore individual delete errors
          }
        }
      }
    } catch (e) {
      // Ignore errors in cleanup
    }
  }

  /**
   * Check if text is a special start
   * @static
   */
  static isSpecialStart(text) {
    if (!text) return false;
    const trimmed = text.trim();
    
    // Check for emoji patterns
    if (trimmed.includes('🎲') || trimmed.includes('❌')) {
      return true;
    }

    // Check for text patterns
    const lowerText = trimmed.toLowerCase();
    return lowerText === 'change subject' || 
           lowerText === 'cancel' ||
           lowerText === 'roll';
  }
}

export default HandleSpecialStart;
