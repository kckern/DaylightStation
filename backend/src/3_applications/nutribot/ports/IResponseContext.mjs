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

/**
 * Status indicator handle for long-running operations.
 * Returned by createStatusIndicator().
 *
 * @typedef {Object} IStatusIndicator
 * @property {string} messageId - The underlying message ID
 * @property {function(string, Object?): Promise<string>} finish - Complete with final content, returns messageId
 * @property {function(): Promise<void>} cancel - Abort without final message (deletes status)
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

  /**
   * Create a status indicator for a long-running operation.
   * Shows initial text immediately, optionally animates while waiting.
   * Adapter handles implementation (update-in-place vs delete+recreate).
   *
   * @param {string} initialText - Initial status text (e.g., "🔍 Analyzing")
   * @param {Object} [options] - Options
   * @param {string[]} [options.frames] - Animation frames to cycle (e.g., ['.', '..', '...'])
   * @param {number} [options.interval=2000] - Animation interval in ms
   * @returns {Promise<IStatusIndicator>}
   *
   * @example
   * // With animation
   * const status = await ctx.createStatusIndicator('🔍 Analyzing', {
   *   frames: ['.', '..', '...'],
   *   interval: 2000,
   * });
   * // ... long operation ...
   * const messageId = await status.finish('Done!', { choices: buttons });
   *
   * @example
   * // Static (no animation)
   * const status = await ctx.createStatusIndicator('🔍 Processing...');
   * // ... long operation ...
   * await status.cancel(); // Delete status, send different message type
   * const { messageId } = await ctx.sendPhoto(photo, caption);
   */
  async createStatusIndicator(initialText, options = {}) {},
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
