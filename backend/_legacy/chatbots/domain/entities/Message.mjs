/**
 * Message entity for chat messages
 * @module domain/entities/Message
 */

import { ConversationId } from '../value-objects/ChatId.mjs';
import { MessageId } from '../value-objects/MessageId.mjs';
import { Timestamp } from '../value-objects/Timestamp.mjs';
import { Attachment } from '../value-objects/Attachment.mjs';
import { ValidationError } from '../../_lib/errors/index.mjs';

/**
 * Message types enum
 * Note: A message can have both text AND attachments (e.g., photo with caption)
 * The type indicates the PRIMARY content type or special message types
 */
export const MessageType = {
  TEXT: 'text',           // Text only (no attachments)
  PHOTO: 'photo',         // Photo message (may have caption text)
  VOICE: 'voice',         // Voice message (may have caption text)
  AUDIO: 'audio',         // Audio file (may have caption text)
  VIDEO: 'video',         // Video message (may have caption text)
  DOCUMENT: 'document',   // Document/file (may have caption text)
  CALLBACK: 'callback',   // Button callback
  COMMAND: 'command',     // Bot command
  MEDIA_GROUP: 'media_group', // Multiple photos/videos
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
 * 
 * Messages can have:
 * - text: The text content or caption
 * - attachments: Array of Attachment objects (photos, voice, etc.)
 * - Both text AND attachments (e.g., photo with caption)
 */
export class Message {
  /**
   * @param {object} props - Message properties
   * @param {ConversationId|object} props.conversationId - Conversation identifier
   * @param {MessageId|string|number} props.messageId - Message identifier
   * @param {string} props.type - Message type
   * @param {string} props.direction - Message direction
   * @param {Timestamp|Date|string} [props.timestamp] - Message timestamp
   * @param {string} [props.text] - Text content or caption
   * @param {Array<Attachment>} [props.attachments] - Media attachments
   * @param {object} [props.content] - Legacy content object (for backward compatibility)
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
    
    // Handle text - can be direct prop or in content
    this._text = props.text || props.content?.text || null;
    
    // Handle attachments
    this._attachments = this.#normalizeAttachments(props);
    
    // Legacy content support (for backward compatibility)
    this.content = Object.freeze({ 
      text: this._text,
      photo: props.content?.photo || (this._attachments.find(a => a.isPhoto)?.toJSON() || null),
      voice: props.content?.voice || (this._attachments.find(a => a.isVoice)?.toJSON() || null),
      callbackData: props.content?.callbackData || null,
      ...props.content,
    });
    
    this.metadata = Object.freeze({ ...props.metadata });

    // Freeze to ensure immutability
    Object.freeze(this._attachments);
    Object.freeze(this);
  }

  /**
   * Normalize attachments from various input formats
   * @private
   */
  #normalizeAttachments(props) {
    const attachments = [];

    // Direct attachments array
    if (Array.isArray(props.attachments)) {
      for (const att of props.attachments) {
        attachments.push(att instanceof Attachment ? att : Attachment.from(att));
      }
    }

    // Legacy photo in content
    if (props.content?.photo && !attachments.some(a => a.isPhoto)) {
      const photo = props.content.photo;
      if (photo.fileId || photo.url || photo.localPath || photo.buffer) {
        attachments.push(Attachment.photo(photo));
      }
    }

    // Legacy voice in content
    if (props.content?.voice && !attachments.some(a => a.isVoice)) {
      const voice = props.content.voice;
      if (voice.fileId || voice.url || voice.localPath || voice.buffer) {
        attachments.push(Attachment.voice(voice));
      }
    }

    return attachments;
  }

  // ==================== Content Accessors ====================

  /**
   * Get text content (or caption for media messages)
   * @returns {string|null}
   */
  get text() {
    return this._text;
  }

  /**
   * Get caption (alias for text, clearer for media messages)
   * @returns {string|null}
   */
  get caption() {
    return this._text;
  }

  /**
   * Get all attachments
   * @returns {Array<Attachment>}
   */
  get attachments() {
    return this._attachments;
  }

  /**
   * Check if message has attachments
   * @returns {boolean}
   */
  get hasAttachments() {
    return this._attachments.length > 0;
  }

  /**
   * Get first photo attachment (convenience)
   * @returns {Attachment|null}
   */
  get photo() {
    return this._attachments.find(a => a.isPhoto) || null;
  }

  /**
   * Get all photo attachments
   * @returns {Array<Attachment>}
   */
  get photos() {
    return this._attachments.filter(a => a.isPhoto);
  }

  /**
   * Get first voice attachment (convenience)
   * @returns {Attachment|null}
   */
  get voice() {
    return this._attachments.find(a => a.isVoice) || null;
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
      text: this._text,
      attachments: this._attachments.map(a => a.toJSON()),
      // Legacy content for backward compatibility
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
      text: this._text,
      attachments: this._attachments,
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
      text: props.text,
      content: { text: props.text },
    });
  }

  /**
   * Create an incoming photo message
   * @param {object} props
   * @param {string} [props.caption] - Photo caption
   * @param {Attachment|object} props.photo - Photo attachment
   * @param {Array<Attachment|object>} [props.attachments] - Multiple photos
   * @returns {Message}
   */
  static incomingPhoto(props) {
    const attachments = props.attachments || [];
    if (props.photo && !attachments.length) {
      attachments.push(props.photo instanceof Attachment ? props.photo : Attachment.photo(props.photo));
    }
    
    return new Message({
      ...props,
      type: attachments.length > 1 ? MessageType.MEDIA_GROUP : MessageType.PHOTO,
      direction: MessageDirection.INCOMING,
      text: props.caption || props.text,
      attachments,
      content: { 
        text: props.caption || props.text,
        photo: props.photo,
      },
    });
  }

  /**
   * Create an incoming voice message
   * @param {object} props
   * @param {string} [props.caption] - Voice caption (if any)
   * @param {Attachment|object} props.voice - Voice attachment
   * @returns {Message}
   */
  static incomingVoice(props) {
    const attachment = props.voice instanceof Attachment 
      ? props.voice 
      : Attachment.voice(props.voice);
    
    return new Message({
      ...props,
      type: MessageType.VOICE,
      direction: MessageDirection.INCOMING,
      text: props.caption || props.text,
      attachments: [attachment],
      content: { 
        text: props.caption || props.text,
        voice: props.voice,
      },
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

  /**
   * Create an outgoing photo message
   * @param {object} props
   * @param {string} [props.caption] - Photo caption
   * @param {Attachment|object} props.photo - Photo attachment
   * @returns {Message}
   */
  static outgoingPhoto(props) {
    const attachment = props.photo instanceof Attachment 
      ? props.photo 
      : Attachment.photo(props.photo);
    
    return new Message({
      ...props,
      type: MessageType.PHOTO,
      direction: MessageDirection.OUTGOING,
      text: props.caption || props.text,
      attachments: [attachment],
    });
  }
}

export default Message;
