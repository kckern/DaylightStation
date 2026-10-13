/**
 * ISyncSource Port - Syncable content source
 *
 * Abstraction for content sources that support catalog syncing
 * from external systems. Implemented by adapters that pull catalogs
 * (e.g., RetroArchSyncAdapter).
 *
 * @module applications/content/ports
 */

/**
 * @typedef {Object} SyncResult
 * @property {number} synced - Number of items successfully synced
 * @property {number} errors - Number of items that failed to sync
 */

/**
 * @typedef {Object} SyncStatus
 * @property {string|null} lastSynced - ISO timestamp of last successful sync, or null
 * @property {number} itemCount - Number of items currently in the catalog
 */

/**
 * Port for syncable content sources.
 * Implemented by adapters that pull catalogs from external systems.
 */
export class ISyncSource {
  /**
   * Perform a full sync from the external source.
   * @returns {Promise<SyncResult>}
   */
  async sync() {
    throw new Error('ISyncSource.sync must be implemented');
  }

  /**
   * Return current sync status.
   * @returns {Promise<SyncStatus>}
   */
  async getStatus() {
    throw new Error('ISyncSource.getStatus must be implemented');
  }
}

/**
 * Duck-type check for ISyncSource compliance
 * @param {any} obj
 * @returns {boolean}
 */
export function isSyncSource(obj) {
  return obj != null &&
    typeof obj.sync === 'function' &&
    typeof obj.getStatus === 'function';
}

/**
 * Assert that object implements ISyncSource
 * @param {any} obj
 * @param {string} [context]
 * @throws {Error} if object doesn't implement interface
 */
export function assertSyncSource(obj, context = 'SyncSource') {
  if (!isSyncSource(obj)) {
    throw new Error(`${context} must implement ISyncSource interface`);
  }
}

/**
 * Create a no-op sync source (for sources without sync capability)
 * @returns {Object}
 */
export function createNoOpSyncSource() {
  return {
    sync: async () => ({ synced: 0, errors: 0 }),
    getStatus: async () => ({ lastSynced: null, itemCount: 0 })
  };
}

export default {
  ISyncSource,
  isSyncSource,
  assertSyncSource,
  createNoOpSyncSource
};
