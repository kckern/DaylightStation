// backend/src/3_applications/nutribot/ports/IResponseContext.mjs

/**
 * Port interface for per-request response operations.
 *
 * Unlike IMessagingGateway which requires a conversationId for each call,
 * IResponseContext is bound to a specific conversation at creation time.
 * This eliminates string parsing at send-time and keeps platform identity
 * within the adapter layer where it belongs.
 *
 * @interface IResponseContext
 */
export const IResponseContext = {
  /**
   * Send a text message to the bound conversation
   * @param {string} text - Message text
   * @param {Object} [options] - Options (parseMode, choices, inline, removeKeyboard)
   * @returns {Promise<{messageId: string, ok: boolean}>}
   */
  async sendMessage(text, options = {}) {},

  /**
   * Send a photo to the bound conversation
   * @param {string} imageSource - File ID or URL
   * @param {string} [caption] - Photo caption
   * @param {Object} [options] - Options (parseMode, choices, inline)
   * @returns {Promise<{messageId: string, ok: boolean}>}
   */
  async sendPhoto(imageSource, caption = '', options = {}) {},

  /**
   * Update an existing message
   * @param {string} messageId - Message to update
   * @param {Object} updates - Updates (text, caption, parseMode, choices)
   * @returns {Promise<void>}
   */
  async updateMessage(messageId, updates) {},

  /**
   * Update keyboard on an existing message
   * @param {string} messageId - Message to update
   * @param {Array} choices - Button choices (null/empty to remove)
   * @returns {Promise<void>}
   */
  async updateKeyboard(messageId, choices) {},

  /**
   * Delete a message
   * @param {string} messageId - Message to delete
   * @returns {Promise<void>}
   */
  async deleteMessage(messageId) {},
};

/**
 * Check if an object implements IResponseContext
 * @param {Object} obj
 * @returns {boolean}
 */
export function isResponseContext(obj) {
  return (
    obj &&
    typeof obj.sendMessage === 'function' &&
    typeof obj.updateMessage === 'function' &&
    typeof obj.deleteMessage === 'function'
  );
}

export default IResponseContext;
