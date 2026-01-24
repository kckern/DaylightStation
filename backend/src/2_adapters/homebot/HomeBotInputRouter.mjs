// backend/src/2_adapters/homebot/HomeBotInputRouter.mjs

/**
 * Routes normalized input events to homebot use cases
 * Follows same pattern as JournalistInputRouter
 */
export class HomeBotInputRouter {
  #container;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.container - HomeBotContainer
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.container) {
      throw new Error('HomeBotInputRouter requires container');
    }
    this.#container = config.container;
    this.#logger = config.logger || console;
  }

  /**
   * Route input event to appropriate use case
   * @param {Object} event - Normalized input event
   * @returns {Promise<Object>}
   */
  async route(event) {
    this.#logger.debug?.('homebot.route', { type: event.type });

    switch (event.type) {
      case 'text':
        return this.#handleText(event);
      case 'voice':
        return this.#handleVoice(event);
      case 'callback':
        return this.#handleCallback(event);
      case 'command':
        return this.#handleCommand(event);
      default:
        this.#logger.warn?.('homebot.route.unknown', { type: event.type });
        return { handled: false };
    }
  }

  async #handleText(event) {
    const useCase = await this.#container.getProcessGratitudeInput();
    return useCase.execute({
      conversationId: event.conversationId,
      text: event.text,
      messageId: event.messageId
    });
  }

  async #handleVoice(event) {
    const useCase = await this.#container.getProcessGratitudeInput();
    return useCase.execute({
      conversationId: event.conversationId,
      voiceFileId: event.fileId,
      messageId: event.messageId
    });
  }

  async #handleCallback(event) {
    const data = event.callbackData;

    // Parse callback data format: "action:value"
    if (data.startsWith('user:')) {
      const username = data.slice(5);
      const useCase = await this.#container.getAssignItemToUser();
      return useCase.execute({
        conversationId: event.conversationId,
        messageId: event.messageId,
        username
      });
    }

    if (data.startsWith('category:')) {
      const category = data.slice(9);
      const useCase = await this.#container.getToggleCategory();
      return useCase.execute({
        conversationId: event.conversationId,
        messageId: event.messageId,
        category
      });
    }

    if (data === 'cancel') {
      const useCase = await this.#container.getCancelGratitudeInput();
      return useCase.execute({
        conversationId: event.conversationId,
        messageId: event.messageId
      });
    }

    this.#logger.warn?.('homebot.callback.unknown', { data });
    return { handled: false };
  }

  async #handleCommand(event) {
    // Homebot doesn't have many commands, but could add /gratitude, /hopes
    this.#logger.debug?.('homebot.command', { command: event.command });
    return { handled: false };
  }
}

export default HomeBotInputRouter;
