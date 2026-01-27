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
 * @interface IGratitudeDatastore
 */
export const IGratitudeDatastore = {
  // Options (available items queue)

  /**
   * Get options for a category
   * @param {string} householdId
   * @param {Category} category
   * @returns {Promise<GratitudeItemData[]>}
   */
  getOptions(householdId, category) {},

  /**
   * Set options for a category
   * @param {string} householdId
   * @param {Category} category
   * @param {GratitudeItemData[]} items
   * @returns {Promise<void>}
   */
  setOptions(householdId, category, items) {},

  /**
   * Add an option
   * @param {string} householdId
   * @param {Category} category
   * @param {GratitudeItemData} item
   * @returns {Promise<void>}
   */
  addOption(householdId, category, item) {},

  /**
   * Remove an option by ID
   * @param {string} householdId
   * @param {Category} category
   * @param {string} itemId
   * @returns {Promise<boolean>}
   */
  removeOption(householdId, category, itemId) {},

  // Selections (user-selected items)

  /**
   * Get selections for a category
   * @param {string} householdId
   * @param {Category} category
   * @returns {Promise<SelectionData[]>}
   */
  getSelections(householdId, category) {},

  /**
   * Add a selection
   * @param {string} householdId
   * @param {Category} category
   * @param {SelectionData} selection
   * @returns {Promise<void>}
   */
  addSelection(householdId, category, selection) {},

  /**
   * Remove a selection by ID
   * @param {string} householdId
   * @param {Category} category
   * @param {string} selectionId
   * @returns {Promise<SelectionData|null>}
   */
  removeSelection(householdId, category, selectionId) {},

  /**
   * Mark selections as printed
   * @param {string} householdId
   * @param {Category} category
   * @param {string[]} selectionIds
   * @param {string} timestamp
   * @returns {Promise<void>}
   */
  markAsPrinted(householdId, category, selectionIds, timestamp) {},

  // Discarded items

  /**
   * Get discarded items for a category
   * @param {string} householdId
   * @param {Category} category
   * @returns {Promise<GratitudeItemData[]>}
   */
  getDiscarded(householdId, category) {},

  /**
   * Add to discarded
   * @param {string} householdId
   * @param {Category} category
   * @param {GratitudeItemData} item
   * @returns {Promise<void>}
   */
  addDiscarded(householdId, category, item) {},

  // Snapshots

  /**
   * Save a snapshot
   * @param {string} householdId
   * @param {SnapshotData} snapshot
   * @returns {Promise<string>} Filename
   */
  saveSnapshot(householdId, snapshot) {},

  /**
   * List snapshots
   * @param {string} householdId
   * @returns {Promise<{file: string, id: string, createdAt: string}[]>}
   */
  listSnapshots(householdId) {},

  /**
   * Load a snapshot
   * @param {string} householdId
   * @param {string} [snapshotId] - If not provided, loads latest
   * @returns {Promise<SnapshotData|null>}
   */
  loadSnapshot(householdId, snapshotId) {},

  /**
   * Restore from a snapshot
   * @param {string} householdId
   * @param {SnapshotData} snapshot
   * @returns {Promise<void>}
   */
  restoreSnapshot(householdId, snapshot) {}
};

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
