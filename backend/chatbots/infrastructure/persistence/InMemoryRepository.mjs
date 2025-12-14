/**
 * In-Memory Repository Implementation
 * @module infrastructure/persistence/InMemoryRepository
 * 
 * For testing purposes only
 */

import { NotFoundError } from '../../_lib/errors/index.mjs';

/**
 * In-memory repository implementation for testing
 * 
 * @template T
 */
export class InMemoryRepository {
  /** @type {Map<string, Map<string, T>>} chatId → (id → entity) */
  #data = new Map();
  #idField;
  #perChat;

  /**
   * @param {Object} [options]
   * @param {string} [options.idField='uuid'] - Field to use as entity ID
   * @param {boolean} [options.perChat=true] - Store separate data per chatId
   */
  constructor(options = {}) {
    this.#idField = options.idField || 'uuid';
    this.#perChat = options.perChat !== false;
  }

  /**
   * Get storage key
   * @private
   */
  #getKey(chatId) {
    return this.#perChat ? (chatId || '__global__') : '__global__';
  }

  /**
   * Get or create chat data map
   * @private
   */
  #getChatData(chatId) {
    const key = this.#getKey(chatId);
    if (!this.#data.has(key)) {
      this.#data.set(key, new Map());
    }
    return this.#data.get(key);
  }

  /**
   * Deep copy an entity
   * @private
   */
  #deepCopy(entity) {
    return JSON.parse(JSON.stringify(entity));
  }

  /**
   * Extract ID from entity
   * @private
   */
  #getId(entity) {
    const id = entity[this.#idField];
    if (!id) {
      throw new Error(`Entity missing required ID field: ${this.#idField}`);
    }
    return String(id);
  }

  // ==================== IRepository Implementation ====================

  /**
   * Save (insert or update) an entity
   * @param {T} entity
   * @param {string} [chatId]
   * @returns {Promise<T>}
   */
  async save(entity, chatId) {
    const data = this.#getChatData(chatId);
    const id = this.#getId(entity);
    data.set(id, this.#deepCopy(entity));
    return entity;
  }

  /**
   * Find entity by ID
   * @param {string} id
   * @param {string} [chatId]
   * @returns {Promise<T | null>}
   */
  async findById(id, chatId) {
    const data = this.#getChatData(chatId);
    const entity = data.get(id);
    return entity ? this.#deepCopy(entity) : null;
  }

  /**
   * Find all entities matching filter
   * @param {Object} [options]
   * @param {string} [chatId]
   * @returns {Promise<T[]>}
   */
  async findAll(options = {}, chatId) {
    const data = this.#getChatData(chatId);
    let results = Array.from(data.values()).map(e => ({ ...e }));
    
    // Apply filter
    if (options.filter) {
      results = results.filter(entity => this.#matchesFilter(entity, options.filter));
    }
    
    // Sort
    if (options.sortBy) {
      const order = options.sortOrder === 'desc' ? -1 : 1;
      results.sort((a, b) => {
        const aVal = a[options.sortBy];
        const bVal = b[options.sortBy];
        if (aVal < bVal) return -1 * order;
        if (aVal > bVal) return 1 * order;
        return 0;
      });
    }
    
    // Pagination
    const offset = options.offset || 0;
    if (offset > 0) {
      results = results.slice(offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }
    
    return results;
  }

  /**
   * Update an existing entity
   * @param {string} id
   * @param {Partial<T>} changes
   * @param {string} [chatId]
   * @returns {Promise<T>}
   */
  async update(id, changes, chatId) {
    const data = this.#getChatData(chatId);
    const existing = data.get(id);
    
    if (!existing) {
      throw new NotFoundError('Entity', id);
    }
    
    const updated = { ...existing, ...changes };
    data.set(id, updated);
    
    return { ...updated };
  }

  /**
   * Delete an entity
   * @param {string} id
   * @param {string} [chatId]
   * @returns {Promise<void>}
   */
  async delete(id, chatId) {
    const data = this.#getChatData(chatId);
    data.delete(id);
  }

  /**
   * Check if entity exists
   * @param {string} id
   * @param {string} [chatId]
   * @returns {Promise<boolean>}
   */
  async exists(id, chatId) {
    const data = this.#getChatData(chatId);
    return data.has(id);
  }

  // ==================== Testing Helpers ====================

  /**
   * Seed repository with entities
   * @param {T[]} entities
   * @param {string} [chatId]
   */
  seed(entities, chatId) {
    for (const entity of entities) {
      const data = this.#getChatData(chatId);
      const id = this.#getId(entity);
      data.set(id, { ...entity });
    }
  }

  /**
   * Get all entities (across all chats if perChat)
   * @param {string} [chatId] - If provided, only that chat's entities
   * @returns {T[]}
   */
  getAll(chatId) {
    if (chatId) {
      const data = this.#getChatData(chatId);
      return Array.from(data.values()).map(e => ({ ...e }));
    }
    
    const all = [];
    for (const chatData of this.#data.values()) {
      all.push(...Array.from(chatData.values()).map(e => ({ ...e })));
    }
    return all;
  }

  /**
   * Get a snapshot of all data
   * @returns {Object}
   */
  snapshot() {
    const result = {};
    for (const [key, chatData] of this.#data.entries()) {
      result[key] = Object.fromEntries(chatData);
    }
    return result;
  }

  /**
   * Reset all data
   */
  reset() {
    this.#data.clear();
  }

  /**
   * Get count of entities
   * @param {string} [chatId]
   * @returns {number}
   */
  count(chatId) {
    if (chatId) {
      return this.#getChatData(chatId).size;
    }
    let total = 0;
    for (const chatData of this.#data.values()) {
      total += chatData.size;
    }
    return total;
  }

  /**
   * Check if entity matches filter
   * @private
   */
  #matchesFilter(entity, filter) {
    for (const [key, value] of Object.entries(filter)) {
      if (entity[key] !== value) {
        return false;
      }
    }
    return true;
  }
}

export default InMemoryRepository;
