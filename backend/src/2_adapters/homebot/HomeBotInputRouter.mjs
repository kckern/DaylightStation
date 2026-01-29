// backend/src/2_adapters/homebot/HomeBotInputRouter.mjs

import { InputEventType } from '#domains/messaging';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Routes IInputEvents to homebot use cases
 * Follows same pattern as other bot input routers
 */
export class HomeBotInputRouter {
  #container;
  #logger;
  #userResolver;
  /** @type {import('../telegram/IInputEvent.mjs').IInputEvent|null} */
  #currentEvent;
  /** @type {import('../../3_applications/nutribot/ports/IResponseContext.mjs').IResponseContext|null} */
  #responseContext;

  /**
   * @param {Object} container - HomeBotContainer
   * @param {Object} [options]
   * @param {import('../../0_system/users/UserResolver.mjs').UserResolver} [options.userResolver] - For resolving platform users to system usernames
   * @param {Object} [options.logger]
   */
  constructor(container, options = {}) {
    // Support both old {config.container} and new (container, options) signatures
    if (container?.container) {
      // Old signature: { container, logger }
      this.#container = container.container;
      this.#userResolver = container.userResolver;
      this.#logger = container.logger || console;
    } else {
      // New signature: (container, { logger, userResolver })
      if (!container) throw new InfrastructureError('HomeBotInputRouter requires container', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'container'
      });
      this.#container = container;
      this.#userResolver = options.userResolver;
      this.#logger = options.logger || console;
    }
    this.#currentEvent = null;
    this.#responseContext = null;
  }

  /**
   * Route IInputEvent to appropriate use case
   * @param {import('../telegram/IInputEvent.mjs').IInputEvent} event
   * @param {import('../../3_applications/nutribot/ports/IResponseContext.mjs').IResponseContext} [responseContext] - Bound response context for DDD-compliant messaging
   * @returns {Promise<Object>}
   */
  async route(event, responseContext = null) {
    const { type, conversationId, messageId, payload } = event;

    // Store event and responseContext for handlers that need them
    this.#currentEvent = event;
    this.#responseContext = responseContext;

    this.#logger.debug?.('homebot.route', { type, conversationId, hasResponseContext: !!responseContext });

    try {
      switch (type) {
        case InputEventType.TEXT:
          return await this.#handleText(conversationId, payload.text, messageId, responseContext);

        case InputEventType.VOICE:
          return await this.#handleVoice(conversationId, payload.fileId, messageId, responseContext);

        case InputEventType.CALLBACK:
          return await this.#handleCallback(conversationId, payload.callbackData, messageId, responseContext);

        case InputEventType.COMMAND:
          return await this.#handleCommand(conversationId, payload.command, messageId, responseContext);

        default:
          this.#logger.warn?.('homebot.route.unknown', { type });
          return { handled: false };
      }
    } catch (error) {
      this.#logger.error?.('homebot.route.error', {
        type,
        conversationId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  async #handleText(conversationId, text, messageId, responseContext) {
    const useCase = await this.#container.getProcessGratitudeInput();
    return useCase.execute({
      conversationId,
      userId: this.#resolveUserId(),
      text,
      messageId,
      responseContext,
    });
  }

  async #handleVoice(conversationId, fileId, messageId, responseContext) {
    const useCase = await this.#container.getProcessGratitudeInput();
    return useCase.execute({
      conversationId,
      userId: this.#resolveUserId(),
      voiceFileId: fileId,
      messageId,
      responseContext,
    });
  }

  async #handleCallback(conversationId, callbackData, messageId, responseContext) {
    const userId = this.#resolveUserId();

    // Parse callback data format: "action:value"
    if (callbackData.startsWith('user:')) {
      const username = callbackData.slice(5);
      const useCase = await this.#container.getAssignItemToUser();
      return useCase.execute({
        conversationId,
        userId,
        messageId,
        username,
        responseContext,
      });
    }

    if (callbackData.startsWith('category:')) {
      const category = callbackData.slice(9);
      const useCase = await this.#container.getToggleCategory();
      return useCase.execute({
        conversationId,
        userId,
        messageId,
        category,
        responseContext,
      });
    }

    if (callbackData === 'cancel') {
      const useCase = await this.#container.getCancelGratitudeInput();
      return useCase.execute({
        conversationId,
        userId,
        messageId,
        responseContext,
      });
    }

    this.#logger.warn?.('homebot.callback.unknown', { data: callbackData });
    return { handled: false };
  }

  async #handleCommand(conversationId, command, messageId, responseContext) {
    // Homebot doesn't have many commands, but could add /gratitude, /hopes
    this.#logger.debug?.('homebot.command', { command });
    return { handled: false };
  }

  // ==================== Helpers ====================

  /**
   * Resolve user ID from platform identity using UserResolver
   * Falls back to conversationId if resolution fails
   * @private
   * @returns {string}
   */
  #resolveUserId() {
    const event = this.#currentEvent;

    this.#logger.debug?.('homebot.resolveUserId.attempt', {
      hasUserResolver: !!this.#userResolver,
      platform: event?.platform,
      platformUserId: event?.platformUserId,
      conversationId: event?.conversationId,
    });

    if (this.#userResolver && event?.platform && event?.platformUserId) {
      const username = this.#userResolver.resolveUser(event.platform, event.platformUserId);
      if (username) {
        this.#logger.debug?.('homebot.resolveUserId.resolved', {
          username,
          platformUserId: event.platformUserId,
        });
        return username;
      }
      this.#logger.warn?.('homebot.userResolver.notFound', {
        platform: event.platform,
        platformUserId: event.platformUserId,
        fallback: event.conversationId,
      });
    } else {
      this.#logger.warn?.('homebot.resolveUserId.skipResolution', {
        hasUserResolver: !!this.#userResolver,
        hasPlatform: !!event?.platform,
        hasPlatformUserId: !!event?.platformUserId,
        fallback: event?.conversationId,
      });
    }
    // Fallback to conversationId for backwards compatibility
    return event?.conversationId || 'unknown';
  }
}

export default HomeBotInputRouter;
