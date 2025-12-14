/**
 * NutriBot Event Router
 * @module nutribot/adapters/EventRouter
 * 
 * Routes webhook events to appropriate use cases.
 */

import { createLogger } from '../../_lib/logging/index.mjs';

// UPC pattern: 8-14 digits, potentially with dashes
const UPC_PATTERN = /^\d[\d-]{6,13}\d$/;

/**
 * NutriBot Event Router
 */
export class NutribotEventRouter {
  #container;
  #logger;

  /**
   * @param {import('../container.mjs').NutribotContainer} container
   */
  constructor(container) {
    if (!container) throw new Error('container is required');
    this.#container = container;
    this.#logger = createLogger({ source: 'router', app: 'nutribot' });
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

    // Photo message
    if (message.photo && message.photo.length > 0) {
      return this.#handlePhoto(chatId, message.photo, messageId);
    }

    // Voice message
    if (message.voice) {
      return this.#handleVoice(chatId, message.voice, messageId, from);
    }

    // Text message
    if (message.text) {
      const text = message.text.trim();

      // Check for slash command
      if (text.startsWith('/')) {
        return this.#handleCommand(chatId, text, messageId);
      }

      // Check for UPC pattern
      if (UPC_PATTERN.test(text.replace(/-/g, ''))) {
        return this.#handleUPC(chatId, text, messageId);
      }

      // Regular text
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

    if (!chatId || !data) {
      this.#logger.warn('router.invalidCallback', { hasChat: !!chatId, hasData: !!data });
      return;
    }

    return this.#handleCallback(chatId, messageId, data, message);
  }

  // ==================== Message Handlers ====================

  /**
   * Handle photo message
   * @private
   */
  async #handlePhoto(chatId, photos, messageId) {
    this.#logger.debug('router.photo', { chatId, photoCount: photos.length });

    // Get largest photo (last in array)
    const photo = photos[photos.length - 1];
    const fileId = photo.file_id;

    const useCase = this.#container.getLogFoodFromImage();
    return useCase.execute({
      userId: chatId,
      conversationId: chatId,
      imageData: { fileId },
      messageId,
    });
  }

  /**
   * Handle UPC code
   * @private
   */
  async #handleUPC(chatId, upc, messageId) {
    this.#logger.debug('router.upc', { chatId, upc });

    // Clean UPC (remove dashes)
    const cleanUPC = upc.replace(/-/g, '');

    const useCase = this.#container.getLogFoodFromUPC();
    return useCase.execute({
      userId: chatId,
      conversationId: chatId,
      upc: cleanUPC,
      messageId,
    });
  }

  /**
   * Handle text message
   * @private
   */
  async #handleText(chatId, text, messageId, from) {
    this.#logger.debug('router.text', { chatId, textLength: text.length });

    // Check conversation state for revising
    const conversationStateStore = this.#container.getConversationStateStore();
    const state = await conversationStateStore.get(chatId);

    if (state?.flow === 'revision' && state?.pendingLogUuid) {
      const useCase = this.#container.getProcessRevisionInput();
      return useCase.execute({
        userId: chatId,
        conversationId: chatId,
        logUuid: state.pendingLogUuid,
        revisionText: text,
        messageId,
      });
    }

    // Regular food logging
    const useCase = this.#container.getLogFoodFromText();
    return useCase.execute({
      userId: chatId,
      conversationId: chatId,
      text,
      messageId,
    });
  }

  /**
   * Handle voice message
   * @private
   */
  async #handleVoice(chatId, voice, messageId, from) {
    this.#logger.debug('router.voice', { chatId, duration: voice.duration });

    const useCase = this.#container.getLogFoodFromVoice();
    return useCase.execute({
      userId: chatId,
      conversationId: chatId,
      voiceData: { fileId: voice.file_id },
      messageId,
    });
  }

  /**
   * Handle callback query
   * @private
   */
  async #handleCallback(chatId, messageId, data, message) {
    this.#logger.debug('router.callback', { chatId, data });

    // Parse callback data
    const [action, ...params] = data.split(':');

    switch (action) {
      case 'accept':
      case '✅':
      case 'Accept': {
        const logUuid = params[0] || this.#extractLogUuidFromMessage(message);
        const useCase = this.#container.getAcceptFoodLog();
        return useCase.execute({
          userId: chatId,
          conversationId: chatId,
          logUuid,
          messageId,
        });
      }

      case 'discard':
      case '🗑️':
      case 'Discard': {
        const logUuid = params[0] || this.#extractLogUuidFromMessage(message);
        const useCase = this.#container.getDiscardFoodLog();
        return useCase.execute({
          userId: chatId,
          conversationId: chatId,
          logUuid,
          messageId,
        });
      }

      case 'revise':
      case '✏️':
      case 'Revise': {
        const logUuid = params[0] || this.#extractLogUuidFromMessage(message);
        const useCase = this.#container.getReviseFoodLog();
        return useCase.execute({
          userId: chatId,
          conversationId: chatId,
          logUuid,
          messageId,
        });
      }

      case 'portion': {
        const factor = parseFloat(params[0]) || 1;
        const useCase = this.#container.getSelectUPCPortion();
        return useCase.execute({
          userId: chatId,
          conversationId: chatId,
          portionFactor: factor,
          messageId,
        });
      }

      case 'adjust_date': {
        const useCase = this.#container.getSelectDateForAdjustment();
        const date = params[0];
        return useCase.execute({
          userId: chatId,
          conversationId: chatId,
          date,
        });
      }

      case 'adjust_item': {
        const itemUuid = params[0];
        const useCase = this.#container.getSelectItemForAdjustment();
        return useCase.execute({
          userId: chatId,
          conversationId: chatId,
          itemUuid,
        });
      }

      case 'adjust_portion': {
        const factor = parseFloat(params[0]) || 1;
        const useCase = this.#container.getApplyPortionAdjustment();
        return useCase.execute({
          userId: chatId,
          conversationId: chatId,
          factor,
        });
      }

      case 'delete_item': {
        const itemUuid = params[0];
        const useCase = this.#container.getDeleteListItem();
        return useCase.execute({
          userId: chatId,
          conversationId: chatId,
          itemUuid,
        });
      }

      default:
        this.#logger.warn('router.unknownCallback', { chatId, action, data });
        return;
    }
  }

  /**
   * Handle slash command
   * @private
   */
  async #handleCommand(chatId, command, messageId) {
    const cmd = command.slice(1).toLowerCase().split(/\s+/)[0];
    this.#logger.debug('router.command', { chatId, command: cmd });

    switch (cmd) {
      case 'help':
      case 'start': {
        const useCase = this.#container.getHandleHelpCommand();
        return useCase.execute({ conversationId: chatId });
      }

      case 'report': {
        const useCase = this.#container.getGenerateDailyReport();
        return useCase.execute({
          userId: chatId,
          conversationId: chatId,
        });
      }

      case 'review':
      case 'adjust': {
        const useCase = this.#container.getStartAdjustmentFlow();
        return useCase.execute({
          userId: chatId,
          conversationId: chatId,
        });
      }

      case 'coach': {
        const useCase = this.#container.getGenerateOnDemandCoaching();
        return useCase.execute({
          userId: chatId,
          conversationId: chatId,
        });
      }

      case 'confirm': {
        const useCase = this.#container.getConfirmAllPending();
        return useCase.execute({
          userId: chatId,
          conversationId: chatId,
        });
      }

      default:
        // Unknown command - treat as text
        return this.#handleText(chatId, command, messageId, {});
    }
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
   * Extract log UUID from message (if stored in message data)
   * @private
   */
  #extractLogUuidFromMessage(message) {
    // Try to extract from reply_markup or message text
    // This is a fallback - ideally UUID is in callback data
    return null;
  }
}

export default NutribotEventRouter;
