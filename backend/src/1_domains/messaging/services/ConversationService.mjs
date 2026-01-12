/**
 * ConversationService - Conversation management
 */

import { Conversation } from '../entities/Conversation.mjs';
import { Message } from '../entities/Message.mjs';

export class ConversationService {
  constructor({ conversationStore, logger }) {
    this.conversationStore = conversationStore;
    this.logger = logger || console;
  }

  /**
   * Create a new conversation
   */
  async createConversation({ participants, metadata = {} }) {
    const conversation = new Conversation({
      id: this.generateConversationId(),
      participants,
      messages: [],
      startedAt: new Date().toISOString(),
      metadata
    });

    await this.conversationStore.save(conversation);
    this.logger.info?.('conversation.created', { id: conversation.id, participants });
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
   */
  async getOrCreateConversation(participants, metadata = {}) {
    // Try to find existing conversation
    const existing = await this.conversationStore.findByParticipants(participants);
    if (existing) {
      return Conversation.fromJSON(existing);
    }

    // Create new conversation
    return this.createConversation({ participants, metadata });
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
   */
  async addMessage(conversationId, messageData) {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const message = messageData instanceof Message
      ? messageData
      : new Message({ ...messageData, conversationId });

    conversation.addMessage(message.toJSON());
    await this.conversationStore.save(conversation);

    this.logger.debug?.('conversation.message.added', {
      conversationId,
      messageId: message.id,
      type: message.type
    });

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
   */
  async archiveConversation(conversationId) {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    conversation.metadata.archived = true;
    conversation.metadata.archivedAt = new Date().toISOString();
    await this.conversationStore.save(conversation);

    this.logger.info?.('conversation.archived', { conversationId });
    return conversation;
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId) {
    await this.conversationStore.delete(conversationId);
    this.logger.info?.('conversation.deleted', { conversationId });
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
   */
  generateConversationId() {
    return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export default ConversationService;
