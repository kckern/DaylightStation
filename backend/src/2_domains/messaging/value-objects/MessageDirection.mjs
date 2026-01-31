/**
 * MessageDirection Value Object
 * @module messaging/domain/value-objects/MessageDirection
 *
 * Defines message direction constants for the messaging domain.
 * Directions: incoming (received), outgoing (sent)
 */

/**
 * @enum {string}
 */
export const MessageDirection = Object.freeze({
  INCOMING: 'incoming',
  OUTGOING: 'outgoing',
});

/**
 * All valid message directions
 * @type {string[]}
 */
export const MESSAGE_DIRECTIONS = Object.freeze([
  MessageDirection.INCOMING,
  MessageDirection.OUTGOING,
]);

/**
 * Check if a value is a valid message direction
 * @param {string} direction
 * @returns {boolean}
 */
export function isValidMessageDirection(direction) {
  return MESSAGE_DIRECTIONS.includes(direction);
}

export default MessageDirection;
