/**
 * MessageType Value Object
 * @module messaging/domain/value-objects/MessageType
 *
 * Defines message type constants for the messaging domain.
 * Types: text, voice, image, document, callback
 */

/**
 * @enum {string}
 */
export const MessageType = Object.freeze({
  TEXT: 'text',
  VOICE: 'voice',
  IMAGE: 'image',
  DOCUMENT: 'document',
  CALLBACK: 'callback',
});

/**
 * All valid message types
 * @type {string[]}
 */
export const MESSAGE_TYPES = Object.freeze([
  MessageType.TEXT,
  MessageType.VOICE,
  MessageType.IMAGE,
  MessageType.DOCUMENT,
  MessageType.CALLBACK,
]);

/**
 * Check if a value is a valid message type
 * @param {string} type
 * @returns {boolean}
 */
export function isValidMessageType(type) {
  return MESSAGE_TYPES.includes(type);
}

export default MessageType;
