/**
 * JournalEntry Repository
 * @module journalist/repositories/JournalEntryRepository
 * 
 * Repository for persisting and querying journal entries and message history.
 * Stores data at: users/{username}/lifelog/journalist/messages.yml
 */

import { loadFile, saveFile } from '../../../../lib/io.mjs';
import { createLogger } from '../../../_lib/logging/index.mjs';
import { formatLocalTimestamp } from '../../../_lib/time.mjs';

/**
 * Journal entry repository for persisting conversation messages
 */
export class JournalEntryRepository {
  #config;
  #logger;
  #userResolver;

  /**
   * @param {Object} options
   * @param {Object} options.config - Journalist config with path functions
   * @param {Object} options.userResolver - UserResolver for telegram ID to username mapping
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options) {
    if (!options?.config) {
      throw new Error('config is required');
    }
    if (!options?.userResolver) {
      throw new Error('userResolver is required');
    }
    this.#config = options.config;
    this.#userResolver = options.userResolver;
    this.#logger = options.logger || createLogger({ source: 'repository', app: 'journalist' });
  }

  /**
   * Get user's timezone
   * @private
   * @param {string} conversationId
   * @returns {string}
   */
  #getTimezone(conversationId) {
    const userId = this.#extractUserId(conversationId);
    return this.#config.getUserTimezone?.(userId) || 'America/Los_Angeles';
  }

  /**
   * Get the storage path for a user's journal messages
   * @private
   * @param {string} conversationId - e.g., "telegram:botId_userId"
   * @returns {string}
   */
  #getPath(conversationId) {
    // Extract user ID from conversation ID (format: "telegram:botId_userId")
    const userId = this.#extractUserId(conversationId);
    const username = this.#userResolver.resolveUsername(userId) || userId;
    return `users/${username}/lifelog/journalist/messages`;
  }

  /**
   * Extract user ID from conversation ID
   * @private
   * @param {string} conversationId
   * @returns {string}
   */
  #extractUserId(conversationId) {
    // Format: "telegram:botId_userId" -> extract userId
    if (conversationId.includes('_')) {
      return conversationId.split('_').pop();
    }
    // Fallback: remove "telegram:" prefix if present
    return conversationId.replace(/^telegram:/, '');
  }

  /**
   * Load all messages from storage
   * @private
   * @param {string} path
   * @returns {Object}
   */
  #loadData(path) {
    return loadFile(path) || { messages: [] };
  }

  /**
   * Save a message to the journal
   * @param {Object} message - Message to save
   * @param {string} conversationId
   * @returns {Promise<Object>}
   */
  async save(message, conversationId) {
    const path = this.#getPath(conversationId);
    
    this.#logger.debug('journal.save', { 
      path, 
      role: message.role,
      contentLength: message.content?.length 
    });

    // Load existing data
    const data = this.#loadData(path);
    
    // Ensure messages array exists
    if (!Array.isArray(data.messages)) {
      data.messages = [];
    }

    // Add timestamp if not present
    if (!message.timestamp) {
      message.timestamp = new Date().toISOString();
    }

    // Add message
    data.messages.push(message);

    // Sort messages by timestamp descending (newest first)
    data.messages.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA; // Descending order
    });

    // Save back
    saveFile(path, data);
    
    return message;
  }

  /**
   * Delete a message from the journal
   * @param {string} conversationId
   * @param {string} messageId
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteMessage(conversationId, messageId) {
    const path = this.#getPath(conversationId);
    const data = this.#loadData(path);
    
    if (!data.messages || data.messages.length === 0) {
      return false;
    }

    const initialLength = data.messages.length;
    // Filter out message by id or messageId
    data.messages = data.messages.filter(msg => {
      const id = msg.id || msg.messageId;
      return id.toString() !== messageId.toString();
    });

    if (data.messages.length !== initialLength) {
      saveFile(path, data);
      this.#logger.debug('journal.delete', { conversationId, messageId });
      return true;
    }

    return false;
  }

  /**
   * Save a ConversationMessage entity
   * @param {Object} message - ConversationMessage entity
   * @returns {Promise<Object>}
   */
  async saveMessage(message) {
    // Extract conversationId from message (chatId field)
    const conversationId = message.chatId || message.conversationId;
    if (!conversationId) {
      throw new Error('Message must have chatId or conversationId');
    }

    // Get timezone for local timestamp
    const timezone = this.#getTimezone(conversationId);
    const localTimestamp = formatLocalTimestamp(new Date(), timezone);

    // Convert to plain object for storage
    const messageData = {
      id: message.messageId || message.id,
      role: message.role,
      content: message.text || message.content,
      senderId: message.senderId || this.#extractUserId(conversationId),
      senderName: message.senderName,
      timestamp: localTimestamp,
    };

    return this.save(messageData, conversationId);
  }

  /**
   * Get recent message history for context
   * @param {string} conversationId
   * @param {number} [limit=20] - Max messages to return
   * @returns {Promise<Array>} Messages in chronological order (oldest first)
   */
  async getMessageHistory(conversationId, limit = 20) {
    const path = this.#getPath(conversationId);
    
    this.#logger.debug('journal.getHistory', { path, limit });

    const data = this.#loadData(path);
    const messages = data.messages || [];

    // File is stored newest-first (descending), so take first N and reverse for chronological order
    return messages.slice(0, limit).reverse().map(msg => ({
      ...msg,
      text: msg.content || msg.text,  // Normalize content -> text
    }));
  }

  /**
   * Get all messages for a conversation
   * @param {string} conversationId
   * @returns {Promise<Array>}
   */
  async findAll(conversationId) {
    const path = this.#getPath(conversationId);
    const data = this.#loadData(path);
    // Return in chronological order (reverse of stored order)
    return (data.messages || []).slice().reverse();
  }

  /**
   * Find messages by date range
   * @param {string} conversationId
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Promise<Array>}
   */
  async findByDateRange(conversationId, startDate, endDate) {
    const messages = await this.findAll(conversationId);
    
    return messages.filter(msg => {
      if (!msg.timestamp) return false;
      const msgDate = msg.timestamp.split('T')[0];
      return msgDate >= startDate && msgDate <= endDate;
    });
  }

  /**
   * Find messages by date
   * @param {string} conversationId
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<Array>}
   */
  async findByDate(conversationId, date) {
    const messages = await this.findAll(conversationId);
    
    return messages.filter(msg => {
      if (!msg.timestamp) return false;
      return msg.timestamp.startsWith(date);
    });
  }

  /**
   * Find recent messages within N days
   * @param {string} conversationId
   * @param {number} days
   * @returns {Promise<Array>}
   */
  async findRecent(conversationId, days = 7) {
    const messages = await this.findAll(conversationId);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    return messages.filter(msg => {
      if (!msg.timestamp) return false;
      return new Date(msg.timestamp) >= cutoff;
    });
  }

  /**
   * Get recent bot messages (for deletion on cancel)
   * @param {string} conversationId
   * @param {number} [limit=1] - Number of recent bot messages to return
   * @returns {Promise<Array>}
   */
  async getRecentBotMessages(conversationId, limit = 1) {
    const messages = await this.findAll(conversationId);
    
    // Filter to bot messages only and get most recent
    const botMessages = messages
      .filter(msg => msg.senderId === 'bot' || msg.role === 'assistant')
      .slice(-limit);
    
    // Normalize to expected format
    return botMessages.map(msg => ({
      ...msg,
      messageId: msg.id,
      text: msg.content || msg.text,
    }));
  }
}

export default JournalEntryRepository;
