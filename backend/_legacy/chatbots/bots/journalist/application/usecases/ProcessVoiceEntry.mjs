/**
 * Process Voice Entry Use Case
 * @module journalist/application/usecases/ProcessVoiceEntry
 * 
 * Processes voice messages by transcribing and delegating to ProcessTextEntry.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { splitTranscription } from '../../domain/services/MessageSplitter.mjs';

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
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'journalist' });
  }

  /**
   * Execute the use case
   * @param {ProcessVoiceEntryInput} input
   */
  async execute(input) {
    const { chatId, voiceFileId, messageId, senderId, senderName } = input;

    this.#logger.debug('voiceEntry.process.start', { chatId, voiceFileId });

    try {
      // 1. Transcribe voice message
      const transcription = await this.#messagingGateway.transcribeVoice(voiceFileId);

      if (!transcription || transcription.trim().length === 0) {
        await this.#messagingGateway.sendMessage(
          chatId,
          '🎤 Sorry, I couldn\'t understand that voice message. Could you try again or type your message?',
          {}
        );
        return { success: false, error: 'Empty transcription' };
      }

      // 2. Send transcription confirmation (split if too long for Telegram)
      const messageParts = splitTranscription(transcription);
      for (let i = 0; i < messageParts.length; i++) {
        await this.#messagingGateway.sendMessage(chatId, messageParts[i], {});
        // Small delay between messages to maintain order
        if (i < messageParts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // 3. Delegate to ProcessTextEntry
      const result = await this.#processTextEntry.execute({
        chatId,
        text: transcription,
        messageId,
        senderId,
        senderName,
      });

      this.#logger.info('voiceEntry.process.complete', { chatId, transcriptionLength: transcription.length });

      return {
        ...result,
        transcription,
        source: 'voice',
      };
    } catch (error) {
      this.#logger.error('voiceEntry.process.error', { chatId, error: error.message });
      throw error;
    }
  }
}

export default ProcessVoiceEntry;
