/**
 * ConversationId value object - channel-agnostic conversation identifier
 * @module domains/messaging/value-objects/ConversationId
 *
 * This is the INTERNAL identifier used throughout the domain layer.
 * Transport adapters (Telegram, Discord, etc.) are responsible for
 * mapping their native IDs to/from ConversationId.
 */

import { ValidationError } from '../../core/errors/index.mjs';

/**
 * ConversationId value object
 * Immutable, channel-agnostic identifier for a conversation
 *
 * Format: "{channel}:{identifier}" where:
 * - channel: The source channel (telegram, discord, slack, etc.)
 * - identifier: Channel-specific unique identifier (opaque to domain)
 */
export class ConversationId {
  /** @type {string} */
  #channel;

  /** @type {string} */
  #identifier;

  /**
   * @param {string} channel - Channel name (e.g., 'telegram', 'discord')
   * @param {string} identifier - Channel-specific identifier (opaque string)
   */
  constructor(channel, identifier) {
    if (!channel || typeof channel !== 'string') {
      throw new ValidationError('channel is required and must be a string', { channel });
    }
    if (!identifier || typeof identifier !== 'string') {
      throw new ValidationError('identifier is required and must be a string', { identifier });
    }

    // Normalize channel to lowercase
    this.#channel = channel.toLowerCase();
    this.#identifier = identifier;

    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Get the channel name
   * @returns {string}
   */
  get channel() {
    return this.#channel;
  }

  /**
   * Get the identifier (opaque to domain)
   * @returns {string}
   */
  get identifier() {
    return this.#identifier;
  }

  /**
   * Convert to string representation (for storage keys, etc.)
   * @returns {string} Format: "{channel}:{identifier}"
   */
  toString() {
    return `${this.#channel}:${this.#identifier}`;
  }

  /**
   * Convert to JSON-serializable object
   * @returns {object}
   */
  toJSON() {
    return {
      channel: this.#channel,
      identifier: this.#identifier,
    };
  }

  /**
   * Check equality with another ConversationId
   * @param {ConversationId} other
   * @returns {boolean}
   */
  equals(other) {
    if (!(other instanceof ConversationId)) return false;
    return this.#channel === other.channel && this.#identifier === other.identifier;
  }

  /**
   * Parse a ConversationId from string representation
   * @param {string} str - String in format "{channel}:{identifier}"
   * @returns {ConversationId}
   * @throws {ValidationError}
   */
  static parse(str) {
    if (!str || typeof str !== 'string') {
      throw new ValidationError('ConversationId string is required', { str });
    }

    const colonIndex = str.indexOf(':');
    if (colonIndex === -1) {
      throw new ValidationError('Invalid ConversationId format. Expected "{channel}:{identifier}"', { str });
    }

    const channel = str.substring(0, colonIndex);
    const identifier = str.substring(colonIndex + 1);

    if (!channel || !identifier) {
      throw new ValidationError('Invalid ConversationId format. Both channel and identifier required', { str });
    }

    return new ConversationId(channel, identifier);
  }

  /**
   * Create a ConversationId from an object or string
   * @param {object|string|ConversationId} obj
   * @returns {ConversationId}
   */
  static from(obj) {
    if (obj instanceof ConversationId) return obj;

    if (typeof obj === 'string') {
      return ConversationId.parse(obj);
    }

    return new ConversationId(obj.channel, obj.identifier);
  }

  /**
   * Create a factory for a specific channel
   * @param {string} channel - Channel name
   * @returns {(identifier: string) => ConversationId}
   */
  static forChannel(channel) {
    return (identifier) => new ConversationId(channel, identifier);
  }
}

// Keep ChatId as an alias for backward compatibility during migration
export const ChatId = ConversationId;

export default ConversationId;
