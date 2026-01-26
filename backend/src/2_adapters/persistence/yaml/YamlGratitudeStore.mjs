/**
 * YamlGratitudeStore - YAML-based gratitude persistence
 *
 * Implements IGratitudeStore port for gratitude/hopes data storage.
 * Data stored at: households/{hid}/shared/gratitude/
 *   - options.{category}.yml
 *   - selections.{category}.yml
 *   - discarded.{category}.yml
 *   - snapshots/{timestamp}_{id}.yml
 *
 * @module adapters/persistence/yaml
 */

import path from 'path';
import moment from 'moment-timezone';
import {
  ensureDir,
  dirExists,
  listYamlFiles,
  loadYamlSafe,
  saveYaml
} from '../../../0_system/utils/FileIO.mjs';

export class YamlGratitudeStore {
  #userDataService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.userDataService - UserDataService instance for YAML I/O
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config.userDataService) {
      throw new Error('YamlGratitudeStore requires userDataService');
    }
    this.#userDataService = config.userDataService;
    this.#logger = config.logger || console;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Read array from household shared path
   * @private
   */
  #readArray(householdId, key) {
    const data = this.#userDataService.readHouseholdSharedData(householdId, `gratitude/${key}`);
    return Array.isArray(data) ? data : [];
  }

  /**
   * Write array to household shared path
   * @private
   */
  #writeArray(householdId, key, arr) {
    const data = Array.isArray(arr) ? arr : [];
    this.#userDataService.writeHouseholdSharedData(householdId, `gratitude/${key}`, data);
  }

  /**
   * Get snapshot directory path
   * @private
   */
  #getSnapshotDir(householdId) {
    return this.#userDataService.getHouseholdSharedPath(householdId, 'gratitude/snapshots');
  }

  /**
   * Ensure snapshot directory exists
   * @private
   */
  #ensureSnapshotDir(householdId) {
    const dir = this.#getSnapshotDir(householdId);
    if (dir) ensureDir(dir);
    return dir;
  }

  // ===========================================================================
  // Options (available items queue)
  // ===========================================================================

  /**
   * Get options for a category
   * @param {string} householdId
   * @param {string} category - 'gratitude' or 'hopes'
   * @returns {Promise<Object[]>}
   */
  async getOptions(householdId, category) {
    return this.#readArray(householdId, `options.${category}`);
  }

  /**
   * Set options for a category
   * @param {string} householdId
   * @param {string} category
   * @param {Object[]} items
   * @returns {Promise<void>}
   */
  async setOptions(householdId, category, items) {
    this.#writeArray(householdId, category, items);
  }

  /**
   * Add an option
   * @param {string} householdId
   * @param {string} category
   * @param {Object} item
   * @returns {Promise<void>}
   */
  async addOption(householdId, category, item) {
    const options = this.#readArray(householdId, `options.${category}`);
    options.unshift(item);
    this.#writeArray(householdId, `options.${category}`, options);
  }

  /**
   * Remove an option by ID
   * @param {string} householdId
   * @param {string} category
   * @param {string} itemId
   * @returns {Promise<boolean>}
   */
  async removeOption(householdId, category, itemId) {
    const options = this.#readArray(householdId, `options.${category}`);
    const newOptions = options.filter(o => o.id !== itemId);
    if (newOptions.length !== options.length) {
      this.#writeArray(householdId, `options.${category}`, newOptions);
      return true;
    }
    return false;
  }

  // ===========================================================================
  // Selections
  // ===========================================================================

  /**
   * Get selections for a category
   * @param {string} householdId
   * @param {string} category
   * @returns {Promise<Object[]>}
   */
  async getSelections(householdId, category) {
    return this.#readArray(householdId, `selections.${category}`);
  }

  /**
   * Add a selection
   * @param {string} householdId
   * @param {string} category
   * @param {Object} selection
   * @returns {Promise<void>}
   */
  async addSelection(householdId, category, selection) {
    const selections = this.#readArray(householdId, `selections.${category}`);
    selections.unshift(selection);
    this.#writeArray(householdId, `selections.${category}`, selections);
  }

  /**
   * Remove a selection by ID
   * @param {string} householdId
   * @param {string} category
   * @param {string} selectionId
   * @returns {Promise<Object|null>}
   */
  async removeSelection(householdId, category, selectionId) {
    const selections = this.#readArray(householdId, `selections.${category}`);
    const index = selections.findIndex(s => s.id === selectionId);
    if (index === -1) return null;

    const [removed] = selections.splice(index, 1);
    this.#writeArray(householdId, `selections.${category}`, selections);
    return removed;
  }

  /**
   * Mark selections as printed
   * @param {string} householdId
   * @param {string} category
   * @param {string[]} selectionIds
   * @param {string} timestamp
   * @returns {Promise<void>}
   */
  async markAsPrinted(householdId, category, selectionIds, timestamp) {
    const selections = this.#readArray(householdId, `selections.${category}`);
    let modified = false;

    for (const selection of selections) {
      if (selectionIds.includes(selection.id)) {
        if (!Array.isArray(selection.printed)) {
          selection.printed = [];
        }
        selection.printed.push(timestamp);
        modified = true;
      }
    }

    if (modified) {
      this.#writeArray(householdId, `selections.${category}`, selections);
    }
  }

  // ===========================================================================
  // Discarded
  // ===========================================================================

  /**
   * Get discarded items for a category
   * @param {string} householdId
   * @param {string} category
   * @returns {Promise<Object[]>}
   */
  async getDiscarded(householdId, category) {
    return this.#readArray(householdId, `discarded.${category}`);
  }

  /**
   * Add to discarded
   * @param {string} householdId
   * @param {string} category
   * @param {Object} item
   * @returns {Promise<void>}
   */
  async addDiscarded(householdId, category, item) {
    const discarded = this.#readArray(householdId, `discarded.${category}`);
    // Avoid duplicates
    if (!discarded.some(d => d.id === item.id)) {
      discarded.unshift(item);
      this.#writeArray(householdId, `discarded.${category}`, discarded);
    }
  }

  // ===========================================================================
  // Snapshots
  // ===========================================================================

  /**
   * Save a snapshot
   * @param {string} householdId
   * @param {Object} snapshot
   * @returns {Promise<string>} Filename
   */
  async saveSnapshot(householdId, snapshot) {
    const snapshotDir = this.#ensureSnapshotDir(householdId);
    if (!snapshotDir) {
      throw new Error('Failed to resolve snapshot directory');
    }

    const stamp = moment().format('YYYYMMDD_HHmmss');
    const baseName = `${stamp}_${snapshot.id}`;
    const basePath = path.join(snapshotDir, baseName);

    saveYaml(basePath, snapshot);
    return baseName;
  }

  /**
   * List snapshots
   * @param {string} householdId
   * @returns {Promise<Array>}
   */
  async listSnapshots(householdId) {
    const snapshotDir = this.#getSnapshotDir(householdId);
    if (!snapshotDir || !dirExists(snapshotDir)) {
      return [];
    }

    const baseNames = listYamlFiles(snapshotDir);

    const snapshots = baseNames.map(baseName => {
      try {
        const data = loadYamlSafe(path.join(snapshotDir, baseName)) || {};
        return {
          file: baseName,
          id: data.id || baseName.split('_').slice(1).join('_'),
          createdAt: data.createdAt || null,
          name: baseName
        };
      } catch {
        return {
          file: baseName,
          id: null,
          createdAt: null,
          name: baseName
        };
      }
    });

    // Sort newest first by filename timestamp
    return snapshots.sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  /**
   * Load a snapshot
   * @param {string} householdId
   * @param {string} [snapshotId] - If not provided, loads latest
   * @returns {Promise<Object|null>}
   */
  async loadSnapshot(householdId, snapshotId) {
    const snapshotDir = this.#getSnapshotDir(householdId);
    if (!snapshotDir || !dirExists(snapshotDir)) {
      return null;
    }

    const baseNames = listYamlFiles(snapshotDir);
    if (baseNames.length === 0) return null;

    let baseName = null;
    if (snapshotId) {
      baseName = baseNames.find(b => b.includes(snapshotId));
    }
    // Default to latest (sorted by filename timestamp desc)
    if (!baseName) {
      baseName = baseNames.sort().reverse()[0];
    }

    try {
      const snapshot = loadYamlSafe(path.join(snapshotDir, baseName));
      if (snapshot) {
        snapshot.file = baseName;
      }
      return snapshot || null;
    } catch {
      return null;
    }
  }

  /**
   * Restore from a snapshot
   * @param {string} householdId
   * @param {Object} snapshot
   * @returns {Promise<void>}
   */
  async restoreSnapshot(householdId, snapshot) {
    // Restore options
    if (snapshot.options?.gratitude) {
      this.#writeArray(householdId, 'options.gratitude', snapshot.options.gratitude);
    }
    if (snapshot.options?.hopes) {
      this.#writeArray(householdId, 'options.hopes', snapshot.options.hopes);
    }

    // Restore selections
    if (snapshot.selections?.gratitude) {
      this.#writeArray(householdId, 'selections.gratitude', snapshot.selections.gratitude);
    }
    if (snapshot.selections?.hopes) {
      this.#writeArray(householdId, 'selections.hopes', snapshot.selections.hopes);
    }

    // Restore discarded
    if (snapshot.discarded?.gratitude) {
      this.#writeArray(householdId, 'discarded.gratitude', snapshot.discarded.gratitude);
    }
    if (snapshot.discarded?.hopes) {
      this.#writeArray(householdId, 'discarded.hopes', snapshot.discarded.hopes);
    }

    this.#logger.info?.('gratitude.snapshot.restored', {
      householdId,
      snapshotId: snapshot.id
    });
  }
}

export default YamlGratitudeStore;
