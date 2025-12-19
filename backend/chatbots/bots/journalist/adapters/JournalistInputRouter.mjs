/**
 * Journalist Input Router
 * @module journalist/adapters/JournalistInputRouter
 * 
 * Routes platform-agnostic IInputEvents to Journalist use cases.
 * This replaces the old JournalistEventRouter which parsed raw Telegram events.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';
import { InputEventType } from '../../../application/ports/IInputEvent.mjs';
import { HandleSpecialStart } from '../application/usecases/HandleSpecialStart.mjs';

/**
 * Journalist Input Router
 * Routes IInputEvents to appropriate Journalist use cases
 */
export class JournalistInputRouter {
  #container;
  #logger;

  /**
   * @param {import('../container.mjs').JournalistContainer} container
   * @param {Object} [options]
   * @param {Object} [options.logger]
   */
  constructor(container, options = {}) {
    if (!container) throw new Error('container is required');
    this.#container = container;
    this.#logger = options.logger || createLogger({ source: 'router', app: 'journalist' });
  }

  /**
   * Route an IInputEvent to the appropriate use case
   * @param {import('../../application/ports/IInputEvent.mjs').IInputEvent} event
   * @returns {Promise<any>}
   */
  async route(event) {
    const { type, conversationId, messageId, payload, metadata } = event;

    this.#logger.debug('router.event', { type, conversationId, messageId });

    try {
      switch (type) {
        case InputEventType.TEXT:
          return this.#handleText(conversationId, payload.text, messageId, metadata);

        case InputEventType.VOICE:
          return this.#handleVoice(conversationId, payload, messageId, metadata);

        case InputEventType.COMMAND:
          return this.#handleCommand(conversationId, payload.command, payload.args);

        case InputEventType.CALLBACK:
          return this.#handleCallback(conversationId, payload, messageId, metadata);

        default:
          this.#logger.warn('router.unknownEventType', { type });
          return null;
      }
    } catch (error) {
      this.#logger.error('router.error', { 
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
   * Handle text input
   * @private
   */
  async #handleText(conversationId, text, messageId, metadata) {
    this.#logger.debug('router.text', { conversationId, textLength: text?.length });

    // Check for special starts (🎲, ❌)
    if (HandleSpecialStart.isSpecialStart(text)) {
      const useCase = this.#container.getHandleSpecialStart?.();
      if (useCase) {
        return useCase.execute({ 
          chatId: conversationId, 
          messageId, 
          text,
        });
      }
    }

    // Regular text entry - route to ProcessTextEntry
    const useCase = this.#container.getProcessTextEntry();
    return useCase.execute({
      chatId: conversationId,
      text,
      messageId,
      senderId: this.#extractSenderId(metadata),
      senderName: this.#extractSenderName(metadata),
    });
  }

  /**
   * Handle voice input
   * @private
   */
  async #handleVoice(conversationId, payload, messageId, metadata) {
    this.#logger.debug('router.voice', { conversationId, hasFileId: !!payload.fileId });

    const useCase = this.#container.getProcessVoiceEntry();
    return useCase.execute({
      chatId: conversationId,
      voiceFileId: payload.fileId,
      messageId,
      senderId: this.#extractSenderId(metadata),
      senderName: this.#extractSenderName(metadata),
    });
  }

  /**
   * Handle slash command
   * @private
   */
  async #handleCommand(conversationId, command, args) {
    this.#logger.debug('router.command', { conversationId, command });

    const useCase = this.#container.getHandleSlashCommand?.();
    if (useCase) {
      // Build full command string with leading slash
      const fullCommand = args ? `/${command} ${args}` : `/${command}`;
      return useCase.execute({ 
        chatId: conversationId, 
        command: fullCommand,
      });
    }

    this.#logger.warn('router.command.noHandler', { command });
    return null;
  }

  /**
   * Handle callback (button press)
   * @private
   */
  async #handleCallback(conversationId, payload, messageId, metadata) {
    this.#logger.debug('router.callback', { conversationId, data: payload.data });

    const useCase = this.#container.getHandleCallbackResponse();
    return useCase.execute({
      chatId: conversationId,
      messageId: payload.sourceMessageId,
      callbackData: payload.data,
      options: {
        senderId: this.#extractSenderId(metadata),
        senderName: this.#extractSenderName(metadata),
        foreignKey: null, // Can be extracted from metadata if needed
      },
    });
  }

  // ==================== Helpers ====================

  /**
   * Extract sender ID from metadata
   * @private
   */
  #extractSenderId(metadata) {
    // Try various metadata fields
    return String(
      metadata?.senderId || 
      metadata?.userId || 
      metadata?.fromId || 
      'unknown'
    );
  }

  /**
   * Extract sender name from metadata
   * @private
   */
  #extractSenderName(metadata) {
    return (
      metadata?.firstName || 
      metadata?.first_name ||
      metadata?.username || 
      metadata?.senderName ||
      'User'
    );
  }
}

export default JournalistInputRouter;
