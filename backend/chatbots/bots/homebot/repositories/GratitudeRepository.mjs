/**
 * Gratitude Repository
 * @module homebot/repositories/GratitudeRepository
 * 
 * Wraps gratitude data access for HomeBot use cases.
 * Provides methods for adding selections and broadcasting via WebSocket.
 */

import { v4 as uuidv4 } from 'uuid';
import { configService } from '../../../../lib/config/ConfigService.mjs';
import { userDataService } from '../../../../lib/config/UserDataService.mjs';
import { broadcastToWebsockets } from '../../../../websocket.js';
import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Valid categories for gratitude items
 */
const CATEGORIES = ['gratitude', 'hopes'];

/**
 * Gratitude Repository
 * Provides data access for gratitude items with WebSocket broadcasting.
 */
export class GratitudeRepository {
  #householdId;
  #logger;

  /**
   * @param {Object} [options]
   * @param {string} [options.householdId] - Override household ID
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.#householdId = options.householdId || null;
    this.#logger = options.logger || createLogger({ source: 'repository', app: 'homebot' });
  }

  /**
   * Get the effective household ID
   * @returns {string}
   */
  #getHouseholdId() {
    return this.#householdId || configService.getDefaultHouseholdId();
  }

  /**
   * Read array from household shared gratitude path
   * @private
   */
  #readArray(key) {
    const hid = this.#getHouseholdId();
    const data = userDataService.readHouseholdSharedData(hid, `gratitude/${key}`);
    return Array.isArray(data) ? data : [];
  }

  /**
   * Write array to household shared gratitude path
   * @private
   */
  #writeArray(key, arr) {
    const hid = this.#getHouseholdId();
    userDataService.writeHouseholdSharedData(hid, `gratitude/${key}`, arr);
  }

  /**
   * Add a selection for a user
   * @param {string} category - 'gratitude' or 'hopes'
   * @param {Object} options
   * @param {string} options.userId - Username of the household member
   * @param {Object} options.item - Item object with id and text
   * @returns {Object} The created selection entry
   */
  async addSelection(category, { userId, item }) {
    if (!CATEGORIES.includes(category)) {
      throw new Error(`Invalid category: ${category}`);
    }

    const selections = this.#readArray(`selections.${category}`);
    
    const entry = {
      id: uuidv4(),
      userId,
      item: {
        id: item.id || uuidv4(),
        text: item.text,
      },
      datetime: new Date().toISOString(),
    };
    
    // Add to front of array (newest first)
    selections.unshift(entry);
    this.#writeArray(`selections.${category}`, selections);
    
    this.#logger.debug('gratitude.selection.added', { 
      category, 
      userId, 
      itemId: entry.item.id 
    });
    
    return entry;
  }

  /**
   * Add multiple selections for a user (batch)
   * @param {string} category - 'gratitude' or 'hopes'
   * @param {string} userId - Username of the household member
   * @param {Array<{id: string, text: string}>} items - Array of items
   * @returns {Array<Object>} The created selection entries
   */
  async addSelections(category, userId, items) {
    if (!CATEGORIES.includes(category)) {
      throw new Error(`Invalid category: ${category}`);
    }

    const selections = this.#readArray(`selections.${category}`);
    const entries = [];
    
    for (const item of items) {
      const entry = {
        id: uuidv4(),
        userId,
        item: {
          id: item.id || uuidv4(),
          text: item.text,
        },
        datetime: new Date().toISOString(),
      };
      entries.push(entry);
      selections.unshift(entry);
    }
    
    this.#writeArray(`selections.${category}`, selections);
    
    this.#logger.info('gratitude.selections.added', { 
      category, 
      userId, 
      count: entries.length 
    });
    
    return entries;
  }

  /**
   * Get all selections for a category
   * @param {string} category - 'gratitude' or 'hopes'
   * @returns {Array<Object>}
   */
  async getSelections(category) {
    if (!CATEGORIES.includes(category)) {
      throw new Error(`Invalid category: ${category}`);
    }
    return this.#readArray(`selections.${category}`);
  }

  /**
   * Broadcast items to WebSocket for real-time TV updates
   * @param {Object} payload
   * @param {string} payload.category - 'gratitude' or 'hopes'
   * @param {string} payload.userId - Username
   * @param {string} payload.userName - Display name
   * @param {Array<{id: string, text: string}>} payload.items - Items added
   */
  broadcastItems({ category, userId, userName, items }) {
    const payload = {
      topic: 'gratitude',
      action: 'item_added',
      items: items.map(i => ({ id: i.id, text: i.text })),
      userId,
      userName,
      category,
      source: 'homebot',
      timestamp: new Date().toISOString(),
    };

    this.#logger.debug('gratitude.broadcast', { 
      category, 
      userId, 
      itemCount: items.length 
    });

    broadcastToWebsockets(payload);
  }
}

export default GratitudeRepository;
