/**
 * IGratitudeDatastore Port
 *
 * Interface for gratitude data persistence.
 * Implementations handle storage of options, selections, and discarded items.
 *
 * @module domains/gratitude/ports
 */

/**
 * @typedef {'gratitude'|'hopes'} Category
 */

/**
 * @typedef {Object} GratitudeItemData
 * @property {string} id
 * @property {string} text
 */

/**
 * @typedef {Object} SelectionData
 * @property {string} id
 * @property {string} userId
 * @property {GratitudeItemData} item
 * @property {string} datetime
 * @property {string[]} [printed]
 */

/**
 * @typedef {Object} SnapshotData
 * @property {string} id
 * @property {string} householdId
 * @property {string} createdAt
 * @property {Object} options
 * @property {Object} selections
 * @property {Object} discarded
 */

/**
 * Gratitude datastore interface
 * @class IGratitudeDatastore
 */
export class IGratitudeDatastore {
  // Options (available items queue)

  /**
   * Get options for a category
   * @param {string} householdId
   * @param {Category} category
   * @returns {Promise<GratitudeItemData[]>}
   */
  async getOptions(householdId, category) {
    throw new Error('IGratitudeDatastore.getOptions must be implemented');
  }

  /**
   * Set options for a category
   * @param {string} householdId
   * @param {Category} category
   * @param {GratitudeItemData[]} items
   * @returns {Promise<void>}
   */
  async setOptions(householdId, category, items) {
    throw new Error('IGratitudeDatastore.setOptions must be implemented');
  }

  /**
   * Add an option
   * @param {string} householdId
   * @param {Category} category
   * @param {GratitudeItemData} item
   * @returns {Promise<void>}
   */
  async addOption(householdId, category, item) {
    throw new Error('IGratitudeDatastore.addOption must be implemented');
  }

  /**
   * Remove an option by ID
   * @param {string} householdId
   * @param {Category} category
   * @param {string} itemId
   * @returns {Promise<boolean>}
   */
  async removeOption(householdId, category, itemId) {
    throw new Error('IGratitudeDatastore.removeOption must be implemented');
  }

  // Selections (user-selected items)

  /**
   * Get selections for a category
   * @param {string} householdId
   * @param {Category} category
   * @returns {Promise<SelectionData[]>}
   */
  async getSelections(householdId, category) {
    throw new Error('IGratitudeDatastore.getSelections must be implemented');
  }

  /**
   * Add a selection
   * @param {string} householdId
   * @param {Category} category
   * @param {SelectionData} selection
   * @returns {Promise<void>}
   */
  async addSelection(householdId, category, selection) {
    throw new Error('IGratitudeDatastore.addSelection must be implemented');
  }

  /**
   * Remove a selection by ID
   * @param {string} householdId
   * @param {Category} category
   * @param {string} selectionId
   * @returns {Promise<SelectionData|null>}
   */
  async removeSelection(householdId, category, selectionId) {
    throw new Error('IGratitudeDatastore.removeSelection must be implemented');
  }

  /**
   * Mark selections as printed
   * @param {string} householdId
   * @param {Category} category
   * @param {string[]} selectionIds
   * @param {string} timestamp
   * @returns {Promise<void>}
   */
  async markAsPrinted(householdId, category, selectionIds, timestamp) {
    throw new Error('IGratitudeDatastore.markAsPrinted must be implemented');
  }

  // Discarded items

  /**
   * Get discarded items for a category
   * @param {string} householdId
   * @param {Category} category
   * @returns {Promise<GratitudeItemData[]>}
   */
  async getDiscarded(householdId, category) {
    throw new Error('IGratitudeDatastore.getDiscarded must be implemented');
  }

  /**
   * Add to discarded
   * @param {string} householdId
   * @param {Category} category
   * @param {GratitudeItemData} item
   * @returns {Promise<void>}
   */
  async addDiscarded(householdId, category, item) {
    throw new Error('IGratitudeDatastore.addDiscarded must be implemented');
  }

  // Snapshots

  /**
   * Save a snapshot
   * @param {string} householdId
   * @param {SnapshotData} snapshot
   * @returns {Promise<string>} Filename
   */
  async saveSnapshot(householdId, snapshot) {
    throw new Error('IGratitudeDatastore.saveSnapshot must be implemented');
  }

  /**
   * List snapshots
   * @param {string} householdId
   * @returns {Promise<{file: string, id: string, createdAt: string}[]>}
   */
  async listSnapshots(householdId) {
    throw new Error('IGratitudeDatastore.listSnapshots must be implemented');
  }

  /**
   * Load a snapshot
   * @param {string} householdId
   * @param {string} [snapshotId] - If not provided, loads latest
   * @returns {Promise<SnapshotData|null>}
   */
  async loadSnapshot(householdId, snapshotId) {
    throw new Error('IGratitudeDatastore.loadSnapshot must be implemented');
  }

  /**
   * Restore from a snapshot
   * @param {string} householdId
   * @param {SnapshotData} snapshot
   * @returns {Promise<void>}
   */
  async restoreSnapshot(householdId, snapshot) {
    throw new Error('IGratitudeDatastore.restoreSnapshot must be implemented');
  }
}

/**
 * Check if object implements IGratitudeDatastore
 * @param {*} obj
 * @returns {boolean}
 */
export function isGratitudeDatastore(obj) {
  return (
    obj &&
    typeof obj.getOptions === 'function' &&
    typeof obj.setOptions === 'function' &&
    typeof obj.getSelections === 'function' &&
    typeof obj.addSelection === 'function' &&
    typeof obj.removeSelection === 'function' &&
    typeof obj.getDiscarded === 'function' &&
    typeof obj.addDiscarded === 'function'
  );
}

export default IGratitudeDatastore;
