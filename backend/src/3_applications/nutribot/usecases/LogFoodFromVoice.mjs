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
      // ResponseContext never has transcribeVoice (it's platform-agnostic)
      // We always need the messagingGateway for voice transcription
      return {
        sendMessage: (text, options) => responseContext.sendMessage(text, options),
        deleteMessage: (msgId) => responseContext.deleteMessage(msgId),
        transcribeVoice: (fileId) => this.#messagingGateway.transcribeVoice(fileId),
      };
    }
    // Fallback to gateway directly
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(conversationId, msgId),
      transcribeVoice: (fileId) => this.#messagingGateway.transcribeVoice(fileId),
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
      try {
        transcription = await messaging.transcribeVoice(voiceData.fileId);
      } catch (transcribeError) {
        // Check if transcription service is not configured
        if (transcribeError.code === 'MISSING_CONFIG' || transcribeError.message?.includes('not configured')) {
          await messaging.sendMessage( '🎤 Voice messages are not fully supported yet. Please type what you ate.', {});
          return { success: false, error: 'Voice transcription not available' };
        }
        // Re-throw other errors (network issues, etc.)
        throw transcribeError;
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

      const isTransportError = error.code === 'ETIMEDOUT' ||
        error.code === 'EAI_AGAIN' ||
        error.code === 'ECONNRESET' ||
        error.isTransient === true;

      try {
        const errorMessage = isTransportError
          ? `⚠️ Network issue while updating the message. Your food may have been logged.\n\nPlease check your recent entries or try again.\n\n_Error: ${error.message || 'Connection issue'}_`
          : `⚠️ Sorry, I couldn't process your voice message. Please try again or type what you ate.\n\n_Error: ${error.message || 'Unknown error'}_`;

        await messaging.sendMessage(errorMessage, { parse_mode: 'Markdown' });
      } catch (sendError) {
        this.#logger.error?.('logVoice.errorNotification.failed', {
          conversationId,
          originalError: error.message,
          sendError: sendError.message,
        });
      }

      throw error; // Re-throw instead of returning {success: false}
    }
  }
}

export default LogFoodFromVoice;
