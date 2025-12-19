/**
 * HomeBot Event Router
 * @module homebot/adapters/HomeBotEventRouter
 * 
 * Routes platform-agnostic InputEvents to HomeBot use cases.
 * This is HomeBot's equivalent of NutriBot's UnifiedEventRouter.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';
import { InputEventType } from '../../../application/ports/IInputEvent.mjs';

/**
 * HomeBot Event Router
 * Routes InputEvents to HomeBot use cases (gratitude input flow)
 */
export class HomeBotEventRouter {
  #container;
  #logger;

  /**
   * @param {import('../container.mjs').HomeBotContainer} container
   * @param {Object} [options]
   * @param {Object} [options.logger]
   */
  constructor(container, options = {}) {
    if (!container) throw new Error('container is required');
    this.#container = container;
    this.#logger = options.logger || createLogger({ source: 'router', app: 'homebot' });
  }

  /**
   * Route an InputEvent to the appropriate use case
   * @param {import('../../../application/ports/IInputEvent.mjs').IInputEvent} event
   * @returns {Promise<any>}
   */
  async route(event) {
    const { type, conversationId, messageId, payload } = event;

    this.#logger.debug('homebot.router.event', { type, conversationId, messageId });

    try {
      switch (type) {
        case InputEventType.TEXT:
          return this.#handleText(event);

        case InputEventType.VOICE:
          return this.#handleVoice(event);

        case InputEventType.CALLBACK:
          return this.#handleCallback(event);

        case InputEventType.COMMAND:
          return this.#handleCommand(event);

        default:
          this.#logger.warn('homebot.router.unknownEventType', { type });
          return this.#sendUnsupportedMessage(conversationId);
      }
    } catch (error) {
      this.#logger.error('homebot.router.error', { 
        type, 
        conversationId, 
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  // ==================== Input Handlers ====================

  /**
   * Handle text input - route to ProcessGratitudeInput
   * @private
   */
  async #handleText(event) {
    const { conversationId, messageId, payload } = event;
    this.#logger.debug('homebot.router.text', { conversationId, textLength: payload?.text?.length });

    return this.#container.processGratitudeInput.execute({
      userId: event.userId,
      conversationId,
      text: payload.text,
      messageId,
    });
  }

  /**
   * Handle voice input - route to ProcessGratitudeInput with voice flag
   * @private
   */
  async #handleVoice(event) {
    const { conversationId, messageId, payload } = event;
    this.#logger.debug('homebot.router.voice', { conversationId, hasFileId: !!payload?.fileId });

    return this.#container.processGratitudeInput.execute({
      userId: event.userId,
      conversationId,
      voiceFileId: payload.fileId,
      messageId,
    });
  }

  /**
   * Handle callback queries from inline keyboards
   * @private
   */
  async #handleCallback(event) {
    const { conversationId, messageId, payload } = event;
    const data = payload?.data || '';

    this.#logger.debug('homebot.router.callback', { conversationId, data });

    // Parse callback data to determine action
    if (data.startsWith('category:')) {
      const category = data.replace('category:', '');
      return this.#container.toggleCategory.execute({
        conversationId,
        callbackQueryId: payload.callbackQueryId,
        messageId: payload.sourceMessageId || messageId,
        category,
      });
    }

    if (data.startsWith('user:')) {
      const userId = data.replace('user:', '');
      return this.#container.assignItemToUser.execute({
        conversationId,
        callbackQueryId: payload.callbackQueryId,
        messageId: payload.sourceMessageId || messageId,
        selectedUserId: userId,
      });
    }

    if (data === 'cancel') {
      return this.#container.cancelGratitudeInput.execute({
        conversationId,
        callbackQueryId: payload.callbackQueryId,
        messageId: payload.sourceMessageId || messageId,
      });
    }

    this.#logger.warn('homebot.router.unknownCallback', { data });
    return null;
  }

  /**
   * Handle commands (e.g., /start, /help)
   * @private
   */
  async #handleCommand(event) {
    const { conversationId, payload } = event;
    const command = payload?.command?.toLowerCase();

    this.#logger.debug('homebot.router.command', { conversationId, command });

    const gateway = this.#container.getMessagingGateway();

    switch (command) {
      case 'start':
      case 'help':
        return gateway.sendMessage(conversationId, {
          text: '🏠 <b>HomeBot - Gratitude Input</b>\n\n' +
                'Send me things you\'re grateful for or hoping for, and I\'ll add them to the family gratitude board!\n\n' +
                '<b>Examples:</b>\n' +
                '• "sunny weather, good coffee, family time"\n' +
                '• Send a voice message listing your gratitudes\n\n' +
                'After processing, you can select the category (Gratitude/Hopes) and which family member is contributing.',
          parse_mode: 'HTML',
        });

      default:
        return gateway.sendMessage(conversationId, {
          text: `Unknown command: /${command}\n\nSend /help for usage instructions.`,
        });
    }
  }

  /**
   * Send message for unsupported input types
   * @private
   */
  async #sendUnsupportedMessage(conversationId) {
    const gateway = this.#container.getMessagingGateway();
    return gateway.sendMessage(conversationId, {
      text: '❌ Sorry, I can only process text or voice messages.\n\nSend /help for usage instructions.',
    });
  }
}

export default HomeBotEventRouter;
