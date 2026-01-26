/**
 * HomeBotEventRouter - Routes messaging events to use cases
 * @module homebot/bot/HomeBotEventRouter
 *
 * Handles incoming messaging events (text, voice, callbacks, commands)
 * and routes them to the appropriate use case handlers.
 */

const InputEventType = {
  TEXT: 'text',
  VOICE: 'voice',
  CALLBACK: 'callback',
  COMMAND: 'command'
};

/**
 * HomeBotEventRouter - Routes messaging events to use cases
 */
export class HomeBotEventRouter {
  #container;
  #logger;

  /**
   * @param {Object} container - HomeBotContainer instance
   * @param {Object} [options] - Additional options
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(container, options = {}) {
    this.#container = container;
    this.#logger = options.logger || console;
  }

  /**
   * Route an event to the appropriate use case
   * @param {Object} event - The event to route
   * @param {string} event.type - Event type (text, voice, callback, command)
   * @param {string} event.conversationId - Conversation identifier
   * @param {string} [event.text] - Text content (for text events)
   * @param {string} [event.fileId] - File ID (for voice events)
   * @param {string} [event.data] - Callback data (for callback events)
   * @param {string} [event.messageId] - Message ID (for callback events)
   * @param {string} [event.command] - Command name (for command events)
   * @returns {Promise<Object|null>} Result from use case or null
   */
  async route(event) {
    this.#logger.debug?.('homebot.route', { type: event.type, conversationId: event.conversationId });

    switch (event.type) {
      case InputEventType.TEXT:
        return this.#handleText(event);
      case InputEventType.VOICE:
        return this.#handleVoice(event);
      case InputEventType.CALLBACK:
        return this.#handleCallback(event);
      case InputEventType.COMMAND:
        return this.#handleCommand(event);
      default:
        this.#logger.warn?.('homebot.unknownEventType', { type: event.type });
        return null;
    }
  }

  /**
   * Handle text input events
   * @param {Object} event - Text event
   * @returns {Promise<Object>}
   */
  async #handleText(event) {
    const useCase = await this.#container.getProcessGratitudeInput();
    return useCase.execute({
      conversationId: event.conversationId,
      text: event.text
    });
  }

  /**
   * Handle voice input events
   * @param {Object} event - Voice event
   * @returns {Promise<Object>}
   */
  async #handleVoice(event) {
    const useCase = await this.#container.getProcessGratitudeInput();
    return useCase.execute({
      conversationId: event.conversationId,
      voiceFileId: event.fileId
    });
  }

  /**
   * Handle callback button events
   * @param {Object} event - Callback event
   * @returns {Promise<Object|null>}
   */
  async #handleCallback(event) {
    const data = event.data;

    if (data.startsWith('user:')) {
      const username = data.replace('user:', '');
      const useCase = await this.#container.getAssignItemToUser();
      return useCase.execute({
        conversationId: event.conversationId,
        messageId: event.messageId,
        username
      });
    }

    if (data.startsWith('category:')) {
      const category = data.replace('category:', '');
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

    if (data === 'confirm') {
      // Confirm without specific user - may need to prompt for user selection
      return { action: 'confirm', needsUserSelection: true };
    }

    return null;
  }

  /**
   * Handle command events (e.g., /help, /start)
   * @param {Object} event - Command event
   * @returns {Promise<Object|null>}
   */
  async #handleCommand(event) {
    if (event.command === 'help') {
      return { type: 'help', text: 'Send me something you are grateful for!' };
    }
    if (event.command === 'start') {
      return { type: 'start', text: 'Welcome! Share what you are grateful for today.' };
    }
    return null;
  }
}

export { InputEventType };
export default HomeBotEventRouter;
