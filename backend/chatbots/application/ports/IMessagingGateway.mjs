/**
 * Messaging Gateway Port Interface
 * @module application/ports/IMessagingGateway
 */

/**
 * @typedef {Object} SendMessageOptions
 * @property {Array<Array<string|Object>>} [choices] - Keyboard buttons (rows of buttons)
 * @property {boolean} [inline=false] - Use inline keyboard instead of reply keyboard
 * @property {boolean} [saveMessage=true] - Persist message to history
 * @property {'Markdown'|'MarkdownV2'|'HTML'} [parseMode] - Message formatting mode
 * @property {Object} [foreignKey] - Metadata to attach to message
 * @property {boolean} [removeKeyboard=false] - Remove existing keyboard
 */

/**
 * @typedef {Object} SendMessageResult
 * @property {import('../../domain/value-objects/MessageId.mjs').MessageId} messageId
 */

/**
 * @typedef {Object} UpdateMessageOptions
 * @property {string} [text] - New message text
 * @property {string} [caption] - New image caption
 * @property {Array<Array<string|Object>>} [choices] - New keyboard buttons
 * @property {'Markdown'|'MarkdownV2'|'HTML'} [parseMode]
 */

/**
 * Abstract interface for chat platform messaging
 * 
 * Implementations:
 * - TelegramGateway: Real Telegram Bot API
 * - MockMessagingGateway: In-memory mock for testing
 * - ConsoleGateway: Logs to console (debugging)
 * 
 * @interface IMessagingGateway
 */

/**
 * @typedef {Object} IMessagingGateway
 * @property {function} sendMessage - Send a text message
 * @property {function} sendImage - Send an image with optional caption
 * @property {function} updateMessage - Edit an existing message
 * @property {function} updateKeyboard - Update just the keyboard of a message
 * @property {function} deleteMessage - Delete a message
 * @property {function} transcribeVoice - Transcribe a voice message to text
 * @property {function} getFileUrl - Get download URL for a file
 */

/**
 * Method signatures for IMessagingGateway:
 * 
 * sendMessage(chatId: ChatId, text: string, options?: SendMessageOptions): Promise<SendMessageResult>
 *   - Send a text message to a chat
 *   - Returns the messageId of the sent message
 * 
 * sendImage(chatId: ChatId, imageSource: string|Buffer, caption?: string, options?: SendMessageOptions): Promise<SendMessageResult>
 *   - Send an image (URL, file path, or Buffer) with optional caption
 *   - Returns the messageId of the sent message
 * 
 * updateMessage(chatId: ChatId, messageId: MessageId, updates: UpdateMessageOptions): Promise<void>
 *   - Edit an existing message (text, caption, or keyboard)
 * 
 * updateKeyboard(chatId: ChatId, messageId: MessageId, choices: Array<Array<string|Object>>): Promise<void>
 *   - Update only the inline keyboard of a message
 * 
 * deleteMessage(chatId: ChatId, messageId: MessageId): Promise<void>
 *   - Delete a message from the chat
 * 
 * transcribeVoice(voiceFileId: string): Promise<string>
 *   - Download and transcribe a voice message
 *   - Returns the transcribed text
 * 
 * getFileUrl(fileId: string): Promise<string>
 *   - Get the download URL for a file by its ID
 */

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
    'getFileUrl',
  ];
  
  return requiredMethods.every(method => typeof obj[method] === 'function');
}

/**
 * Create a type-safe wrapper that validates gateway implementation
 * @template T
 * @param {T} gateway - Gateway implementation
 * @returns {T}
 * @throws {Error} if gateway doesn't implement IMessagingGateway
 */
export function assertMessagingGateway(gateway) {
  if (!isMessagingGateway(gateway)) {
    throw new Error('Object does not implement IMessagingGateway interface');
  }
  return gateway;
}

export default {
  isMessagingGateway,
  assertMessagingGateway,
};
