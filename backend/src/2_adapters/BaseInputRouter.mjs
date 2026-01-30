// backend/src/2_adapters/BaseInputRouter.mjs

import { InputEventType } from './telegram/IInputEvent.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Abstract base class for bot input routers.
 *
 * Provides common routing logic and helper methods.
 * Subclasses implement handle{Type}() methods for supported event types.
 *
 * @abstract
 */
export class BaseInputRouter {
  /** @protected */
  container;
  /** @protected */
  logger;

  /**
   * @param {Object} container - Bot's dependency injection container
   * @param {Object} [options]
   * @param {Object} [options.logger]
   */
  constructor(container, options = {}) {
    if (!container) throw new InfrastructureError('BaseInputRouter requires container', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'container'
      });
    this.container = container;
    this.logger = options.logger || console;
  }

  /**
   * Route an IInputEvent to the appropriate handler.
   * @param {import('./telegram/IInputEvent.mjs').IInputEvent} event
   * @param {import('../3_applications/nutribot/ports/IResponseContext.mjs').IResponseContext} [responseContext] - Bound response context for DDD-compliant messaging
   * @returns {Promise<any>}
   */
  async route(event, responseContext = null) {
    const { type, conversationId, messageId } = event;

    this.logger.debug?.('router.event', { type, conversationId, messageId, hasResponseContext: !!responseContext });

    try {
      switch (type) {
        case InputEventType.TEXT:
          return await this.handleText(event, responseContext);
        case InputEventType.VOICE:
          return await this.handleVoice(event, responseContext);
        case InputEventType.IMAGE:
          return await this.handleImage(event, responseContext);
        case InputEventType.CALLBACK:
          return await this.handleCallback(event, responseContext);
        case InputEventType.COMMAND:
          return await this.handleCommand(event, responseContext);
        case InputEventType.UPC:
          return await this.handleUpc(event, responseContext);
        default:
          this.logger.warn?.('router.unknownType', { type });
          return { ok: true, handled: false };
      }
    } catch (error) {
      this.logger.error?.('router.error', {
        type,
        conversationId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  // ==================== Abstract Handlers ====================
  // Subclasses override these for supported event types.
  // Default implementations return unhandled or throw.

  /**
   * Handle text input event
   * @param {import('./telegram/IInputEvent.mjs').IInputEvent} event
   * @param {import('../3_applications/nutribot/ports/IResponseContext.mjs').IResponseContext} [responseContext]
   * @returns {Promise<any>}
   */
  async handleText(event, responseContext) {
    this.logger.warn?.('router.text.notImplemented', { conversationId: event.conversationId });
    return { ok: true, handled: false };
  }

  /**
   * Handle voice input event
   * @param {import('./telegram/IInputEvent.mjs').IInputEvent} event
   * @param {import('../3_applications/nutribot/ports/IResponseContext.mjs').IResponseContext} [responseContext]
   * @returns {Promise<any>}
   */
  async handleVoice(event, responseContext) {
    this.logger.warn?.('router.voice.notImplemented', { conversationId: event.conversationId });
    return { ok: true, handled: false };
  }

  /**
   * Handle image input event
   * @param {import('./telegram/IInputEvent.mjs').IInputEvent} event
   * @param {import('../3_applications/nutribot/ports/IResponseContext.mjs').IResponseContext} [responseContext]
   * @returns {Promise<any>}
   */
  async handleImage(event, responseContext) {
    this.logger.warn?.('router.image.notImplemented', { conversationId: event.conversationId });
    return { ok: true, handled: false };
  }

  /**
   * Handle callback (button press) event
   * @param {import('./telegram/IInputEvent.mjs').IInputEvent} event
   * @param {import('../3_applications/nutribot/ports/IResponseContext.mjs').IResponseContext} [responseContext]
   * @returns {Promise<any>}
   */
  async handleCallback(event, responseContext) {
    this.logger.warn?.('router.callback.notImplemented', { conversationId: event.conversationId });
    return { ok: true, handled: false };
  }

  /**
   * Handle command event
   * @param {import('./telegram/IInputEvent.mjs').IInputEvent} event
   * @param {import('../3_applications/nutribot/ports/IResponseContext.mjs').IResponseContext} [responseContext]
   * @returns {Promise<any>}
   */
  async handleCommand(event, responseContext) {
    this.logger.warn?.('router.command.notImplemented', { conversationId: event.conversationId });
    return { ok: true, handled: false };
  }

  /**
   * Handle UPC/barcode event
   * @param {import('./telegram/IInputEvent.mjs').IInputEvent} event
   * @param {import('../3_applications/nutribot/ports/IResponseContext.mjs').IResponseContext} [responseContext]
   * @returns {Promise<any>}
   */
  async handleUpc(event, responseContext) {
    this.logger.warn?.('router.upc.notImplemented', { conversationId: event.conversationId });
    return { ok: true, handled: false };
  }

  // ==================== Common Helpers ====================

  /**
   * Extract numeric user ID from metadata
   * @protected
   * @param {Object} metadata
   * @returns {string}
   */
  extractSenderId(metadata) {
    return String(metadata?.senderId || metadata?.userId || 'unknown');
  }

  /**
   * Extract display name from metadata
   * @protected
   * @param {Object} metadata
   * @returns {string}
   */
  extractSenderName(metadata) {
    return metadata?.firstName || metadata?.username || 'User';
  }

  /**
   * Get messaging gateway from container
   * @protected
   * @returns {Object|null}
   */
  getMessagingGateway() {
    return this.container.getMessagingGateway?.() || null;
  }
}

export default BaseInputRouter;
