/**
 * File-based Repository Implementation
 * @module infrastructure/persistence/FileRepository
 * 
 * CRITICAL: Uses loadFile/saveFile from backend/lib/io.mjs
 * NO direct fs operations
 */

import { loadFile, saveFile } from '../../../lib/io.mjs';
import { NotFoundError } from '../../_lib/errors/index.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';
import { TestContext } from '../../_lib/testing/TestContext.mjs';

/**
 * YAML file-based repository implementation
 * Uses io.mjs for all file operations
 * Supports test mode via TestContext for data isolation
 * 
 * @template T
 */
export class FileRepository {
  #storePath;
  #idField;
  #perChat;
  #logger;

  /**
   * @param {Object} options
   * @param {string} options.storePath - Path relative to data dir (e.g., 'nutribot/nutrilog')
   * @param {string} [options.idField='uuid'] - Field to use as entity ID
   * @param {boolean} [options.perChat=true] - Store separate file per chatId
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options) {
    if (!options?.storePath) {
      throw new Error('storePath is required');
    }

    this.#storePath = options.storePath;
    this.#idField = options.idField || 'uuid';
    this.#perChat = options.perChat !== false;
    this.#logger = options.logger || createLogger({ source: 'repository', app: 'file' });
  }

  /**
   * Get the file path for operations
   * Automatically applies test prefix if TestContext.isTestMode() is true
   * @private
   * @param {string} [chatId] - Chat ID for per-chat storage
   * @returns {string}
   */
  #getPath(chatId) {
    let basePath;
    if (this.#perChat) {
      if (!chatId) {
        throw new Error('chatId required for per-chat repository');
      }
      basePath = `${this.#storePath}/${chatId}`;
    } else {
      basePath = this.#storePath;
    }

    // Apply test prefix if in test mode
    return TestContext.transformPath(basePath);
  }

  /**
   * Extract ID from entity
   * @private
   * @param {T} entity
   * @returns {string}
   */
  #getId(entity) {
    const id = entity[this.#idField];
    if (!id) {
      throw new Error(`Entity missing required ID field: ${this.#idField}`);
    }
    return String(id);
  }

  /**
   * Save (insert or update) an entity
   * @param {T} entity
   * @param {string} [chatId] - Required for per-chat repositories
   * @returns {Promise<T>}
   */
  async save(entity, chatId) {
    const path = this.#getPath(chatId);
    const id = this.#getId(entity);
    
    this.#logger.debug('repository.save', { path, id });

    // Load existing data
    const data = loadFile(path) || {};
    
    // Add/update entity
    data[id] = entity;
    
    // Save back
    saveFile(path, data);
    
    return entity;
  }

  /**
   * Find entity by ID
   * @param {string} id
   * @param {string} [chatId] - Required for per-chat repositories
   * @returns {Promise<T | null>}
   */
  async findById(id, chatId) {
    const path = this.#getPath(chatId);
    
    this.#logger.debug('repository.findById', { path, id });

    const data = loadFile(path);
    if (!data) return null;
    
    return data[id] || null;
  }

  /**
   * Find all entities matching filter
   * @param {Object} [options]
   * @param {Object} [options.filter] - Partial entity match
   * @param {string} [options.sortBy] - Field to sort by
   * @param {'asc'|'desc'} [options.sortOrder='asc'] - Sort direction
   * @param {number} [options.limit] - Max results
   * @param {number} [options.offset=0] - Skip results
   * @param {string} [chatId] - Required for per-chat repositories
   * @returns {Promise<T[]>}
   */
  async findAll(options = {}, chatId) {
    const path = this.#getPath(chatId);
    
    this.#logger.debug('repository.findAll', { path, filter: options.filter });

    const data = loadFile(path);
    if (!data) return [];
    
    let results = Object.values(data);
    
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
   * @param {string} [chatId] - Required for per-chat repositories
   * @returns {Promise<T>}
   * @throws {NotFoundError} if entity doesn't exist
   */
  async update(id, changes, chatId) {
    const path = this.#getPath(chatId);
    
    this.#logger.debug('repository.update', { path, id });

    const data = loadFile(path);
    if (!data || !data[id]) {
      throw new NotFoundError('Entity', id, { repository: this.#storePath });
    }
    
    // Merge changes
    const updated = { ...data[id], ...changes };
    data[id] = updated;
    
    // Save back
    saveFile(path, data);
    
    return updated;
  }

  /**
   * Delete an entity
   * @param {string} id
   * @param {string} [chatId] - Required for per-chat repositories
   * @returns {Promise<void>}
   */
  async delete(id, chatId) {
    const path = this.#getPath(chatId);
    
    this.#logger.debug('repository.delete', { path, id });

    const data = loadFile(path);
    if (!data) return;
    
    delete data[id];
    
    saveFile(path, data);
  }

  /**
   * Check if entity exists
   * @param {string} id
   * @param {string} [chatId] - Required for per-chat repositories
   * @returns {Promise<boolean>}
   */
  async exists(id, chatId) {
    const path = this.#getPath(chatId);
    
    const data = loadFile(path);
    return data ? id in data : false;
  }

  /**
   * Count entities matching filter
   * @param {Object} [filter]
   * @param {string} [chatId]
   * @returns {Promise<number>}
   */
  async count(filter, chatId) {
    const results = await this.findAll({ filter }, chatId);
    return results.length;
  }

  /**
   * Delete all entities matching filter
   * @param {Object} [filter]
   * @param {string} [chatId]
   * @returns {Promise<number>} - Number deleted
   */
  async deleteMany(filter, chatId) {
    const path = this.#getPath(chatId);
    
    const data = loadFile(path);
    if (!data) return 0;
    
    let count = 0;
    for (const [id, entity] of Object.entries(data)) {
      if (!filter || this.#matchesFilter(entity, filter)) {
        delete data[id];
        count++;
      }
    }
    
    if (count > 0) {
      saveFile(path, data);
    }
    
    return count;
  }

  /**
   * Check if entity matches filter
   * @private
   * @param {T} entity
   * @param {Object} filter
   * @returns {boolean}
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

export default FileRepository;
