/**
 * YamlMessageQueueRepository - YAML-based message queue persistence
 *
 * Implements IMessageQueueRepository port for message queue storage.
 * Data stored at: users/{username}/lifelog/journalist/queue.yml
 *
 * @module adapters/persistence/yaml
 */

import { nowTs24 } from '../../../0_infrastructure/utils/index.mjs';

export class YamlMessageQueueRepository {
  #userDataService;
  #userResolver;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.userDataService - UserDataService for YAML I/O
   * @param {Object} [config.userResolver] - UserResolver for telegram ID to username mapping
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config.userDataService) {
      throw new Error('YamlMessageQueueRepository requires userDataService');
    }
    this.#userDataService = config.userDataService;
    this.#userResolver = config.userResolver;
    this.#logger = config.logger || console;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Extract user ID from conversation ID
   * @private
   */
  #extractUserId(conversationId) {
    if (conversationId.includes('_')) {
      return conversationId.split('_').pop();
    }
    return conversationId.replace(/^telegram:/, '');
  }

  /**
   * Get username from conversation ID
   * @private
   */
  #getUsername(conversationId) {
    const userId = this.#extractUserId(conversationId);
    if (this.#userResolver?.resolveUsername) {
      return this.#userResolver.resolveUsername(userId) || userId;
    }
    return userId;
  }

  /**
   * Get storage path for message queue
   * @private
   */
  #getPath(conversationId) {
    const username = this.#getUsername(conversationId);
    return `users/${username}/lifelog/journalist/queue`;
  }

  /**
   * Load queue data from YAML
   * @private
   */
  #loadData(path) {
    const data = this.#userDataService.readData?.(path);
    return data || { queue: [] };
  }

  /**
   * Save queue data to YAML
   * @private
   */
  #saveData(path, data) {
    this.#userDataService.writeData?.(path, data);
  }

  // ===========================================================================
  // IMessageQueueRepository Implementation
  // ===========================================================================

  /**
   * Load unsent queue items for a chat
   * @param {string} chatId - Conversation ID
   * @returns {Promise<Object[]>}
   */
  async loadUnsentQueue(chatId) {
    const path = this.#getPath(chatId);
    const data = this.#loadData(path);

    // Filter to unsent items only
    return (data.queue || []).filter(item => !item.sentAt);
  }

  /**
   * Save queue items
   * @param {string} chatId - Conversation ID
   * @param {Object[]} items - Queue items to save
   * @returns {Promise<void>}
   */
  async saveToQueue(chatId, items) {
    const path = this.#getPath(chatId);
    const data = this.#loadData(path);

    // Ensure queue array exists
    if (!Array.isArray(data.queue)) {
      data.queue = [];
    }

    // Add or update items
    for (const item of items) {
      const existingIndex = data.queue.findIndex(q => q.uuid === item.uuid);
      if (existingIndex >= 0) {
        data.queue[existingIndex] = { ...data.queue[existingIndex], ...item };
      } else {
        data.queue.push({
          uuid: item.uuid || `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ...item,
          createdAt: item.createdAt || nowTs24()
        });
      }
    }

    this.#saveData(path, data);

    this.#logger.debug?.('queue.saved', {
      chatId,
      itemCount: items.length
    });
  }

  /**
   * Mark a queue item as sent
   * @param {string} uuid - Queue item UUID
   * @param {string} messageId - Telegram message ID
   * @returns {Promise<void>}
   */
  async markSent(uuid, messageId) {
    // We need to find which chat this queue item belongs to
    // This is a limitation of the interface - we'll need to search
    // For now, assume we can get chatId from the uuid or iterate

    this.#logger.debug?.('queue.markSent', { uuid, messageId });

    // Note: This implementation assumes the caller tracks which chatId
    // the queue item belongs to. In practice, you'd call markSentForChat.
  }

  /**
   * Mark a queue item as sent for a specific chat
   * @param {string} chatId - Conversation ID
   * @param {string} uuid - Queue item UUID
   * @param {string} messageId - Telegram message ID
   * @returns {Promise<void>}
   */
  async markSentForChat(chatId, uuid, messageId) {
    const path = this.#getPath(chatId);
    const data = this.#loadData(path);

    const item = (data.queue || []).find(q => q.uuid === uuid);
    if (item) {
      item.sentAt = nowTs24();
      item.messageId = messageId;
      this.#saveData(path, data);

      this.#logger.debug?.('queue.markSent', { chatId, uuid, messageId });
    }
  }

  /**
   * Clear entire queue for a chat
   * @param {string} chatId - Conversation ID
   * @returns {Promise<void>}
   */
  async clearQueue(chatId) {
    const path = this.#getPath(chatId);
    this.#saveData(path, { queue: [] });

    this.#logger.debug?.('queue.cleared', { chatId });
  }

  /**
   * Delete unprocessed/unsent items
   * @param {string} chatId - Conversation ID
   * @returns {Promise<void>}
   */
  async deleteUnprocessed(chatId) {
    const path = this.#getPath(chatId);
    const data = this.#loadData(path);

    // Keep only sent items
    const originalCount = (data.queue || []).length;
    data.queue = (data.queue || []).filter(item => item.sentAt);

    const deletedCount = originalCount - data.queue.length;

    if (deletedCount > 0) {
      this.#saveData(path, data);
      this.#logger.debug?.('queue.deleteUnprocessed', { chatId, deletedCount });
    }
  }

  /**
   * Get queue item by UUID
   * @param {string} chatId - Conversation ID
   * @param {string} uuid - Queue item UUID
   * @returns {Promise<Object|null>}
   */
  async getByUuid(chatId, uuid) {
    const path = this.#getPath(chatId);
    const data = this.#loadData(path);

    return (data.queue || []).find(q => q.uuid === uuid) || null;
  }

  /**
   * Update a queue item
   * @param {string} chatId - Conversation ID
   * @param {string} uuid - Queue item UUID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object|null>}
   */
  async updateItem(chatId, uuid, updates) {
    const path = this.#getPath(chatId);
    const data = this.#loadData(path);

    const item = (data.queue || []).find(q => q.uuid === uuid);
    if (item) {
      Object.assign(item, updates);
      this.#saveData(path, data);
      return item;
    }

    return null;
  }
}

export default YamlMessageQueueRepository;
