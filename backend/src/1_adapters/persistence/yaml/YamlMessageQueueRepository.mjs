/**
 * YamlMessageQueueRepository - YAML-based message queue persistence
 *
 * Implements IMessageQueueRepository port for message queue storage.
 * Data stored at: users/{username}/lifelog/journalist/queue.yml
 *
 * @module adapters/persistence/yaml
 */

import { nowTs24 } from '#system/utils/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class YamlMessageQueueRepository {
  #dataService;
  #userResolver;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.dataService - DataService for YAML I/O
   * @param {Object} [config.userResolver] - UserResolver for telegram ID to username mapping
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config.dataService) {
      throw new InfrastructureError('YamlMessageQueueRepository requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService'
      });
    }
    this.#dataService = config.dataService;
    this.#userResolver = config.userResolver;
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
    const colonIdx = conversationId.indexOf(':');
    return colonIdx > 0 ? conversationId.substring(0, colonIdx) : null;
  }

  /**
   * Extract user ID from conversation ID
   * @private
   */
  #extractUserId(conversationId) {
    if (conversationId.includes('_')) {
      const raw = conversationId.split('_').pop();
      // Strip canonical 'c' prefix from chat IDs (e.g. "c575596036" -> "575596036")
      return raw.replace(/^c/, '');
    }
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
   * Get username and relative path for message queue
   * @private
   * @returns {{ username: string, relativePath: string }}
   */
  #getStorageInfo(conversationId) {
    const username = this.#getUsername(conversationId);
    return {
      username,
      relativePath: 'lifelog/journalist/queue'
    };
  }

  /**
   * Load queue data from YAML
   * @private
   */
  #loadData(conversationId) {
    const { username, relativePath } = this.#getStorageInfo(conversationId);
    const data = this.#dataService.user.read(relativePath, username);
    return data || { queue: [] };
  }

  /**
   * Save queue data to YAML
   * @private
   */
  #saveData(conversationId, data) {
    const { username, relativePath } = this.#getStorageInfo(conversationId);
    this.#dataService.user.write(relativePath, data, username);
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
    const data = this.#loadData(chatId);

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
    const data = this.#loadData(chatId);

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

    this.#saveData(chatId, data);

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
    const data = this.#loadData(chatId);

    const item = (data.queue || []).find(q => q.uuid === uuid);
    if (item) {
      item.sentAt = nowTs24();
      item.messageId = messageId;
      this.#saveData(chatId, data);

      this.#logger.debug?.('queue.markSent', { chatId, uuid, messageId });
    }
  }

  /**
   * Clear entire queue for a chat
   * @param {string} chatId - Conversation ID
   * @returns {Promise<void>}
   */
  async clearQueue(chatId) {
    this.#saveData(chatId, { queue: [] });

    this.#logger.debug?.('queue.cleared', { chatId });
  }

  /**
   * Delete unprocessed/unsent items
   * @param {string} chatId - Conversation ID
   * @returns {Promise<void>}
   */
  async deleteUnprocessed(chatId) {
    const data = this.#loadData(chatId);

    // Keep only sent items
    const originalCount = (data.queue || []).length;
    data.queue = (data.queue || []).filter(item => item.sentAt);

    const deletedCount = originalCount - data.queue.length;

    if (deletedCount > 0) {
      this.#saveData(chatId, data);
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
    const data = this.#loadData(chatId);

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
    const data = this.#loadData(chatId);

    const item = (data.queue || []).find(q => q.uuid === uuid);
    if (item) {
      Object.assign(item, updates);
      this.#saveData(chatId, data);
      return item;
    }

    return null;
  }
}

export default YamlMessageQueueRepository;
