/**
 * Input Event Port Interface
 * @module application/ports/IInputEvent
 * 
 * Platform-agnostic input event abstraction.
 * Adapters (Telegram, CLI, Discord, etc.) convert their native
 * payloads into this common format for routing.
 */

// ==================== Event Types ====================

/**
 * @typedef {'text'|'image'|'voice'|'callback'|'command'|'upc'|'document'} InputEventType
 */

/**
 * Input event types enumeration
 * @readonly
 * @enum {string}
 */
export const InputEventType = Object.freeze({
  TEXT: 'text',
  IMAGE: 'image',
  VOICE: 'voice',
  CALLBACK: 'callback',
  COMMAND: 'command',
  UPC: 'upc',
  DOCUMENT: 'document',
});

// ==================== Payload Types ====================

/**
 * Text event payload
 * @typedef {Object} TextEventPayload
 * @property {string} text - The message text
 */

/**
 * Image event payload
 * @typedef {Object} ImageEventPayload
 * @property {string} fileId - Platform-specific file identifier
 * @property {string} [url] - Direct URL if available
 * @property {number} [width] - Image width in pixels
 * @property {number} [height] - Image height in pixels
 * @property {string} [caption] - Optional image caption
 */

/**
 * Voice event payload
 * @typedef {Object} VoiceEventPayload
 * @property {string} fileId - Platform-specific file identifier
 * @property {number} [duration] - Duration in seconds
 * @property {string} [mimeType] - Audio MIME type
 */

/**
 * Callback (button press) event payload
 * @typedef {Object} CallbackEventPayload
 * @property {string} data - Callback data string (from button)
 * @property {string} sourceMessageId - Message ID the button was attached to
 * @property {string} [callbackQueryId] - Telegram callback query ID for answering
 */

/**
 * Slash command event payload
 * @typedef {Object} CommandEventPayload
 * @property {string} command - Command name (without leading slash)
 * @property {string} [args] - Arguments after the command
 * @property {string} [rawText] - Original full text including slash
 */

/**
 * UPC barcode event payload
 * @typedef {Object} UPCEventPayload
 * @property {string} upc - Cleaned UPC code (digits only)
 * @property {string} [rawText] - Original text with dashes if present
 */

/**
 * Document event payload
 * @typedef {Object} DocumentEventPayload
 * @property {string} fileId - Platform-specific file identifier
 * @property {string} [fileName] - Original filename
 * @property {string} [mimeType] - Document MIME type
 * @property {number} [fileSize] - File size in bytes
 */

// ==================== Main Interface ====================

/**
 * Platform-agnostic input event
 * 
 * This is the canonical format for all user inputs across platforms.
 * Adapters are responsible for converting platform-specific payloads
 * into this format before routing.
 * 
 * @typedef {Object} IInputEvent
 * @property {InputEventType} type - Event type
 * @property {string} userId - Platform user identifier (numeric string for Telegram)
 * @property {string} conversationId - Canonical conversation ID (format: "{channel}:{identifier}")
 * @property {string} [messageId] - Source message ID if applicable
 * @property {string} channel - Source channel (telegram, cli, discord, etc.)
 * @property {number} timestamp - Unix timestamp (milliseconds)
 * @property {TextEventPayload|ImageEventPayload|VoiceEventPayload|CallbackEventPayload|CommandEventPayload|UPCEventPayload|DocumentEventPayload} payload - Type-specific payload
 * @property {Object} [metadata] - Additional platform-specific metadata
 */

// ==================== Factory Functions ====================

/**
 * Create a text input event
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.conversationId
 * @param {string} params.text
 * @param {string} [params.messageId]
 * @param {string} [params.channel='unknown']
 * @param {Object} [params.metadata]
 * @returns {IInputEvent}
 */
export function createTextEvent({ userId, conversationId, text, messageId, channel = 'unknown', metadata }) {
  return {
    type: InputEventType.TEXT,
    userId,
    conversationId,
    messageId,
    channel,
    timestamp: Date.now(),
    payload: { text },
    metadata,
  };
}

/**
 * Create an image input event
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.conversationId
 * @param {string} params.fileId
 * @param {string} [params.url]
 * @param {string} [params.messageId]
 * @param {string} [params.caption]
 * @param {string} [params.channel='unknown']
 * @param {Object} [params.metadata]
 * @returns {IInputEvent}
 */
export function createImageEvent({ userId, conversationId, fileId, url, messageId, caption, channel = 'unknown', metadata }) {
  return {
    type: InputEventType.IMAGE,
    userId,
    conversationId,
    messageId,
    channel,
    timestamp: Date.now(),
    payload: { fileId, url, caption },
    metadata,
  };
}

/**
 * Create a voice input event
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.conversationId
 * @param {string} params.fileId
 * @param {number} [params.duration]
 * @param {string} [params.messageId]
 * @param {string} [params.channel='unknown']
 * @param {Object} [params.metadata]
 * @returns {IInputEvent}
 */
export function createVoiceEvent({ userId, conversationId, fileId, duration, messageId, channel = 'unknown', metadata }) {
  return {
    type: InputEventType.VOICE,
    userId,
    conversationId,
    messageId,
    channel,
    timestamp: Date.now(),
    payload: { fileId, duration },
    metadata,
  };
}

/**
 * Create a callback (button press) input event
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.conversationId
 * @param {string} params.data - Button callback data
 * @param {string} params.sourceMessageId - Message the button was on
 * @param {string} [params.callbackQueryId]
 * @param {string} [params.channel='unknown']
 * @param {Object} [params.metadata]
 * @returns {IInputEvent}
 */
export function createCallbackEvent({ userId, conversationId, data, sourceMessageId, callbackQueryId, channel = 'unknown', metadata }) {
  return {
    type: InputEventType.CALLBACK,
    userId,
    conversationId,
    messageId: callbackQueryId, // Use callback query ID as message ID
    channel,
    timestamp: Date.now(),
    payload: { data, sourceMessageId, callbackQueryId },
    metadata,
  };
}

/**
 * Create a command input event
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.conversationId
 * @param {string} params.command - Command without leading slash
 * @param {string} [params.args] - Arguments after command
 * @param {string} [params.rawText] - Original text
 * @param {string} [params.messageId]
 * @param {string} [params.channel='unknown']
 * @param {Object} [params.metadata]
 * @returns {IInputEvent}
 */
export function createCommandEvent({ userId, conversationId, command, args, rawText, messageId, channel = 'unknown', metadata }) {
  return {
    type: InputEventType.COMMAND,
    userId,
    conversationId,
    messageId,
    channel,
    timestamp: Date.now(),
    payload: { command, args, rawText },
    metadata,
  };
}

/**
 * Create a UPC barcode input event
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.conversationId
 * @param {string} params.upc - Cleaned UPC (digits only)
 * @param {string} [params.rawText] - Original text with dashes
 * @param {string} [params.messageId]
 * @param {string} [params.channel='unknown']
 * @param {Object} [params.metadata]
 * @returns {IInputEvent}
 */
export function createUPCEvent({ userId, conversationId, upc, rawText, messageId, channel = 'unknown', metadata }) {
  return {
    type: InputEventType.UPC,
    userId,
    conversationId,
    messageId,
    channel,
    timestamp: Date.now(),
    payload: { upc, rawText },
    metadata,
  };
}

/**
 * Create a document input event
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.conversationId
 * @param {string} params.fileId
 * @param {string} [params.fileName]
 * @param {string} [params.mimeType]
 * @param {number} [params.fileSize]
 * @param {string} [params.messageId]
 * @param {string} [params.channel='unknown']
 * @param {Object} [params.metadata]
 * @returns {IInputEvent}
 */
export function createDocumentEvent({ userId, conversationId, fileId, fileName, mimeType, fileSize, messageId, channel = 'unknown', metadata }) {
  return {
    type: InputEventType.DOCUMENT,
    userId,
    conversationId,
    messageId,
    channel,
    timestamp: Date.now(),
    payload: { fileId, fileName, mimeType, fileSize },
    metadata,
  };
}

/**
 * Create an input event of any type (generic factory)
 * @param {Object} params
 * @param {InputEventType} params.type - Event type
 * @param {string} params.userId
 * @param {string} params.conversationId
 * @param {string} [params.messageId]
 * @param {string} [params.channel='unknown']
 * @param {Object} params.payload - Type-specific payload
 * @param {Object} [params.metadata]
 * @returns {IInputEvent}
 */
export function createInputEvent({ type, userId, conversationId, messageId, channel = 'unknown', payload, metadata }) {
  return {
    type,
    userId,
    conversationId,
    messageId,
    channel,
    timestamp: Date.now(),
    payload,
    metadata,
  };
}

// ==================== Validation ====================

/**
 * Validate that an object is a valid IInputEvent
 * @param {Object} obj - Object to validate
 * @returns {boolean}
 */
export function isInputEvent(obj) {
  if (!obj || typeof obj !== 'object') return false;
  
  const requiredFields = ['type', 'userId', 'conversationId', 'channel', 'timestamp', 'payload'];
  const hasRequiredFields = requiredFields.every(field => obj[field] !== undefined);
  
  if (!hasRequiredFields) return false;
  
  // Validate type is known
  const validTypes = Object.values(InputEventType);
  if (!validTypes.includes(obj.type)) return false;
  
  return true;
}

/**
 * Assert that an object is a valid IInputEvent
 * @param {Object} obj - Object to validate
 * @returns {IInputEvent}
 * @throws {Error} if validation fails
 */
export function assertInputEvent(obj) {
  if (!isInputEvent(obj)) {
    throw new Error(`Invalid input event: ${JSON.stringify(obj)}`);
  }
  return obj;
}

// ==================== Utilities ====================

/**
 * Get a human-readable description of an event
 * @param {IInputEvent} event
 * @returns {string}
 */
export function describeEvent(event) {
  const { type, userId, conversationId, payload } = event;
  
  switch (type) {
    case InputEventType.TEXT:
      return `Text from ${userId}: "${payload.text?.substring(0, 50)}..."`;
    case InputEventType.IMAGE:
      return `Image from ${userId}${payload.caption ? `: "${payload.caption}"` : ''}`;
    case InputEventType.VOICE:
      return `Voice from ${userId} (${payload.duration || '?'}s)`;
    case InputEventType.CALLBACK:
      return `Callback from ${userId}: "${payload.data}"`;
    case InputEventType.COMMAND:
      return `Command from ${userId}: /${payload.command}`;
    case InputEventType.UPC:
      return `UPC from ${userId}: ${payload.upc}`;
    case InputEventType.DOCUMENT:
      return `Document from ${userId}: ${payload.fileName || 'unnamed'}`;
    default:
      return `Unknown event from ${userId}`;
  }
}

export default {
  InputEventType,
  createTextEvent,
  createImageEvent,
  createVoiceEvent,
  createCallbackEvent,
  createCommandEvent,
  createUPCEvent,
  createDocumentEvent,
  createInputEvent,
  isInputEvent,
  assertInputEvent,
  describeEvent,
};
