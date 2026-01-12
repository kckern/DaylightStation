/**
 * Conversation Entity - Represents a chat conversation
 */

export class Conversation {
  constructor({
    id,
    participants = [],
    messages = [],
    startedAt,
    lastMessageAt = null,
    metadata = {}
  }) {
    this.id = id;
    this.participants = participants;
    this.messages = messages;
    this.startedAt = startedAt;
    this.lastMessageAt = lastMessageAt;
    this.metadata = metadata;
  }

  /**
   * Add a message to the conversation
   */
  addMessage(message) {
    this.messages.push({
      ...message,
      timestamp: message.timestamp || new Date().toISOString()
    });
    this.lastMessageAt = this.messages[this.messages.length - 1].timestamp;
  }

  /**
   * Get message count
   */
  getMessageCount() {
    return this.messages.length;
  }

  /**
   * Get messages by participant
   */
  getMessagesByParticipant(participantId) {
    return this.messages.filter(m => m.senderId === participantId);
  }

  /**
   * Get latest message
   */
  getLatestMessage() {
    return this.messages[this.messages.length - 1] || null;
  }

  /**
   * Check if participant is in conversation
   */
  hasParticipant(participantId) {
    return this.participants.includes(participantId);
  }

  /**
   * Add participant
   */
  addParticipant(participantId) {
    if (!this.hasParticipant(participantId)) {
      this.participants.push(participantId);
    }
  }

  toJSON() {
    return {
      id: this.id,
      participants: this.participants,
      messages: this.messages,
      startedAt: this.startedAt,
      lastMessageAt: this.lastMessageAt,
      metadata: this.metadata
    };
  }

  static fromJSON(data) {
    return new Conversation(data);
  }
}

export default Conversation;
