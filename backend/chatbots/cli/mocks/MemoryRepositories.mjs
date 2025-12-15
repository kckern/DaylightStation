/**
 * Memory Repositories
 * @module cli/mocks/MemoryRepositories
 * 
 * In-memory implementations of repository interfaces for CLI testing.
 * Data is also persisted to JSON files for inspection.
 */

import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../../_lib/logging/index.mjs';

// Default data directory
const DATA_DIR = process.env.CLI_DATA_DIR || '/tmp/nutribot-cli';

/**
 * Ensure data directory exists
 */
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (e) {
    // Ignore if exists
  }
}

// ==================== Memory Nutrilog Repository ====================

/**
 * In-memory NutriLog repository
 * Implements INutrilogRepository interface
 */
export class MemoryNutrilogRepository {
  #logs;
  #logger;
  #filePath;

  constructor(options = {}) {
    this.#logs = new Map();
    this.#logger = options.logger || createLogger({ source: 'cli:nutrilog-repo', app: 'cli' });
    this.#filePath = path.join(DATA_DIR, 'nutrilogs.json');
  }

  /**
   * Get the file path where data is stored
   * @returns {string}
   */
  getFilePath() {
    return this.#filePath;
  }

  /**
   * Persist logs to file
   * @private
   */
  async #persist() {
    try {
      await ensureDataDir();
      const data = Array.from(this.#logs.values());
      await fs.writeFile(this.#filePath, JSON.stringify(data, null, 2));
      this.#logger.debug('persist', { path: this.#filePath, count: data.length });
    } catch (e) {
      this.#logger.warn('persist.error', { error: e.message });
    }
  }

  /**
   * Save a nutrilog
   * @param {Object} log
   */
  async save(log) {
    const uuid = log.uuid || log.id || uuidv4();
    const logWithId = { ...log, uuid };
    this.#logs.set(uuid, logWithId);
    this.#logger.debug('save', { uuid, itemCount: log.items?.length });
    await this.#persist();
    return logWithId;
  }

  /**
   * Find by UUID
   * @param {string} uuid
   * @returns {Promise<Object|null>}
   */
  async findByUuid(uuid) {
    const log = this.#logs.get(uuid);
    this.#logger.debug('findByUuid', { uuid, found: !!log });
    return log ? { ...log } : null;
  }

  /**
   * Find by status for a chat
   * @param {string} chatId
   * @param {string} status
   * @returns {Promise<Array>}
   */
  async findByStatus(chatId, status) {
    const results = Array.from(this.#logs.values())
      .filter(l => l.chatId === chatId && l.status === status);
    this.#logger.debug('findByStatus', { chatId, status, count: results.length });
    return results.map(l => ({ ...l }));
  }

  /**
   * Find pending logs for a user
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async findPending(userId) {
    const results = Array.from(this.#logs.values())
      .filter(l => {
        if (l.status !== 'pending') return false;
        if (l.userId === userId) return true;
        if (l.chatId?.includes(userId)) return true;
        if (l.chatId?.startsWith('cli:')) return true;
        return false;
      });
    this.#logger.debug('findPending', { userId, count: results.length });
    return results.map(l => ({ ...l }));
  }

  /**
   * Get daily summary
   * @param {string} userId
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<Object>}
   */
  async getDailySummary(userId, date) {
    // Match logs by userId, chatId containing userId, or chatId matching conversationId pattern
    const dayLogs = Array.from(this.#logs.values())
      .filter(l => {
        if (l.status !== 'accepted') return false;
        // Match by userId directly
        if (l.userId === userId) return true;
        // Match by chatId containing userId
        if (l.chatId?.includes(userId)) return true;
        // Match CLI conversation IDs (cli:nutribot:session-xxx)
        if (l.chatId?.startsWith('cli:')) return true;
        return false;
      });
    
    const allItems = dayLogs.flatMap(l => l.items || []);
    
    let calories = 0, protein = 0, carbs = 0, fat = 0, totalGrams = 0;
    const colorCounts = { green: 0, yellow: 0, orange: 0 };
    const gramsByColor = { green: 0, yellow: 0, orange: 0 };
    
    for (const item of allItems) {
      calories += item.calories || 0;
      protein += item.protein || 0;
      carbs += item.carbs || 0;
      fat += item.fat || 0;
      totalGrams += item.grams || 0;
      
      const color = item.color || 'yellow';
      colorCounts[color] = (colorCounts[color] || 0) + 1;
      gramsByColor[color] = (gramsByColor[color] || 0) + (item.grams || 0);
    }
    
    return {
      logCount: dayLogs.length,
      itemCount: allItems.length,
      totalGrams,
      colorCounts,
      gramsByColor,
      totals: { calories, protein, carbs, fat },
      items: allItems,
    };
  }

  /**
   * Update log status
   * @param {string} uuid
   * @param {string} status
   */
  async updateStatus(uuid, status) {
    const log = this.#logs.get(uuid);
    if (log) {
      log.status = status;
      log.updatedAt = new Date().toISOString();
      this.#logger.debug('updateStatus', { uuid, status });
      await this.#persist();
    }
  }

  /**
   * Update log items
   * @param {string} uuid
   * @param {Array} items
   */
  async updateItems(uuid, items) {
    const log = this.#logs.get(uuid);
    if (log) {
      log.items = items;
      log.updatedAt = new Date().toISOString();
      this.#logger.debug('updateItems', { uuid, itemCount: items.length });
      await this.#persist();
    }
  }

  /**
   * Delete a log
   * @param {string} uuid
   */
  async delete(uuid) {
    const deleted = this.#logs.delete(uuid);
    this.#logger.debug('delete', { uuid, deleted });
    return deleted;
  }

  /**
   * Get all logs (for debugging)
   */
  getAll() {
    return Array.from(this.#logs.values());
  }

  /**
   * Clear all logs
   */
  clear() {
    this.#logs.clear();
    this.#logger.debug('clear');
  }

  /**
   * Get count
   */
  get size() {
    return this.#logs.size;
  }
}

// ==================== Memory Nutrilist Repository ====================

/**
 * In-memory NutriList repository
 * Implements INutrilistRepository interface
 */
export class MemoryNutrilistRepository {
  #items;
  #logger;
  #filePath;

  constructor(options = {}) {
    this.#items = [];
    this.#logger = options.logger || createLogger({ source: 'cli:nutrilist-repo', app: 'cli' });
    this.#filePath = path.join(DATA_DIR, 'nutrilist.json');
  }

  /**
   * Initialize repository - load from file and clear today's items
   * Call this when starting a new session
   */
  async initialize() {
    await ensureDataDir();
    
    // Load existing data from file
    try {
      const data = await fs.readFile(this.#filePath, 'utf8');
      this.#items = JSON.parse(data) || [];
      this.#logger.debug('initialize.loaded', { count: this.#items.length });
    } catch (e) {
      this.#items = [];
      this.#logger.debug('initialize.noFile');
    }
    
    // Clear today's items (keep previous days)
    const today = new Date().toISOString().split('T')[0];
    const beforeCount = this.#items.length;
    this.#items = this.#items.filter(item => {
      const itemDate = item.date || item.createdAt?.split('T')[0];
      return itemDate !== today;
    });
    const cleared = beforeCount - this.#items.length;
    if (cleared > 0) {
      this.#logger.debug('initialize.clearedToday', { today, cleared });
      await this.#persist();
    }
    
    return { loaded: beforeCount, cleared, remaining: this.#items.length };
  }

  /**
   * Get the file path where data is stored
   * @returns {string}
   */
  getFilePath() {
    return this.#filePath;
  }

  /**
   * Persist items to file
   * @private
   */
  async #persist() {
    try {
      await ensureDataDir();
      await fs.writeFile(this.#filePath, JSON.stringify(this.#items, null, 2));
      this.#logger.debug('persist', { path: this.#filePath, count: this.#items.length });
    } catch (e) {
      this.#logger.warn('persist.error', { error: e.message });
    }
  }

  /**
   * Save many items
   * @param {Array} items
   */
  async saveMany(items) {
    const itemsWithIds = items.map(item => ({
      ...item,
      id: item.id || uuidv4(),
      createdAt: item.createdAt || new Date().toISOString(),
    }));
    
    this.#items.push(...itemsWithIds);
    this.#logger.debug('saveMany', { count: items.length, total: this.#items.length });
    await this.#persist();
    return itemsWithIds;
  }

  /**
   * Find items by date
   * @param {string} userId
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<Array>}
   */
  async findByDate(userId, date) {
    const results = this.#items.filter(item => {
      const itemDate = item.date || item.createdAt?.split('T')[0];
      // In CLI mode, items may not have userId - match by date only if no userId on item
      const userMatch = !item.userId || item.userId === userId;
      return userMatch && itemDate === date;
    });
    this.#logger.debug('findByDate', { userId, date, count: results.length });
    return results;
  }

  /**
   * Find items by date range
   * @param {string} userId
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<Array>}
   */
  async findByDateRange(userId, startDate, endDate) {
    const results = this.#items.filter(item => {
      const itemDate = item.date || item.createdAt?.split('T')[0];
      return item.userId === userId && itemDate >= startDate && itemDate <= endDate;
    });
    this.#logger.debug('findByDateRange', { userId, startDate, endDate, count: results.length });
    return results;
  }

  /**
   * Get daily totals
   * @param {string} userId
   * @param {string} date
   * @returns {Promise<Object>}
   */
  async getDailyTotals(userId, date) {
    const items = await this.findByDate(userId, date);
    
    const totals = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      grams: 0,
      itemCount: items.length,
    };
    
    for (const item of items) {
      totals.calories += item.calories || 0;
      totals.protein += item.protein || 0;
      totals.carbs += item.carbs || 0;
      totals.fat += item.fat || 0;
      totals.grams += item.grams || 0;
    }
    
    return totals;
  }

  /**
   * Delete items by log UUID
   * @param {string} logUuid
   */
  async deleteByLogUuid(logUuid) {
    const before = this.#items.length;
    this.#items = this.#items.filter(item => item.logUuid !== logUuid);
    const deleted = before - this.#items.length;
    this.#logger.debug('deleteByLogUuid', { logUuid, deleted });
    await this.#persist();
    return deleted;
  }

  /**
   * Find item by ID
   * @param {string} itemId
   * @returns {Promise<Object|null>}
   */
  async findById(itemId) {
    const item = this.#items.find(i => i.id === itemId);
    this.#logger.debug('findById', { itemId, found: !!item });
    return item || null;
  }

  /**
   * Update an item by ID
   * @param {string} itemId
   * @param {Object} updates
   * @returns {Promise<Object|null>}
   */
  async update(itemId, updates) {
    const index = this.#items.findIndex(i => i.id === itemId);
    if (index === -1) {
      this.#logger.debug('update.notFound', { itemId });
      return null;
    }
    
    this.#items[index] = {
      ...this.#items[index],
      ...updates,
      id: itemId, // Preserve original ID
      updatedAt: new Date().toISOString(),
    };
    
    this.#logger.debug('update', { itemId, updates: Object.keys(updates) });
    await this.#persist();
    return this.#items[index];
  }

  /**
   * Delete an item by ID
   * @param {string} itemId
   * @returns {Promise<boolean>}
   */
  async delete(itemId) {
    const before = this.#items.length;
    this.#items = this.#items.filter(i => i.id !== itemId);
    const deleted = before !== this.#items.length;
    this.#logger.debug('delete', { itemId, deleted });
    if (deleted) {
      await this.#persist();
    }
    return deleted;
  }

  /**
   * Get all items (for debugging)
   */
  getAll() {
    return [...this.#items];
  }

  /**
   * Clear all items
   */
  clear() {
    this.#items = [];
    this.#logger.debug('clear');
  }

  /**
   * Get count
   */
  get size() {
    return this.#items.length;
  }
}

// ==================== Memory Conversation State Store ====================

/**
 * In-memory conversation state store
 * Implements IConversationStateStore interface
 */
export class MemoryConversationStateStore {
  #states;
  #logger;

  constructor(options = {}) {
    this.#states = new Map();
    this.#logger = options.logger || createLogger({ source: 'cli:state-store', app: 'cli' });
  }

  /**
   * Get state for a conversation
   * @param {string} conversationId
   * @returns {Promise<Object|null>}
   */
  async get(conversationId) {
    const state = this.#states.get(conversationId);
    this.#logger.debug('get', { conversationId, hasState: !!state });
    return state ? { ...state } : null;
  }

  /**
   * Set state for a conversation
   * @param {string} conversationId
   * @param {Object} state
   */
  async set(conversationId, state) {
    this.#states.set(conversationId, { ...state, updatedAt: new Date().toISOString() });
    this.#logger.debug('set', { conversationId, flow: state.flow });
  }

  /**
   * Delete state for a conversation
   * @param {string} conversationId
   */
  async delete(conversationId) {
    const deleted = this.#states.delete(conversationId);
    this.#logger.debug('delete', { conversationId, deleted });
    return deleted;
  }

  /**
   * Update state for a conversation (merge with existing)
   * @param {string} conversationId
   * @param {Object} updates
   */
  async update(conversationId, updates) {
    const existing = this.#states.get(conversationId) || {};
    const newState = {
      ...existing,
      ...updates,
      data: { ...existing.data, ...updates.data },
      updatedAt: new Date().toISOString(),
    };
    this.#states.set(conversationId, newState);
    this.#logger.debug('update', { conversationId, updates: Object.keys(updates) });
    return newState;
  }

  /**
   * Check if conversation has state
   * @param {string} conversationId
   * @returns {Promise<boolean>}
   */
  async has(conversationId) {
    return this.#states.has(conversationId);
  }

  /**
   * Get all states (for debugging)
   */
  getAll() {
    return Object.fromEntries(this.#states);
  }

  /**
   * Clear all states
   */
  clear() {
    this.#states.clear();
    this.#logger.debug('clear');
  }

  /**
   * Get count
   */
  get size() {
    return this.#states.size;
  }
}

// ==================== Memory Journal Entry Repository ====================

/**
 * In-memory Journal Entry repository
 * Implements IJournalEntryRepository interface
 */
export class MemoryJournalEntryRepository {
  #entries;
  #logger;

  constructor(options = {}) {
    this.#entries = [];
    this.#logger = options.logger || createLogger({ source: 'cli:journal-repo', app: 'cli' });
  }

  /**
   * Save an entry
   * @param {Object} entry
   */
  async save(entry) {
    const entryWithId = {
      ...entry,
      id: entry.id || uuidv4(),
      createdAt: entry.createdAt || new Date().toISOString(),
    };
    this.#entries.push(entryWithId);
    this.#logger.debug('save', { id: entryWithId.id, type: entry.type });
    return entryWithId;
  }

  /**
   * Find entries by date
   * @param {string} userId
   * @param {string} date
   * @returns {Promise<Array>}
   */
  async findByDate(userId, date) {
    const results = this.#entries.filter(entry => {
      const entryDate = entry.date || entry.createdAt?.split('T')[0];
      return entry.userId === userId && entryDate === date;
    });
    this.#logger.debug('findByDate', { userId, date, count: results.length });
    return results;
  }

  /**
   * Find entries by date range
   * @param {string} userId
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<Array>}
   */
  async findByDateRange(userId, startDate, endDate) {
    const results = this.#entries.filter(entry => {
      const entryDate = entry.date || entry.createdAt?.split('T')[0];
      return entry.userId === userId && entryDate >= startDate && entryDate <= endDate;
    });
    this.#logger.debug('findByDateRange', { userId, startDate, endDate, count: results.length });
    return results;
  }

  /**
   * Get recent entries
   * @param {string} userId
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async getRecent(userId, limit = 10) {
    const userEntries = this.#entries.filter(e => e.userId === userId);
    const sorted = userEntries.sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    return sorted.slice(0, limit);
  }

  /**
   * Get all entries (for debugging)
   */
  getAll() {
    return [...this.#entries];
  }

  /**
   * Clear all entries
   */
  clear() {
    this.#entries = [];
    this.#logger.debug('clear');
  }

  /**
   * Get count
   */
  get size() {
    return this.#entries.length;
  }
}

// ==================== Memory Message Queue Repository ====================

/**
 * In-memory Message Queue repository
 * Implements IMessageQueueRepository interface
 */
export class MemoryMessageQueueRepository {
  #queues;
  #logger;

  constructor(options = {}) {
    this.#queues = new Map();
    this.#logger = options.logger || createLogger({ source: 'cli:queue-repo', app: 'cli' });
  }

  /**
   * Push a message to the queue
   * @param {string} conversationId
   * @param {Object} message
   */
  async push(conversationId, message) {
    if (!this.#queues.has(conversationId)) {
      this.#queues.set(conversationId, []);
    }
    this.#queues.get(conversationId).push({
      ...message,
      id: message.id || uuidv4(),
      queuedAt: new Date().toISOString(),
    });
    this.#logger.debug('push', { conversationId, queueSize: this.#queues.get(conversationId).length });
  }

  /**
   * Pop a message from the queue
   * @param {string} conversationId
   * @returns {Promise<Object|null>}
   */
  async pop(conversationId) {
    const queue = this.#queues.get(conversationId);
    if (!queue || queue.length === 0) return null;
    const message = queue.shift();
    this.#logger.debug('pop', { conversationId, messageId: message.id });
    return message;
  }

  /**
   * Peek at the next message without removing
   * @param {string} conversationId
   * @returns {Promise<Object|null>}
   */
  async peek(conversationId) {
    const queue = this.#queues.get(conversationId);
    return queue && queue.length > 0 ? { ...queue[0] } : null;
  }

  /**
   * Get queue size
   * @param {string} conversationId
   * @returns {Promise<number>}
   */
  async size(conversationId) {
    const queue = this.#queues.get(conversationId);
    return queue ? queue.length : 0;
  }

  /**
   * Clear queue for a conversation
   * @param {string} conversationId
   */
  async clear(conversationId) {
    this.#queues.delete(conversationId);
    this.#logger.debug('clear', { conversationId });
  }

  /**
   * Clear all queues
   */
  clearAll() {
    this.#queues.clear();
    this.#logger.debug('clearAll');
  }
}

export default {
  MemoryNutrilogRepository,
  MemoryNutrilistRepository,
  MemoryConversationStateStore,
  MemoryJournalEntryRepository,
  MemoryMessageQueueRepository,
};
