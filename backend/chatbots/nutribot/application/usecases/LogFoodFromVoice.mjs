/**
 * Log Food From Voice Use Case
 * @module nutribot/application/usecases/LogFoodFromVoice
 * 
 * Transcribes voice message and delegates to LogFoodFromText.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

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
      // 1. Delete original voice message
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      // 2. Transcribe voice
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

      // 3. Delegate to LogFoodFromText
      const result = await this.#logFoodFromText.execute({
        userId,
        conversationId,
        text: transcription,
        // Don't pass messageId - already deleted
      });

      this.#logger.info('logVoice.complete', { 
        conversationId, 
        success: result.success,
      });

      return result;
    } catch (error) {
      this.#logger.error('logVoice.error', { conversationId, error: error.message });
      throw error;
    }
  }
}

export default LogFoodFromVoice;
