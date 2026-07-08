/**
 * GratitudeService
 *
 * Domain service for managing gratitude and hopes items.
 * Handles options, selections, discarded items, and snapshots.
 *
 * @module domains/gratitude/services
 */

import { v4 as uuidv4 } from 'uuid';
import { Selection } from '../entities/Selection.mjs';
import { GratitudeItem } from '../entities/GratitudeItem.mjs';
import { DomainInvariantError, EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Valid categories
 */
const CATEGORIES = ['gratitude', 'hopes'];

/**
 * Explicit DTO mappers for outward-facing plain shapes (bootstrap payloads,
 * print formatting). Built from entity getters — entities do not own their
 * serialized format; storage (de)hydration lives in the datastore adapter.
 * See docs/_wip/plans/2026-07-08-serialization-ownership-migration.md.
 */
function toPlainItem(item) {
  return { id: item.id, text: item.text };
}

function toPlainSelection(selection) {
  return {
    id: selection.id,
    userId: selection.userId,
    item: toPlainItem(selection.item),
    datetime: selection.datetime,
    printed: selection.printed
  };
}

/**
 * Fisher-Yates shuffle
 * @param {Array} array
 * @returns {Array}
 */
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export class GratitudeService {
  #store;

  /**
   * @param {Object} config
   * @param {import('../ports/IGratitudeStore.mjs').IGratitudeStore} config.store
   */
  constructor(config) {
    this.#store = config.store;
  }

  /**
   * Validate category
   * @param {string} category
   * @returns {boolean}
   */
  isValidCategory(category) {
    return CATEGORIES.includes(String(category).toLowerCase());
  }

  // ===========================================================================
  // Options (available items queue)
  // ===========================================================================

  /**
   * Get options for a category (randomized)
   * @param {string} householdId
   * @param {Category} category
   * @returns {Promise<GratitudeItem[]>}
   */
  async getOptions(householdId, category) {
    let items = await this.#store.getOptions(householdId, category);

    // Recycle: when options are depleted, move discarded items back to options
    if (items.length === 0) {
      const discarded = await this.#store.getDiscarded(householdId, category);
      if (discarded.length > 0) {
        await this.#store.setOptions(householdId, `options.${category}`, discarded);
        await this.#store.setOptions(householdId, `discarded.${category}`, []);
        items = discarded;
      }
    }

    return shuffleArray(items);
  }

  /**
   * Get all options for all categories
   * @param {string} householdId
   * @returns {Promise<{gratitude: GratitudeItem[], hopes: GratitudeItem[]}>}
   */
  async getAllOptions(householdId) {
    const [gratitude, hopes] = await Promise.all([
      this.getOptions(householdId, 'gratitude'),
      this.getOptions(householdId, 'hopes')
    ]);
    return { gratitude, hopes };
  }

  /**
   * Add an option
   * @param {string} householdId
   * @param {Category} category
   * @param {string} text
   * @returns {Promise<GratitudeItem>}
   */
  async addOption(householdId, category, text) {
    const item = new GratitudeItem({ text });
    await this.#store.addOption(householdId, category, item);
    return item;
  }

  // ===========================================================================
  // Selections
  // ===========================================================================

  /**
   * Get selections for a category
   * @param {string} householdId
   * @param {Category} category
   * @returns {Promise<Selection[]>}
   */
  async getSelections(householdId, category) {
    return this.#store.getSelections(householdId, category);
  }

  /**
   * Get all selections
   * @param {string} householdId
   * @returns {Promise<{gratitude: Selection[], hopes: Selection[]}>}
   */
  async getAllSelections(householdId) {
    const [gratitude, hopes] = await Promise.all([
      this.getSelections(householdId, 'gratitude'),
      this.getSelections(householdId, 'hopes')
    ]);
    return { gratitude, hopes };
  }

  /**
   * Add a selection
   * @param {string} householdId
   * @param {Category} category
   * @param {string} userId
   * @param {Object} item
   * @param {string} timestamp - ISO timestamp (required, from application layer)
   * @returns {Promise<Selection>}
   */
  async addSelection(householdId, category, userId, item, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }

    // Check for duplicates
    const existing = await this.#store.getSelections(householdId, category);
    const duplicate = existing.find(s =>
      s.item?.id === item.id && s.userId === userId
    );
    if (duplicate) {
      throw new DomainInvariantError('Item already selected by this user', { code: 'DUPLICATE_SELECTION', optionId: item.id, userId });
    }

    const selection = Selection.create(userId, item, timestamp);
    await this.#store.addSelection(householdId, category, selection);

    // Remove from options (transfer semantics)
    await this.#store.removeOption(householdId, category, item.id);

    // Remove from discarded if present
    const discarded = await this.#store.getDiscarded(householdId, category);
    if (discarded.some(d => d.id === item.id)) {
      const newDiscarded = discarded.filter(d => d.id !== item.id);
      await this.#store.setOptions(householdId, `discarded.${category}`, newDiscarded);
    }

    return selection;
  }

  /**
   * Add multiple selections (batch)
   * @param {string} householdId
   * @param {Category} category
   * @param {string} userId
   * @param {Array<{id?: string, text: string}>} items
   * @param {string} timestamp - ISO timestamp (required, from application layer)
   * @returns {Promise<Selection[]>}
   */
  async addSelections(householdId, category, userId, items, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }

    const selections = [];

    for (const item of items) {
      const itemWithId = {
        id: item.id || uuidv4(),
        text: item.text
      };
      const selection = Selection.create(userId, itemWithId, timestamp);
      await this.#store.addSelection(householdId, category, selection);
      selections.push(selection);
    }

    return selections;
  }

  /**
   * Remove a selection
   * @param {string} householdId
   * @param {Category} category
   * @param {string} selectionId
   * @returns {Promise<Selection|null>}
   */
  async removeSelection(householdId, category, selectionId) {
    return this.#store.removeSelection(householdId, category, selectionId);
  }

  /**
   * Mark selections as printed
   * @param {string} householdId
   * @param {Category} category
   * @param {string[]} selectionIds
   * @param {string} timestamp - ISO timestamp (required, from application layer)
   * @returns {Promise<void>}
   */
  async markAsPrinted(householdId, category, selectionIds, timestamp) {
    if (!selectionIds || selectionIds.length === 0) return;
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }

    await this.#store.markAsPrinted(householdId, category, selectionIds, timestamp);
  }

  /**
   * Get selections formatted for printing
   * @param {string} householdId
   * @param {Function} resolveDisplayName - Function to resolve userId to display name
   * @returns {Promise<{gratitude: Object[], hopes: Object[]}>}
   */
  async getSelectionsForPrint(householdId, resolveDisplayName) {
    const { gratitude, hopes } = await this.getAllSelections(householdId);

    const formatSelection = (selection) => ({
      id: selection.id,
      userId: selection.userId,
      displayName: resolveDisplayName(selection.userId),
      item: toPlainItem(selection.item),
      datetime: selection.datetime,
      printCount: selection.printCount
    });

    return {
      gratitude: gratitude.map(formatSelection),
      hopes: hopes.map(formatSelection)
    };
  }

  // ===========================================================================
  // Discarded
  // ===========================================================================

  /**
   * Get discarded items
   * @param {string} householdId
   * @param {Category} category
   * @returns {Promise<GratitudeItem[]>}
   */
  async getDiscarded(householdId, category) {
    return this.#store.getDiscarded(householdId, category);
  }

  /**
   * Get all discarded
   * @param {string} householdId
   * @returns {Promise<{gratitude: GratitudeItem[], hopes: GratitudeItem[]}>}
   */
  async getAllDiscarded(householdId) {
    const [gratitude, hopes] = await Promise.all([
      this.getDiscarded(householdId, 'gratitude'),
      this.getDiscarded(householdId, 'hopes')
    ]);
    return { gratitude, hopes };
  }

  /**
   * Discard an item
   * @param {string} householdId
   * @param {Category} category
   * @param {Object} item
   * @returns {Promise<GratitudeItem>}
   */
  async discardItem(householdId, category, item) {
    const gratitudeItem = new GratitudeItem(item);
    await this.#store.addDiscarded(householdId, category, gratitudeItem);

    // Remove from options
    await this.#store.removeOption(householdId, category, item.id);

    return gratitudeItem;
  }

  // ===========================================================================
  // Bootstrap (load all data at once)
  // ===========================================================================

  /**
   * Get all data for bootstrap
   * @param {string} householdId
   * @returns {Promise<Object>}
   */
  async bootstrap(householdId) {
    const [options, selections, discarded] = await Promise.all([
      this.getAllOptions(householdId),
      this.getAllSelections(householdId),
      this.getAllDiscarded(householdId)
    ]);

    return {
      options: {
        gratitude: options.gratitude.map(toPlainItem),
        hopes: options.hopes.map(toPlainItem)
      },
      selections: {
        gratitude: selections.gratitude.map(toPlainSelection),
        hopes: selections.hopes.map(toPlainSelection)
      },
      discarded: {
        gratitude: discarded.gratitude.map(toPlainItem),
        hopes: discarded.hopes.map(toPlainItem)
      }
    };
  }

  // ===========================================================================
  // Snapshots
  // ===========================================================================

  /**
   * Save a snapshot
   * @param {string} householdId
   * @param {string} timestamp - ISO timestamp (required, from application layer)
   * @returns {Promise<{id: string, createdAt: string, file: string}>}
   */
  async saveSnapshot(householdId, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }

    const data = await this.bootstrap(householdId);

    const snapshot = {
      id: uuidv4(),
      householdId,
      createdAt: timestamp,
      ...data
    };

    const file = await this.#store.saveSnapshot(householdId, snapshot);

    return {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      file
    };
  }

  /**
   * List available snapshots
   * @param {string} householdId
   * @returns {Promise<Array>}
   */
  async listSnapshots(householdId) {
    return this.#store.listSnapshots(householdId);
  }

  /**
   * Restore from a snapshot
   * @param {string} householdId
   * @param {string} [snapshotId] - If not provided, restores latest
   * @returns {Promise<{restored: string, id: string, createdAt: string}>}
   */
  async restoreSnapshot(householdId, snapshotId) {
    const snapshot = await this.#store.loadSnapshot(householdId, snapshotId);

    if (!snapshot) {
      throw new EntityNotFoundError('Snapshot', snapshotId || 'latest');
    }

    await this.#store.restoreSnapshot(householdId, snapshot);

    return {
      restored: snapshot.file || snapshotId,
      id: snapshot.id,
      createdAt: snapshot.createdAt
    };
  }
}

export default GratitudeService;
