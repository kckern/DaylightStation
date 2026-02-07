/**
 * YamlJournalEntryRepository - YAML-based journal entry persistence
 *
 * Implements IJournalEntryRepository port for journal message storage.
 * Data stored at: users/{username}/lifelog/journalist/messages.yml
 *
 * @module adapters/persistence/yaml
 */

import path from 'path';
import { nowTs24 } from '#system/utils/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class YamlJournalEntryRepository {
  #dataService;
  #userResolver;
  #configService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.dataService - DataService for YAML I/O
   * @param {Object} config.userResolver - UserResolver for telegram ID to username mapping
   * @param {Object} [config.configService] - ConfigService for timezone lookup
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config.dataService) {
      throw new InfrastructureError('YamlJournalEntryRepository requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService'
      });
    }
    this.#dataService = config.dataService;
    this.#userResolver = config.userResolver;
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Extract platform from conversation ID
   * @private
   */
  #extractPlatform(conversationId) {
    // Format: "telegram:..." -> "telegram"
    const colonIdx = conversationId.indexOf(':');
    return colonIdx > 0 ? conversationId.substring(0, colonIdx) : null;
  }

  /**
   * Extract user ID from conversation ID
   * @private
   */
  #extractUserId(conversationId) {
    // Format: "telegram:botId_userId" or "telegram:b{botId}_c{chatId}" -> extract userId
    if (conversationId.includes('_')) {
      const raw = conversationId.split('_').pop();
      // Strip canonical 'c' prefix from chat IDs (e.g. "c575596036" -> "575596036")
      return raw.replace(/^c/, '');
    }
    // Fallback: remove "telegram:" prefix if present
    return conversationId.replace(/^telegram:/, '');
  }

  /**
   * Get username from conversation ID
   * @private
   */
  #getUsername(conversationId) {
    const userId = this.#extractUserId(conversationId);
    const platform = this.#extractPlatform(conversationId);
    if (platform && this.#userResolver?.resolveUser) {
      return this.#userResolver.resolveUser(platform, userId) || userId;
    }
    return userId;
  }

  /**
   * Get timezone for a conversation
   * @private
   */
  #getTimezone(conversationId) {
    const userId = this.#extractUserId(conversationId);
    return this.#configService?.getUserTimezone?.(userId) || 'America/Los_Angeles';
  }

  /**
   * Get username and relative path for journal messages
   * @private
   * @returns {{ username: string, relativePath: string }}
   */
  #getStorageInfo(conversationId) {
    const username = this.#getUsername(conversationId);
    return {
      username,
      relativePath: 'lifelog/journalist/messages'
    };
  }

  /**
   * Load data from YAML file
   * @private
   */
  #loadData(conversationId) {
    const { username, relativePath } = this.#getStorageInfo(conversationId);
    const data = this.#dataService.user.read(relativePath, username);
    return data || { messages: [] };
  }

  /**
   * Save data to YAML file
   * @private
   */
  #saveData(conversationId, data) {
    const { username, relativePath } = this.#getStorageInfo(conversationId);
    const result = this.#dataService.user.write(relativePath, data, username);
    if (!result) {
      this.#logger.error?.('journal.save.failed', { username, relativePath });
    }
    return result;
  }

  /**
   * Format timestamp for local timezone
   * @private
   */
  #formatLocalTimestamp(date, timezone) {
    // Simple ISO format with timezone awareness
    const d = date instanceof Date ? date : new Date(date);
    return d.toISOString();
  }

  // ===========================================================================
  // IJournalEntryRepository Implementation
  // ===========================================================================

  /**
   * Save a journal entry/message
   * @param {Object} entry - Entry to save
   * @param {string} conversationId - Conversation ID (chatId)
   * @returns {Promise<Object>}
   */
  async save(entry, conversationId) {
    // Handle both (entry, conversationId) and entry-with-chatId patterns
    const chatId = conversationId || entry.chatId || entry.conversationId;
    if (!chatId) {
      throw new InfrastructureError('conversationId or entry.chatId is required', {
        code: 'MISSING_CONFIG',
        field: 'chatId'
      });
    }

    const { username, relativePath } = this.#getStorageInfo(chatId);

    this.#logger.debug?.('journal.save', {
      username,
      relativePath,
      role: entry.role,
      contentLength: entry.content?.length || entry.text?.length
    });

    // Load existing data
    const data = this.#loadData(chatId);

    // Ensure messages array exists
    if (!Array.isArray(data.messages)) {
      data.messages = [];
    }

    // Prepare message for storage
    const message = {
      id: entry.id || entry.messageId || `msg-${Date.now()}`,
      role: entry.role,
      content: entry.content || entry.text,
      senderId: entry.senderId || this.#extractUserId(chatId),
      senderName: entry.senderName,
      timestamp: entry.timestamp || nowTs24()
    };

    // Add message
    data.messages.push(message);

    // Sort messages by timestamp descending (newest first)
    data.messages.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA;
    });

    // Save back
    this.#saveData(chatId, data);

    return message;
  }

  /**
   * Find entry by ID
   * @param {string} uuid - Entry ID
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object|null>}
   */
  async findById(uuid, conversationId) {
    if (!conversationId) return null;

    const messages = await this.findAll(conversationId);
    return messages.find(m => (m.id || m.messageId) === uuid) || null;
  }

  /**
   * Find all entries for a conversation
   * @param {string} conversationId - Conversation ID (chatId)
   * @returns {Promise<Object[]>}
   */
  async findAll(conversationId) {
    const data = this.#loadData(conversationId);
    // Return in chronological order (reverse of stored order)
    return (data.messages || []).slice().reverse();
  }

  /**
   * Update an entry
   * @param {Object} entry - Entry with updates
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>}
   */
  async update(entry, conversationId) {
    const chatId = conversationId || entry.chatId || entry.conversationId;
    const data = this.#loadData(chatId);

    const id = entry.id || entry.messageId;
    const index = (data.messages || []).findIndex(m =>
      (m.id || m.messageId) === id
    );

    if (index === -1) {
      throw new InfrastructureError(`Entry not found: ${id}`, {
        code: 'NOT_FOUND',
        entity: 'Entry'
      });
    }

    data.messages[index] = { ...data.messages[index], ...entry };
    this.#saveData(chatId, data);

    return data.messages[index];
  }

  /**
   * Delete an entry
   * @param {string} uuid - Entry ID
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<void>}
   */
  async delete(uuid, conversationId) {
    if (!conversationId) return;

    const data = this.#loadData(conversationId);

    if (!data.messages || data.messages.length === 0) return;

    const initialLength = data.messages.length;
    data.messages = data.messages.filter(msg => {
      const id = msg.id || msg.messageId;
      return id?.toString() !== uuid?.toString();
    });

    if (data.messages.length !== initialLength) {
      this.#saveData(conversationId, data);
      this.#logger.debug?.('journal.delete', { conversationId, uuid });
    }
  }

  /**
   * Check if entry exists
   * @param {string} uuid - Entry ID
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<boolean>}
   */
  async exists(uuid, conversationId) {
    const entry = await this.findById(uuid, conversationId);
    return !!entry;
  }

  /**
   * Find entries by date range
   * @param {string} conversationId - Conversation ID
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Promise<Object[]>}
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
   * Find entries by date
   * @param {string} conversationId - Conversation ID
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<Object[]>}
   */
  async findByDate(conversationId, date) {
    const messages = await this.findAll(conversationId);

    return messages.filter(msg => {
      if (!msg.timestamp) return false;
      return msg.timestamp.startsWith(date);
    });
  }

  /**
   * Find recent entries within N days
   * @param {string} conversationId - Conversation ID
   * @param {number} days - Number of days to look back
   * @returns {Promise<Object[]>}
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
   * Get message history for context
   * @param {string} conversationId - Conversation ID
   * @param {number} limit - Max messages to return
   * @returns {Promise<Object[]>}
   */
  async getMessageHistory(conversationId, limit = 20) {
    const { username, relativePath } = this.#getStorageInfo(conversationId);

    this.#logger.debug?.('journal.getHistory', { username, relativePath, limit });

    const data = this.#loadData(conversationId);
    const messages = data.messages || [];

    // File is stored newest-first (descending), so take first N and reverse
    return messages.slice(0, limit).reverse().map(msg => ({
      ...msg,
      text: msg.content || msg.text
    }));
  }

  /**
   * Aggregate entries by date
   * @param {string} conversationId - Conversation ID
   * @param {string} startDate - YYYY-MM-DD
   * @returns {Promise<Array<{date: string, entries: Object[]}>>}
   */
  async aggregateByDate(conversationId, startDate) {
    const messages = await this.findAll(conversationId);
    const byDate = {};

    for (const msg of messages) {
      if (!msg.timestamp) continue;
      const date = msg.timestamp.split('T')[0];
      if (startDate && date < startDate) continue;

      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(msg);
    }

    return Object.entries(byDate)
      .map(([date, entries]) => ({ date, entries }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get recent bot messages (for deletion on cancel)
   * @param {string} conversationId - Conversation ID
   * @param {number} limit - Number of recent bot messages
   * @returns {Promise<Object[]>}
   */
  async getRecentBotMessages(conversationId, limit = 1) {
    const messages = await this.findAll(conversationId);

    // Filter to bot messages only and get most recent
    const botMessages = messages
      .filter(msg => msg.senderId === 'bot' || msg.role === 'assistant')
      .slice(-limit);

    return botMessages.map(msg => ({
      ...msg,
      messageId: msg.id,
      text: msg.content || msg.text
    }));
  }

  /**
   * Save a ConversationMessage entity
   * @param {Object} message - ConversationMessage entity
   * @returns {Promise<Object>}
   */
  async saveMessage(message) {
    const conversationId = message.chatId || message.conversationId;
    if (!conversationId) {
      throw new InfrastructureError('Message must have chatId or conversationId', {
        code: 'VALIDATION_ERROR'
      });
    }

    const timezone = this.#getTimezone(conversationId);
    const localTimestamp = this.#formatLocalTimestamp(new Date(), timezone);

    const messageData = {
      id: message.messageId || message.id,
      role: message.role,
      content: message.text || message.content,
      senderId: message.senderId || this.#extractUserId(conversationId),
      senderName: message.senderName,
      timestamp: localTimestamp
    };

    return this.save(messageData, conversationId);
  }
}

export default YamlJournalEntryRepository;
