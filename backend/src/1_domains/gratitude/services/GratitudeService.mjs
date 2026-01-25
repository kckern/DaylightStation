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
import { nowTs24 } from '../../../0_infrastructure/utils/index.mjs';

/**
 * Valid categories
 */
const CATEGORIES = ['gratitude', 'hopes'];

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
  #logger;

  /**
   * @param {Object} config
   * @param {import('../ports/IGratitudeStore.mjs').IGratitudeStore} config.store
   * @param {Object} [config.logger]
   */
  constructor(config) {
    this.#store = config.store;
    this.#logger = config.logger || console;
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
    const items = await this.#store.getOptions(householdId, category);
    return shuffleArray(items.map(i => GratitudeItem.fromJSON(i)));
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
    await this.#store.addOption(householdId, category, item.toJSON());
    this.#logger.info?.('gratitude.option.added', {
      householdId,
      category,
      itemId: item.id
    });
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
    const selections = await this.#store.getSelections(householdId, category);
    return selections.map(s => Selection.fromJSON(s));
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
   * @param {string} [timezone]
   * @returns {Promise<Selection>}
   */
  async addSelection(householdId, category, userId, item, timezone) {
    // Check for duplicates
    const existing = await this.#store.getSelections(householdId, category);
    const duplicate = existing.find(s =>
      s.item?.id === item.id && s.userId === userId
    );
    if (duplicate) {
      throw new Error('Item already selected by this user');
    }

    // Create selection
    const selection = Selection.create(userId, item, timezone);
    await this.#store.addSelection(householdId, category, selection.toJSON());

    // Remove from options (transfer semantics)
    await this.#store.removeOption(householdId, category, item.id);

    // Remove from discarded if present
    const discarded = await this.#store.getDiscarded(householdId, category);
    if (discarded.some(d => d.id === item.id)) {
      const newDiscarded = discarded.filter(d => d.id !== item.id);
      await this.#store.setOptions(householdId, `discarded.${category}`, newDiscarded);
    }

    this.#logger.info?.('gratitude.selection.added', {
      householdId,
      category,
      userId,
      selectionId: selection.id
    });

    return selection;
  }

  /**
   * Add multiple selections (batch)
   * @param {string} householdId
   * @param {Category} category
   * @param {string} userId
   * @param {Array<{id?: string, text: string}>} items
   * @param {string} [timezone]
   * @returns {Promise<Selection[]>}
   */
  async addSelections(householdId, category, userId, items, timezone) {
    const selections = [];

    for (const item of items) {
      const itemWithId = {
        id: item.id || uuidv4(),
        text: item.text
      };
      const selection = Selection.create(userId, itemWithId, timezone);
      await this.#store.addSelection(householdId, category, selection.toJSON());
      selections.push(selection);
    }

    this.#logger.info?.('gratitude.selections.added', {
      householdId,
      category,
      userId,
      count: selections.length
    });

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
    const removed = await this.#store.removeSelection(householdId, category, selectionId);
    if (removed) {
      this.#logger.info?.('gratitude.selection.removed', {
        householdId,
        category,
        selectionId
      });
      return Selection.fromJSON(removed);
    }
    return null;
  }

  /**
   * Mark selections as printed
   * @param {string} householdId
   * @param {Category} category
   * @param {string[]} selectionIds
   * @returns {Promise<void>}
   */
  async markAsPrinted(householdId, category, selectionIds) {
    if (!selectionIds || selectionIds.length === 0) return;

    const timestamp = nowTs24();
    await this.#store.markAsPrinted(householdId, category, selectionIds, timestamp);

    this.#logger.info?.('gratitude.selections.printed', {
      householdId,
      category,
      count: selectionIds.length
    });
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
      item: selection.item.toJSON(),
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
    const items = await this.#store.getDiscarded(householdId, category);
    return items.map(i => GratitudeItem.fromJSON(i));
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
    await this.#store.addDiscarded(householdId, category, gratitudeItem.toJSON());

    // Remove from options
    await this.#store.removeOption(householdId, category, item.id);

    this.#logger.info?.('gratitude.item.discarded', {
      householdId,
      category,
      itemId: item.id
    });

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
        gratitude: options.gratitude.map(i => i.toJSON()),
        hopes: options.hopes.map(i => i.toJSON())
      },
      selections: {
        gratitude: selections.gratitude.map(s => s.toJSON()),
        hopes: selections.hopes.map(s => s.toJSON())
      },
      discarded: {
        gratitude: discarded.gratitude.map(i => i.toJSON()),
        hopes: discarded.hopes.map(i => i.toJSON())
      }
    };
  }

  // ===========================================================================
  // Snapshots
  // ===========================================================================

  /**
   * Save a snapshot
   * @param {string} householdId
   * @returns {Promise<{id: string, createdAt: string, file: string}>}
   */
  async saveSnapshot(householdId) {
    const data = await this.bootstrap(householdId);

    const snapshot = {
      id: uuidv4(),
      householdId,
      createdAt: nowTs24(),
      ...data
    };

    const file = await this.#store.saveSnapshot(householdId, snapshot);

    this.#logger.info?.('gratitude.snapshot.saved', {
      householdId,
      snapshotId: snapshot.id
    });

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
      throw new Error('Snapshot not found');
    }

    await this.#store.restoreSnapshot(householdId, snapshot);

    this.#logger.info?.('gratitude.snapshot.restored', {
      householdId,
      snapshotId: snapshot.id
    });

    return {
      restored: snapshot.file || snapshotId,
      id: snapshot.id,
      createdAt: snapshot.createdAt
    };
  }
}

export default GratitudeService;
