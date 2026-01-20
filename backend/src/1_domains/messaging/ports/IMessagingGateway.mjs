/**
 * IMessagingGateway - Port interface for messaging platforms
 *
 * Implementations:
 * - TelegramAdapter: Telegram Bot API
 * - MockMessagingGateway: In-memory mock for testing
 */

/**
 * @typedef {Object} SendMessageOptions
 * @property {Array<Array<string|Object>>} [choices] - Keyboard buttons (rows of buttons)
 * @property {boolean} [inline=false] - Use inline keyboard instead of reply keyboard
 * @property {'Markdown'|'MarkdownV2'|'HTML'} [parseMode] - Message formatting mode
 * @property {boolean} [removeKeyboard=false] - Remove existing keyboard
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} SendMessageResult
 * @property {string} messageId - ID of sent message
 * @property {boolean} ok - Whether send was successful
 */

export const IMessagingGateway = {
  /**
   * Send a text message
   * @param {string} chatId - Chat identifier
   * @param {string} text - Message text
   * @param {SendMessageOptions} [options] - Send options
   * @returns {Promise<SendMessageResult>}
   */
  async sendMessage(chatId, text, options = {}) {},

  /**
   * Send an image
   * @param {string} chatId - Chat identifier
   * @param {string|Buffer} imageSource - URL, path, or buffer
   * @param {string} [caption] - Image caption
   * @param {SendMessageOptions} [options] - Send options
   * @returns {Promise<SendMessageResult>}
   */
  async sendImage(chatId, imageSource, caption, options = {}) {},

  /**
   * Edit an existing message
   * @param {string} chatId - Chat identifier
   * @param {string} messageId - Message to edit
   * @param {Object} updates - Updates to apply
   * @returns {Promise<void>}
   */
  async updateMessage(chatId, messageId, updates) {},

  /**
   * Update keyboard on a message
   * @param {string} chatId - Chat identifier
   * @param {string} messageId - Message to update
   * @param {Array<Array<string|Object>>} choices - New keyboard
   * @returns {Promise<void>}
   */
  async updateKeyboard(chatId, messageId, choices) {},

  /**
   * Delete a message
   * @param {string} chatId - Chat identifier
   * @param {string} messageId - Message to delete
   * @returns {Promise<void>}
   */
  async deleteMessage(chatId, messageId) {},

  /**
   * Transcribe a voice message
   * @param {string} fileId - Voice file ID
   * @returns {Promise<string>} Transcribed text
   */
  async transcribeVoice(fileId) {},

  /**
   * Get download URL for a file
   * @param {string} fileId - File ID
   * @returns {Promise<string>} Download URL
   */
  async getFileUrl(fileId) {}
};

/**
 * Validate that an object implements IMessagingGateway
 * @param {Object} obj - Object to validate
 * @returns {boolean}
 */
export function isMessagingGateway(obj) {
  if (!obj || typeof obj !== 'object') return false;

  const requiredMethods = [
    'sendMessage',
    'sendImage',
    'updateMessage',
    'updateKeyboard',
    'deleteMessage',
    'transcribeVoice',
    'getFileUrl'
  ];

  return requiredMethods.every(method => typeof obj[method] === 'function');
}

export default IMessagingGateway;
