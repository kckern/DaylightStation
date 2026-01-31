/**
 * ConversationService - Conversation management
 */

import { Conversation } from '../entities/Conversation.mjs';
import { Message } from '../entities/Message.mjs';
import { ValidationError, EntityNotFoundError } from '../../core/errors/index.mjs';

export class ConversationService {
  constructor({ conversationStore }) {
    this.conversationStore = conversationStore;
  }

  /**
   * Create a new conversation
   * @param {Object} params
   * @param {number} params.nowMs - Current time in milliseconds (required)
   * @param {string} params.timestamp - Formatted timestamp string (required)
   */
  async createConversation({ participants, nowMs, timestamp, metadata = {} }) {
    if (typeof nowMs !== 'number') {
      throw new ValidationError('nowMs timestamp required', { code: 'MISSING_TIMESTAMP', field: 'nowMs' });
    }
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    const conversation = new Conversation({
      id: this.generateConversationId(nowMs),
      participants,
      messages: [],
      startedAt: timestamp,
      metadata
    });

    await this.conversationStore.save(conversation);
    return conversation;
  }

  /**
   * Get conversation by ID
   */
  async getConversation(id) {
    const data = await this.conversationStore.findById(id);
    return data ? Conversation.fromJSON(data) : null;
  }

  /**
   * Get or create conversation between participants
   * @param {Array} participants
   * @param {number} nowMs - Current time in milliseconds (required for creation)
   * @param {string} timestamp - Formatted timestamp string (required for creation)
   * @param {Object} metadata
   */
  async getOrCreateConversation(participants, nowMs, timestamp, metadata = {}) {
    // Try to find existing conversation
    const existing = await this.conversationStore.findByParticipants(participants);
    if (existing) {
      return Conversation.fromJSON(existing);
    }

    // Create new conversation
    return this.createConversation({ participants, nowMs, timestamp, metadata });
  }

  /**
   * Get conversations for a participant
   */
  async getConversationsForParticipant(participantId) {
    const conversations = await this.conversationStore.findByParticipant(participantId);
    return conversations.map(c => Conversation.fromJSON(c));
  }

  /**
   * Get active conversations (with recent messages)
   */
  async getActiveConversations(thresholdMinutes = 60) {
    const conversations = await this.conversationStore.findActive(thresholdMinutes);
    return conversations.map(c => Conversation.fromJSON(c));
  }

  /**
   * Add a message to a conversation
   * @param {string} conversationId
   * @param {Object} messageData
   * @param {string} timestamp - Formatted timestamp string (required if not in messageData)
   */
  async addMessage(conversationId, messageData, timestamp) {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new EntityNotFoundError('Conversation', conversationId);
    }

    const effectiveTimestamp = messageData.timestamp || timestamp;
    if (!effectiveTimestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    const message = messageData instanceof Message
      ? messageData
      : new Message({ ...messageData, conversationId, timestamp: effectiveTimestamp });

    conversation.addMessage(message.toJSON());
    await this.conversationStore.save(conversation);

    return message;
  }

  /**
   * Get messages from a conversation
   */
  async getMessages(conversationId, options = {}) {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      return [];
    }

    let messages = conversation.messages.map(m => Message.fromJSON(m));

    // Apply filters
    if (options.senderId) {
      messages = messages.filter(m => m.senderId === options.senderId);
    }
    if (options.type) {
      messages = messages.filter(m => m.type === options.type);
    }
    if (options.since) {
      const sinceDate = new Date(options.since);
      messages = messages.filter(m => new Date(m.timestamp) > sinceDate);
    }

    // Apply limit
    if (options.limit) {
      messages = messages.slice(-options.limit);
    }

    return messages;
  }

  /**
   * Get recent messages (last N messages)
   */
  async getRecentMessages(conversationId, limit = 10) {
    return this.getMessages(conversationId, { limit });
  }

  /**
   * Get conversation summary
   */
  async getConversationSummary(conversationId) {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      return null;
    }

    return {
      id: conversation.id,
      participants: conversation.participants,
      messageCount: conversation.getMessageCount(),
      startedAt: conversation.startedAt,
      lastMessageAt: conversation.lastMessageAt,
      latestMessage: conversation.getLatestMessage()
    };
  }

  /**
   * Archive a conversation
   * @param {string} conversationId
   * @param {string} timestamp - Formatted timestamp string (required)
   */
  async archiveConversation(conversationId, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new EntityNotFoundError('Conversation', conversationId);
    }

    conversation.metadata.archived = true;
    conversation.metadata.archivedAt = timestamp;
    await this.conversationStore.save(conversation);

    return conversation;
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId) {
    await this.conversationStore.delete(conversationId);
  }

  /**
   * Get conversation statistics
   */
  async getStatistics(conversationId) {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      return null;
    }

    const messages = conversation.messages;
    const byParticipant = {};
    const byType = {};

    for (const msg of messages) {
      // Count by participant
      byParticipant[msg.senderId] = (byParticipant[msg.senderId] || 0) + 1;
      // Count by type
      byType[msg.type] = (byType[msg.type] || 0) + 1;
    }

    return {
      conversationId,
      totalMessages: messages.length,
      byParticipant,
      byType,
      duration: conversation.lastMessageAt
        ? new Date(conversation.lastMessageAt) - new Date(conversation.startedAt)
        : 0
    };
  }

  /**
   * Generate a unique conversation ID
   * @param {number} nowMs - Current time in milliseconds (required)
   * @returns {string}
   */
  generateConversationId(nowMs) {
    if (typeof nowMs !== 'number') {
      throw new ValidationError('nowMs timestamp required for generateConversationId', { code: 'MISSING_TIMESTAMP', field: 'nowMs' });
    }
    return `conv-${nowMs}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export default ConversationService;
