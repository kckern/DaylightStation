/**
 * Log Food From Voice Use Case
 * @module nutribot/application/usecases/LogFoodFromVoice
 * 
 * Transcribes voice message and delegates to LogFoodFromText.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';

/**
 * Log food from voice use case
 */
export class LogFoodFromVoice {
  #messagingGateway;
  #logFoodFromText;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.logFoodFromText) throw new Error('logFoodFromText is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#logFoodFromText = deps.logFoodFromText;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {Object} input.voiceData - { fileId }
   * @param {string} [input.messageId]
   */
  async execute(input) {
    const { userId, conversationId, voiceData, messageId } = input;

    this.#logger.debug('logVoice.start', { conversationId });

    try {
      // 1. Transcribe voice
      let transcription;
      if (this.#messagingGateway.transcribeVoice) {
        transcription = await this.#messagingGateway.transcribeVoice(voiceData.fileId);
      } else {
        // Fallback: send a message asking for text
        await this.#messagingGateway.sendMessage(
          conversationId,
          '🎤 Voice messages are not fully supported yet. Please type what you ate.',
          {}
        );
        return { success: false, error: 'Voice transcription not available' };
      }

      if (!transcription || transcription.trim().length === 0) {
        await this.#messagingGateway.sendMessage(
          conversationId,
          '❓ I couldn\'t understand the voice message. Could you type what you ate?',
          {}
        );
        return { success: false, error: 'Empty transcription' };
      }

      this.#logger.debug('logVoice.transcribed', { 
        conversationId, 
        length: transcription.length,
      });

      // 2. Delegate to LogFoodFromText
      const result = await this.#logFoodFromText.execute({
        userId,
        conversationId,
        text: transcription,
        // Don't pass messageId - we'll delete after success
      });

      // 3. Delete original voice message after analysis appears
      if (messageId && result.success) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      this.#logger.info('logVoice.complete', { 
        conversationId, 
        success: result.success,
      });

      return result;
    } catch (error) {
      this.#logger.error('logVoice.error', { conversationId, error: error.message });
      
      // Send a user-friendly error message instead of failing silently
      try {
        await this.#messagingGateway.sendMessage(
          conversationId,
          `⚠️ Sorry, I couldn't process your voice message. Please try again or type what you ate.\n\n_Error: ${error.message || 'Connection issue'}_`,
          { parse_mode: 'Markdown' }
        );
      } catch (sendError) {
        // If we can't even send an error message, log it
        this.#logger.error('logVoice.errorNotification.failed', { 
          conversationId, 
          originalError: error.message,
          sendError: sendError.message 
        });
      }
      
      return { success: false, error: error.message };
    }
  }
}

export default LogFoodFromVoice;
