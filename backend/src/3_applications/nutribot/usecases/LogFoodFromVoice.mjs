/**
 * Log Food From Voice Use Case
 * @module nutribot/usecases/LogFoodFromVoice
 *
 * Transcribes voice message and delegates to LogFoodFromText.
 */

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
    this.#logger = deps.logger || console;
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, conversationId) {
    if (responseContext) {
      // If responseContext already has transcribeVoice, use it directly
      // Don't spread - it breaks private field access (#adapter)
      if (responseContext.transcribeVoice) {
        return responseContext;
      }
      // Otherwise, wrap with bound transcribeVoice from gateway
      return {
        sendMessage: (text, options) => responseContext.sendMessage(text, options),
        deleteMessage: (msgId) => responseContext.deleteMessage(msgId),
        transcribeVoice: this.#messagingGateway?.transcribeVoice?.bind(this.#messagingGateway),
      };
    }
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(conversationId, msgId),
      transcribeVoice: this.#messagingGateway?.transcribeVoice?.bind(this.#messagingGateway),
    };
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {Object} input.voiceData - { fileId }
   * @param {string} [input.messageId]
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const { userId, conversationId, voiceData, messageId, responseContext } = input;

    this.#logger.debug?.('logVoice.start', { conversationId, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, conversationId);

    try {
      // 1. Transcribe voice
      let transcription;
      if (messaging.transcribeVoice) {
        transcription = await messaging.transcribeVoice(voiceData.fileId);
      } else {
        await messaging.sendMessage( '🎤 Voice messages are not fully supported yet. Please type what you ate.', {});
        return { success: false, error: 'Voice transcription not available' };
      }

      if (!transcription || transcription.trim().length === 0) {
        await messaging.sendMessage( "❓ I couldn't understand the voice message. Could you type what you ate?", {});
        return { success: false, error: 'Empty transcription' };
      }

      this.#logger.debug?.('logVoice.transcribed', {
        conversationId,
        length: transcription.length,
      });

      // 2. Delegate to LogFoodFromText
      const result = await this.#logFoodFromText.execute({
        userId,
        conversationId,
        text: transcription,
        responseContext,
      });

      // 3. Delete original voice message after analysis appears
      if (messageId && result.success) {
        try {
          await messaging.deleteMessage( messageId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      this.#logger.info?.('logVoice.complete', {
        conversationId,
        success: result.success,
      });

      return result;
    } catch (error) {
      this.#logger.error?.('logVoice.error', { conversationId, error: error.message });

      const isTelegramError = error.message?.includes('Telegram error') || error.code === 'ETIMEDOUT' || error.code === 'EAI_AGAIN' || error.code === 'ECONNRESET';

      try {
        if (isTelegramError) {
          await this.#messagingGateway.sendMessage(
            conversationId,
            `⚠️ Network issue while updating the message. Your food may have been logged.\n\nPlease check your recent entries or try again.\n\n_Error: ${error.message || 'Connection issue'}_`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await this.#messagingGateway.sendMessage(
            conversationId,
            `⚠️ Sorry, I couldn't process your voice message. Please try again or type what you ate.\n\n_Error: ${error.message || 'Connection issue'}_`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (sendError) {
        this.#logger.error?.('logVoice.errorNotification.failed', {
          conversationId,
          originalError: error.message,
          sendError: sendError.message,
        });
      }

      return { success: false, error: error.message };
    }
  }
}

export default LogFoodFromVoice;
