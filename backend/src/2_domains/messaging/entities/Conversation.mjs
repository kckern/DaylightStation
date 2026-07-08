/**
 * Conversation Entity - Represents a chat conversation
 *
 * Aggregate root: holds Message ENTITIES internally (not plain JSON blobs).
 * Persistence (de)hydration is owned by the datastore adapter — see
 * docs/_wip/plans/2026-07-08-serialization-ownership-migration.md.
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { Message } from './Message.mjs';

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
    // Normalize children to Message entities (aggregate invariant)
    this.messages = messages.map(m => (m instanceof Message ? m : new Message(m)));
    this.startedAt = startedAt;
    this.lastMessageAt = lastMessageAt;
    this.metadata = metadata;
  }

  /**
   * Add a message to the conversation
   * @param {Message} message - Message entity (not a plain object)
   */
  addMessage(message) {
    if (!(message instanceof Message)) {
      throw new ValidationError('addMessage requires a Message entity', { code: 'INVALID_MESSAGE', field: 'message' });
    }
    this.messages.push(message);
    this.lastMessageAt = message.timestamp;
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

  // Transitional: retained for API response DTOs (4_api/v1/routers/messaging.mjs).
  // Storage (de)hydration lives in YamlConversationDatastore, NOT here.
  toJSON() {
    return {
      id: this.id,
      participants: this.participants,
      messages: this.messages.map(m => m.toJSON()),
      startedAt: this.startedAt,
      lastMessageAt: this.lastMessageAt,
      metadata: this.metadata
    };
  }
}

export default Conversation;
