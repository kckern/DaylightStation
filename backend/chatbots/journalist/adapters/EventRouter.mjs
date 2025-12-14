/**
 * Journalist Event Router
 * @module journalist/adapters/EventRouter
 * 
 * Routes webhook events to appropriate use cases.
 */

import { createLogger } from '../../_lib/logging/index.mjs';
import { HandleSpecialStart } from '../application/usecases/HandleSpecialStart.mjs';

/**
 * Journalist Event Router
 */
export class JournalistEventRouter {
  #container;
  #logger;

  /**
   * @param {import('../container.mjs').JournalistContainer} container
   */
  constructor(container) {
    if (!container) throw new Error('container is required');
    this.#container = container;
    this.#logger = createLogger({ source: 'router', app: 'journalist' });
  }

  /**
   * Route webhook event to appropriate handler
   * @param {Object} event - Telegram webhook event
   */
  async route(event) {
    const { message, callback_query, edited_message } = event;

    try {
      if (message) {
        return this.#routeMessage(message);
      }

      if (callback_query) {
        return this.#routeCallback(callback_query);
      }

      if (edited_message) {
        // Ignore edited messages for now
        this.#logger.debug('router.ignoredEdit', { messageId: edited_message.message_id });
        return;
      }

      this.#logger.warn('router.unknownEvent', { keys: Object.keys(event) });
    } catch (error) {
      this.#logger.error('router.error', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Route message events
   * @private
   */
  async #routeMessage(message) {
    const chatId = String(message.chat.id);
    const messageId = String(message.message_id);
    const from = message.from || {};

    // Voice message
    if (message.voice) {
      return this.#handleVoice(chatId, message.voice, messageId, from);
    }

    // Text message
    if (message.text) {
      const text = message.text.trim();
      return this.#handleText(chatId, text, messageId, from);
    }

    this.#logger.debug('router.unhandledMessage', { chatId, type: this.#getMessageType(message) });
  }

  /**
   * Route callback query events
   * @private
   */
  async #routeCallback(callbackQuery) {
    const chatId = String(callbackQuery.message?.chat?.id);
    const messageId = String(callbackQuery.message?.message_id);
    const data = callbackQuery.data;
    const message = callbackQuery.message;
    const from = callbackQuery.from || {};

    if (!chatId || !data) {
      this.#logger.warn('router.invalidCallback', { hasChat: !!chatId, hasData: !!data });
      return;
    }

    return this.#handleCallback(chatId, messageId, data, message, from);
  }

  // ==================== Message Handlers ====================

  /**
   * Handle text message
   * @private
   */
  async #handleText(chatId, text, messageId, from) {
    this.#logger.debug('router.text', { chatId, textLength: text.length });

    // Check for special starts (🎲, ❌)
    if (HandleSpecialStart.isSpecialStart(text)) {
      const useCase = this.#container.getHandleSpecialStart?.();
      if (useCase) {
        return useCase.execute({ chatId, messageId, text });
      }
    }

    // Check for slash command
    if (text.startsWith('/')) {
      const useCase = this.#container.getHandleSlashCommand?.();
      if (useCase) {
        return useCase.execute({ chatId, command: text });
      }
    }

    // Regular text entry
    const useCase = this.#container.getProcessTextEntry();
    return useCase.execute({
      chatId,
      text,
      messageId,
      senderId: String(from.id || 'unknown'),
      senderName: from.first_name || from.username || 'User',
    });
  }

  /**
   * Handle voice message
   * @private
   */
  async #handleVoice(chatId, voice, messageId, from) {
    this.#logger.debug('router.voice', { chatId, duration: voice.duration });

    const useCase = this.#container.getProcessVoiceEntry();
    return useCase.execute({
      chatId,
      voiceFileId: voice.file_id,
      messageId,
      senderId: String(from.id || 'unknown'),
      senderName: from.first_name || from.username || 'User',
    });
  }

  /**
   * Handle callback query
   * @private
   */
  async #handleCallback(chatId, messageId, data, message, from) {
    this.#logger.debug('router.callback', { chatId, data });

    // Extract foreign key from message if available
    const foreignKey = message?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data 
      ? this.#extractForeignKey(message) 
      : null;

    const useCase = this.#container.getHandleCallbackResponse();
    return useCase.execute({
      chatId,
      messageId,
      callbackData: data,
      options: {
        senderId: String(from.id || 'unknown'),
        senderName: from.first_name || from.username || 'User',
        foreignKey,
      },
    });
  }

  // ==================== Helpers ====================

  /**
   * Get message type for logging
   * @private
   */
  #getMessageType(message) {
    if (message.photo) return 'photo';
    if (message.voice) return 'voice';
    if (message.text) return 'text';
    if (message.document) return 'document';
    if (message.sticker) return 'sticker';
    return 'unknown';
  }

  /**
   * Extract foreign key from message metadata
   * @private
   */
  #extractForeignKey(message) {
    // This would need to be implemented based on how foreign keys are stored
    // For now, return null
    return null;
  }
}

export default JournalistEventRouter;
