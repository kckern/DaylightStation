/**
 * Gratitude Repository Bridge
 *
 * This file now delegates to the new clean architecture implementation.
 * It wraps the new GratitudeService for HomeBot use cases.
 *
 * New implementation: backend/src/1_domains/gratitude/
 */

import { configService } from '../../../../lib/config/index.mjs';
import { userDataService } from '../../../../lib/config/UserDataService.mjs';
import { broadcastToWebsockets } from '../../../../routers/websocket.mjs';
import { createLogger } from '../../../_lib/logging/index.mjs';

// Import new architecture components
import { GratitudeService } from '../../../../../src/1_domains/gratitude/services/GratitudeService.mjs';
import { YamlGratitudeStore } from '../../../../../src/2_adapters/persistence/yaml/YamlGratitudeStore.mjs';

/**
 * Valid categories for gratitude items
 */
const CATEGORIES = ['gratitude', 'hopes'];

/**
 * Gratitude Repository
 * Provides data access for gratitude items with WebSocket broadcasting.
 * Now delegates to the new GratitudeService architecture.
 */
export class GratitudeRepository {
  #householdId;
  #logger;
  #gratitudeService;

  /**
   * @param {Object} [options]
   * @param {string} [options.householdId] - Override household ID
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.#householdId = options.householdId || null;
    this.#logger = options.logger || createLogger({ source: 'repository', app: 'homebot' });

    // Create the new architecture services
    const gratitudeStore = new YamlGratitudeStore({
      userDataService,
      logger: this.#logger
    });

    this.#gratitudeService = new GratitudeService({
      store: gratitudeStore,
      logger: this.#logger
    });
  }

  /**
   * Get the effective household ID
   * @returns {string}
   */
  #getHouseholdId() {
    return this.#householdId || configService.getDefaultHouseholdId();
  }

  /**
   * Add a selection for a user
   * @param {string} category - 'gratitude' or 'hopes'
   * @param {Object} options
   * @param {string} options.userId - Username of the household member
   * @param {Object} options.item - Item object with id and text
   * @returns {Promise<Object>} The created selection entry
   */
  async addSelection(category, { userId, item }) {
    if (!CATEGORIES.includes(category)) {
      throw new Error(`Invalid category: ${category}`);
    }

    const householdId = this.#getHouseholdId();
    const timezone = configService.getHouseholdTimezone?.(householdId);

    const selection = await this.#gratitudeService.addSelection(
      householdId,
      category,
      userId,
      item,
      timezone
    );

    this.#logger.debug('gratitude.selection.added', {
      category,
      userId,
      itemId: selection.item?.id
    });

    return selection.toJSON();
  }

  /**
   * Add multiple selections for a user (batch)
   * @param {string} category - 'gratitude' or 'hopes'
   * @param {string} userId - Username of the household member
   * @param {Array<{id: string, text: string}>} items - Array of items
   * @returns {Promise<Array<Object>>} The created selection entries
   */
  async addSelections(category, userId, items) {
    if (!CATEGORIES.includes(category)) {
      throw new Error(`Invalid category: ${category}`);
    }

    const householdId = this.#getHouseholdId();
    const timezone = configService.getHouseholdTimezone?.(householdId);

    const selections = await this.#gratitudeService.addSelections(
      householdId,
      category,
      userId,
      items,
      timezone
    );

    this.#logger.info('gratitude.selections.added', {
      category,
      userId,
      count: selections.length
    });

    return selections.map(s => s.toJSON());
  }

  /**
   * Get all selections for a category
   * @param {string} category - 'gratitude' or 'hopes'
   * @returns {Promise<Array<Object>>}
   */
  async getSelections(category) {
    if (!CATEGORIES.includes(category)) {
      throw new Error(`Invalid category: ${category}`);
    }

    const householdId = this.#getHouseholdId();
    const selections = await this.#gratitudeService.getSelections(householdId, category);
    return selections.map(s => s.toJSON());
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
      timestamp: new Date().toISOString()
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
