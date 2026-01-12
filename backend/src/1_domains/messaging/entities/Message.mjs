/**
 * Message Entity - Represents a single message in a conversation
 */

export const MESSAGE_TYPES = ['text', 'voice', 'image', 'document', 'callback'];

export class Message {
  constructor({
    id,
    conversationId,
    senderId,
    recipientId,
    type = 'text',
    content,
    timestamp,
    metadata = {}
  }) {
    this.id = id;
    this.conversationId = conversationId;
    this.senderId = senderId;
    this.recipientId = recipientId;
    this.type = type;
    this.content = content;
    this.timestamp = timestamp || new Date().toISOString();
    this.metadata = metadata;
  }

  /**
   * Check if message is text type
   */
  isText() {
    return this.type === 'text';
  }

  /**
   * Check if message is voice type
   */
  isVoice() {
    return this.type === 'voice';
  }

  /**
   * Check if message is image type
   */
  isImage() {
    return this.type === 'image';
  }

  /**
   * Check if message is a callback (button press)
   */
  isCallback() {
    return this.type === 'callback';
  }

  /**
   * Get text content (for text and callback types)
   */
  getText() {
    if (this.isText() || this.isCallback()) {
      return typeof this.content === 'string' ? this.content : this.content?.text || '';
    }
    return this.metadata.caption || '';
  }

  /**
   * Get age in milliseconds
   */
  getAgeMs() {
    return Date.now() - new Date(this.timestamp).getTime();
  }

  /**
   * Get age in minutes
   */
  getAgeMinutes() {
    return Math.floor(this.getAgeMs() / 60000);
  }

  /**
   * Check if message is from a specific sender
   */
  isFrom(senderId) {
    return this.senderId === senderId;
  }

  /**
   * Check if message is recent (within threshold minutes)
   */
  isRecent(thresholdMinutes = 5) {
    return this.getAgeMinutes() <= thresholdMinutes;
  }

  toJSON() {
    return {
      id: this.id,
      conversationId: this.conversationId,
      senderId: this.senderId,
      recipientId: this.recipientId,
      type: this.type,
      content: this.content,
      timestamp: this.timestamp,
      metadata: this.metadata
    };
  }

  static fromJSON(data) {
    return new Message(data);
  }

  /**
   * Create a text message
   */
  static createText({ conversationId, senderId, recipientId, text, metadata = {} }) {
    return new Message({
      id: Message.generateId(),
      conversationId,
      senderId,
      recipientId,
      type: 'text',
      content: text,
      metadata
    });
  }

  /**
   * Create a voice message
   */
  static createVoice({ conversationId, senderId, recipientId, fileId, duration, metadata = {} }) {
    return new Message({
      id: Message.generateId(),
      conversationId,
      senderId,
      recipientId,
      type: 'voice',
      content: { fileId, duration },
      metadata
    });
  }

  /**
   * Create an image message
   */
  static createImage({ conversationId, senderId, recipientId, fileId, caption, metadata = {} }) {
    return new Message({
      id: Message.generateId(),
      conversationId,
      senderId,
      recipientId,
      type: 'image',
      content: { fileId },
      metadata: { ...metadata, caption }
    });
  }

  /**
   * Create a callback message (button press)
   */
  static createCallback({ conversationId, senderId, recipientId, callbackData, metadata = {} }) {
    return new Message({
      id: Message.generateId(),
      conversationId,
      senderId,
      recipientId,
      type: 'callback',
      content: callbackData,
      metadata
    });
  }

  /**
   * Generate a unique message ID
   */
  static generateId() {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export default Message;
