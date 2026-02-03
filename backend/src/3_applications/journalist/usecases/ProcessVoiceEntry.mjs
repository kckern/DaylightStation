/**
 * Process Voice Entry Use Case
 * @module journalist/application/usecases/ProcessVoiceEntry
 *
 * Processes voice messages by transcribing and delegating to ProcessTextEntry.
 */

import { splitTranscription } from '#domains/journalist/services/MessageSplitter.mjs';

/**
 * @typedef {Object} ProcessVoiceEntryInput
 * @property {string} chatId
 * @property {string} voiceFileId
 * @property {string} messageId
 * @property {string} senderId
 * @property {string} senderName
 */

/**
 * Process voice entry use case
 */
export class ProcessVoiceEntry {
  #messagingGateway;
  #processTextEntry;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.processTextEntry) throw new Error('processTextEntry is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#processTextEntry = deps.processTextEntry;
    this.#logger = deps.logger || console;
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, chatId) {
    if (responseContext) {
      // If responseContext already has transcribeVoice, use it directly
      // Don't spread - it breaks private field access (#adapter)
      if (responseContext.transcribeVoice) {
        return responseContext;
      }
      // Otherwise, wrap with bound methods from gateway
      return {
        sendMessage: (text, options) => responseContext.sendMessage(text, options),
        transcribeVoice: this.#messagingGateway?.transcribeVoice?.bind(this.#messagingGateway),
        createStatusIndicator: responseContext.createStatusIndicator?.bind(responseContext),
      };
    }
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(chatId, text, options),
      transcribeVoice: this.#messagingGateway?.transcribeVoice?.bind(this.#messagingGateway),
    };
  }

  /**
   * Execute the use case
   * @param {ProcessVoiceEntryInput} input
   */
  async execute(input) {
    const { chatId, voiceFileId, messageId, senderId, senderName, responseContext } = input;

    this.#logger.debug?.('voiceEntry.process.start', { chatId, voiceFileId, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, chatId);

    // Create status indicator for transcription phase
    let status = null;
    if (messaging.createStatusIndicator) {
      status = await messaging.createStatusIndicator(
        '🎤 Transcribing',
        { frames: ['.', '..', '...'], interval: 1500 }
      );
    }

    try {
      // 1. Transcribe voice message
      const transcription = await messaging.transcribeVoice(voiceFileId);

      if (!transcription || transcription.trim().length === 0) {
        if (status) {
          await status.finish("🎤 Sorry, I couldn't understand that voice message. Could you try again or type your message?");
        } else {
          await messaging.sendMessage(
            "🎤 Sorry, I couldn't understand that voice message. Could you try again or type your message?",
            {},
          );
        }
        return { success: false, error: 'Empty transcription' };
      }

      // Cancel status indicator before sending transcription
      if (status) {
        await status.cancel();
      }

      // 2. Send transcription confirmation (split if too long for messaging platform)
      const messageParts = splitTranscription(transcription);
      for (let i = 0; i < messageParts.length; i++) {
        await messaging.sendMessage(messageParts[i], {});
        // Small delay between messages to maintain order
        if (i < messageParts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      // 3. Delegate to ProcessTextEntry
      const result = await this.#processTextEntry.execute({
        chatId,
        text: transcription,
        messageId,
        senderId,
        senderName,
        responseContext,
      });

      this.#logger.info?.('voiceEntry.process.complete', {
        chatId,
        transcriptionLength: transcription.length,
      });

      return {
        ...result,
        transcription,
        source: 'voice',
      };
    } catch (error) {
      this.#logger.error?.('voiceEntry.process.error', { chatId, error: error.message });

      // Show error in status indicator if available
      if (status) {
        try {
          await status.finish('⚠️ Sorry, something went wrong processing your voice message. Please try again.');
        } catch (e) {
          // Ignore
        }
      }

      throw error;
    }
  }
}

export default ProcessVoiceEntry;
