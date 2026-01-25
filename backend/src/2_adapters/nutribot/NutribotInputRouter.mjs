// backend/src/2_adapters/nutribot/NutribotInputRouter.mjs

import { BaseInputRouter } from '../BaseInputRouter.mjs';
import { decodeCallback, CallbackActions } from '../../3_applications/nutribot/lib/callback.mjs';

/**
 * Nutribot Input Router
 *
 * Routes IInputEvents to Nutribot use cases.
 * Transforms platform-agnostic events to use case input shapes.
 */
export class NutribotInputRouter extends BaseInputRouter {
  #userResolver;

  /**
   * @param {import('../../3_applications/nutribot/NutribotContainer.mjs').NutribotContainer} container
   * @param {Object} [options]
   * @param {import('../../0_infrastructure/users/UserResolver.mjs').UserResolver} [options.userResolver] - For resolving platform users to system usernames
   * @param {Object} [options.logger]
   */
  constructor(container, options = {}) {
    super(container, options);
    this.#userResolver = options.userResolver;
  }

  // ==================== Event Handlers ====================

  async handleText(event, responseContext) {
    const useCase = this.container.getLogFoodFromText();
    const result = await useCase.execute({
      userId: this.#resolveUserId(event),
      conversationId: event.conversationId,
      text: event.payload.text,
      messageId: event.messageId,
      responseContext,
    });
    return { ok: true, result };
  }

  async handleImage(event, responseContext) {
    const useCase = this.container.getLogFoodFromImage();
    const result = await useCase.execute({
      userId: this.#resolveUserId(event),
      conversationId: event.conversationId,
      imageData: {
        fileId: event.payload.fileId,
        caption: event.payload.text,
      },
      messageId: event.messageId,
      responseContext,
    });
    return { ok: true, result };
  }

  async handleVoice(event, responseContext) {
    const useCase = this.container.getLogFoodFromVoice();
    const result = await useCase.execute({
      userId: this.#resolveUserId(event),
      conversationId: event.conversationId,
      voiceData: {
        fileId: event.payload.fileId,
      },
      messageId: event.messageId,
      responseContext,
    });
    return { ok: true, result };
  }

  async handleUpc(event, responseContext) {
    const useCase = this.container.getLogFoodFromUPC();
    const result = await useCase.execute({
      userId: this.#resolveUserId(event),
      conversationId: event.conversationId,
      upc: event.payload.text,
      messageId: event.messageId,
      responseContext,
    });
    return { ok: true, result };
  }

  async handleCallback(event, responseContext) {
    const decoded = decodeCallback(event.payload.callbackData);

    // Support both new format (a key) and legacy format (cmd key with short codes)
    let action = decoded.a || decoded.cmd;

    // Map legacy short codes to action constants
    const legacyActionMap = {
      a: CallbackActions.ACCEPT_LOG,
      r: CallbackActions.REVISE_ITEM,
      x: CallbackActions.REJECT_LOG,
    };
    if (legacyActionMap[action]) {
      action = legacyActionMap[action];
    }

    // Note: Callback acknowledgement is handled by createBotWebhookHandler

    switch (action) {
      case CallbackActions.ACCEPT_LOG: {
        const useCase = this.container.getAcceptFoodLog();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.id,
          messageId: event.messageId,
          responseContext,
        });
      }
      case CallbackActions.REJECT_LOG: {
        const useCase = this.container.getDiscardFoodLog();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.id,
          messageId: event.messageId,
          responseContext,
        });
      }
      case CallbackActions.REVISE_ITEM: {
        const useCase = this.container.getReviseFoodLog();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.logId || decoded.id,
          itemId: decoded.itemId,
          messageId: event.messageId,
          responseContext,
        });
      }
      default:
        this.logger.warn?.('nutribot.callback.unknown', { action, decoded });
        return { ok: true, handled: false };
    }
  }

  async handleCommand(event, responseContext) {
    const command = event.payload.command;

    switch (command) {
      case 'help': {
        const useCase = this.container.getHandleHelpCommand();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          responseContext,
        });
      }
      case 'review': {
        const useCase = this.container.getHandleReviewCommand();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          responseContext,
        });
      }
      case 'report': {
        const useCase = this.container.getGenerateDailyReport();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          autoAcceptPending: true,
          responseContext,
        });
      }
      default:
        this.logger.warn?.('nutribot.command.unknown', { command });
        return { ok: true, handled: false };
    }
  }

  // ==================== Helpers ====================

  /**
   * Resolve user ID from platform identity
   * Uses UserResolver to map platform+platformUserId to system username
   * Falls back to conversationId if resolution fails
   * @private
   * @param {import('../telegram/IInputEvent.mjs').IInputEvent} event
   * @returns {string}
   */
  #resolveUserId(event) {
    if (this.#userResolver && event.platform && event.platformUserId) {
      const username = this.#userResolver.resolveUser(event.platform, event.platformUserId);
      if (username) {
        return username;
      }
      this.logger.warn?.('nutribot.userResolver.notFound', {
        platform: event.platform,
        platformUserId: event.platformUserId,
        fallback: event.conversationId,
      });
    }
    // Fallback to conversationId for backwards compatibility
    return event.conversationId;
  }
}

export default NutribotInputRouter;
