// backend/src/2_adapters/telegram/IInputEvent.mjs

// Re-export InputEventType from messaging domain
export { InputEventType } from '#domains/messaging/index.mjs';

/**
 * Standardized input event interface for bot webhooks.
 * Platform-agnostic shape that input routers consume.
 *
 * @typedef {'text'|'voice'|'image'|'callback'|'command'|'upc'} InputEventType
 *
 * @typedef {Object} InputEventPayload
 * @property {string} [text] - Text content (for text, command args, captions)
 * @property {string} [fileId] - File ID (for voice, image)
 * @property {string} [callbackData] - Callback button data
 * @property {string} [callbackId] - Callback query ID (for acknowledgement)
 * @property {string} [command] - Command name without slash (for command type)
 *
 * @typedef {Object} InputEventMetadata
 * @property {string} [senderId] - Sender's platform ID
 * @property {string} [firstName] - Sender's first name
 * @property {string} [username] - Sender's username
 * @property {string} [chatType] - Chat type (private, group, etc.)
 *
 * @typedef {Object} IInputEvent
 * @property {InputEventType} type - Event type
 * @property {string} conversationId - Unique conversation identifier (for routing/state)
 * @property {string} platform - Platform name (e.g., 'telegram', 'discord')
 * @property {string} platformUserId - Platform-specific user ID (for identity resolution)
 * @property {string} messageId - Message ID within conversation
 * @property {InputEventPayload} payload - Type-specific payload data
 * @property {InputEventMetadata} metadata - Sender/context metadata
 */

/**
 * Transform TelegramWebhookParser output to standardized IInputEvent
 * @param {Object} parsed - Output from TelegramWebhookParser.parse()
 * @param {import('./TelegramChatRef.mjs').TelegramChatRef} [telegramRef] - Telegram chat reference (optional for backwards compat)
 * @returns {IInputEvent|null}
 */
export function toInputEvent(parsed, telegramRef = null) {
  if (!parsed) return null;

  return {
    type: parsed.type,
    conversationId: telegramRef ? telegramRef.toConversationId().toString() : parsed.userId,
    platform: 'telegram',
    platformUserId: parsed.metadata?.from?.id?.toString(),
    messageId: parsed.messageId,
    payload: {
      text: parsed.text,
      fileId: parsed.fileId,
      callbackData: parsed.callbackData,
      callbackId: parsed.callbackId,
      command: parsed.command,
    },
    metadata: {
      senderId: parsed.metadata?.from?.id?.toString(),
      firstName: parsed.metadata?.from?.first_name,
      username: parsed.metadata?.from?.username,
      chatType: parsed.metadata?.chatType,
    },
  };
}
