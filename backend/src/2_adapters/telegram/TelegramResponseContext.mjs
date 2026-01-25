// backend/src/2_adapters/telegram/TelegramResponseContext.mjs

/**
 * TelegramResponseContext - Implements IResponseContext for Telegram
 *
 * Wraps a TelegramAdapter and captures the TelegramChatRef at creation time.
 * All messaging operations are bound to this specific chat, eliminating
 * the need for string parsing at send-time.
 *
 * This is the DDD-compliant way to handle platform identity:
 * - Created per-request in the adapter layer (where platform knowledge lives)
 * - Passed to use cases as IResponseContext (platform-agnostic interface)
 * - No conversationId string parsing needed at send-time
 */
export class TelegramResponseContext {
  /** @type {import('./TelegramAdapter.mjs').TelegramAdapter} */
  #adapter;

  /** @type {import('./TelegramChatRef.mjs').TelegramChatRef} */
  #chatRef;

  /** @type {string} */
  #chatId;

  /**
   * @param {Object} adapter - TelegramAdapter instance
   * @param {import('./TelegramChatRef.mjs').TelegramChatRef} chatRef - The chat this context is bound to
   */
  constructor(adapter, chatRef) {
    if (!adapter) {
      throw new Error('TelegramResponseContext requires adapter');
    }
    if (!chatRef) {
      throw new Error('TelegramResponseContext requires chatRef');
    }

    this.#adapter = adapter;
    this.#chatRef = chatRef;
    this.#chatId = chatRef.chatId;

    Object.freeze(this);
  }

  /**
   * Get the bound chat reference (for logging/debugging)
   * @returns {import('./TelegramChatRef.mjs').TelegramChatRef}
   */
  get chatRef() {
    return this.#chatRef;
  }

  // ============ IResponseContext Implementation ============

  /**
   * Send a text message to the bound chat
   * @param {string} text
   * @param {Object} [options]
   * @returns {Promise<{messageId: string, ok: boolean}>}
   */
  async sendMessage(text, options = {}) {
    return this.#adapter.sendMessage(this.#chatId, text, options);
  }

  /**
   * Send a photo to the bound chat
   * @param {string} imageSource - File ID or URL
   * @param {string} [caption]
   * @param {Object} [options]
   * @returns {Promise<{messageId: string, ok: boolean}>}
   */
  async sendPhoto(imageSource, caption = '', options = {}) {
    return this.#adapter.sendImage(this.#chatId, imageSource, caption, options);
  }

  /**
   * Update an existing message
   * @param {string} messageId
   * @param {Object} updates
   * @returns {Promise<void>}
   */
  async updateMessage(messageId, updates) {
    return this.#adapter.updateMessage(this.#chatId, messageId, updates);
  }

  /**
   * Update keyboard on an existing message
   * @param {string} messageId
   * @param {Array} choices
   * @returns {Promise<void>}
   */
  async updateKeyboard(messageId, choices) {
    return this.#adapter.updateKeyboard(this.#chatId, messageId, choices);
  }

  /**
   * Delete a message
   * @param {string} messageId
   * @returns {Promise<void>}
   */
  async deleteMessage(messageId) {
    return this.#adapter.deleteMessage(this.#chatId, messageId);
  }

  // ============ Additional Methods (Telegram-specific but useful) ============

  /**
   * Get file URL (for voice/image processing)
   * This delegates to adapter without needing chatId
   * @param {string} fileId
   * @returns {Promise<string>}
   */
  async getFileUrl(fileId) {
    return this.#adapter.getFileUrl(fileId);
  }

  /**
   * Transcribe voice message
   * @param {string} fileId
   * @returns {Promise<string>}
   */
  async transcribeVoice(fileId) {
    return this.#adapter.transcribeVoice(fileId);
  }
}

export default TelegramResponseContext;
