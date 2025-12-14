/**
 * Message entity for chat messages
 * @module domain/entities/Message
 */

import { ConversationId } from '../value-objects/ChatId.mjs';
import { MessageId } from '../value-objects/MessageId.mjs';
import { Timestamp } from '../value-objects/Timestamp.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

/**
 * Message types enum
 */
export const MessageType = {
  TEXT: 'text',
  PHOTO: 'photo',
  VOICE: 'voice',
  CALLBACK: 'callback',
  COMMAND: 'command',
};

/**
 * Message directions
 */
export const MessageDirection = {
  INCOMING: 'incoming',
  OUTGOING: 'outgoing',
};

/**
 * Message entity
 * Represents a message in a chat conversation
 */
export class Message {
  /**
   * @param {object} props - Message properties
   * @param {ConversationId|object} props.conversationId - Conversation identifier
   * @param {MessageId|string|number} props.messageId - Message identifier
   * @param {string} props.type - Message type
   * @param {string} props.direction - Message direction
   * @param {Timestamp|Date|string} [props.timestamp] - Message timestamp
   * @param {object} [props.content] - Message content
   * @param {object} [props.metadata] - Additional metadata
   */
  constructor(props) {
    // Validate required fields
    // Support both conversationId and legacy chatId
    const convId = props.conversationId || props.chatId;
    if (!convId) {
      throw new ValidationError('conversationId is required');
    }
    if (!props.messageId) {
      throw new ValidationError('messageId is required');
    }
    if (!props.type || !Object.values(MessageType).includes(props.type)) {
      throw new ValidationError('Invalid message type', { type: props.type });
    }
    if (!props.direction || !Object.values(MessageDirection).includes(props.direction)) {
      throw new ValidationError('Invalid message direction', { direction: props.direction });
    }

    // Convert value objects
    this.conversationId = convId instanceof ConversationId ? convId : ConversationId.from(convId);
    // Alias for backward compatibility
    this.chatId = this.conversationId;
    this.messageId = props.messageId instanceof MessageId ? props.messageId : MessageId.from(props.messageId);
    this.type = props.type;
    this.direction = props.direction;
    this.timestamp = props.timestamp instanceof Timestamp 
      ? props.timestamp 
      : Timestamp.from(props.timestamp || new Date());
    this.content = Object.freeze({ ...props.content });
    this.metadata = Object.freeze({ ...props.metadata });

    // Freeze to ensure immutability
    Object.freeze(this);
  }

  /**
   * Get text content (for text messages)
   * @returns {string|null}
   */
  get text() {
    return this.content?.text || null;
  }

  /**
   * Get photo data (for photo messages)
   * @returns {object|null}
   */
  get photo() {
    return this.content?.photo || null;
  }

  /**
   * Get voice data (for voice messages)
   * @returns {object|null}
   */
  get voice() {
    return this.content?.voice || null;
  }

  /**
   * Get callback data (for callback messages)
   * @returns {string|null}
   */
  get callbackData() {
    return this.content?.callbackData || null;
  }

  /**
   * Check if this is an incoming message
   * @returns {boolean}
   */
  get isIncoming() {
    return this.direction === MessageDirection.INCOMING;
  }

  /**
   * Check if this is an outgoing message
   * @returns {boolean}
   */
  get isOutgoing() {
    return this.direction === MessageDirection.OUTGOING;
  }

  /**
   * Check if this is a command message
   * @returns {boolean}
   */
  get isCommand() {
    return this.type === MessageType.COMMAND;
  }

  /**
   * Convert to plain object
   * @returns {object}
   */
  toJSON() {
    return {
      conversationId: this.conversationId.toJSON(),
      // Include chatId for backward compatibility
      chatId: this.conversationId.toJSON(),
      messageId: this.messageId.toJSON(),
      type: this.type,
      direction: this.direction,
      timestamp: this.timestamp.toJSON(),
      content: this.content,
      metadata: this.metadata,
    };
  }

  /**
   * Create a new Message with updated properties
   * @param {object} updates - Properties to update
   * @returns {Message}
   */
  with(updates) {
    return new Message({
      conversationId: this.conversationId,
      messageId: this.messageId,
      type: this.type,
      direction: this.direction,
      timestamp: this.timestamp,
      content: this.content,
      metadata: this.metadata,
      ...updates,
    });
  }

  /**
   * Create an incoming text message
   * @param {object} props
   * @returns {Message}
   */
  static incomingText(props) {
    return new Message({
      ...props,
      type: MessageType.TEXT,
      direction: MessageDirection.INCOMING,
      content: { text: props.text },
    });
  }

  /**
   * Create an incoming photo message
   * @param {object} props
   * @returns {Message}
   */
  static incomingPhoto(props) {
    return new Message({
      ...props,
      type: MessageType.PHOTO,
      direction: MessageDirection.INCOMING,
      content: { photo: props.photo },
    });
  }

  /**
   * Create an incoming voice message
   * @param {object} props
   * @returns {Message}
   */
  static incomingVoice(props) {
    return new Message({
      ...props,
      type: MessageType.VOICE,
      direction: MessageDirection.INCOMING,
      content: { voice: props.voice },
    });
  }

  /**
   * Create an incoming callback message
   * @param {object} props
   * @returns {Message}
   */
  static incomingCallback(props) {
    return new Message({
      ...props,
      type: MessageType.CALLBACK,
      direction: MessageDirection.INCOMING,
      content: { callbackData: props.callbackData },
    });
  }

  /**
   * Create an outgoing message
   * @param {object} props
   * @returns {Message}
   */
  static outgoing(props) {
    return new Message({
      ...props,
      type: props.type || MessageType.TEXT,
      direction: MessageDirection.OUTGOING,
    });
  }
}

export default Message;
