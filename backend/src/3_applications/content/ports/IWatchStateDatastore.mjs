// backend/src/3_applications/content/ports/IWatchStateDatastore.mjs

/**
 * @typedef {Object} IWatchStateDatastore
 * @property {function(string, string): Promise<import('../entities/WatchState.mjs').WatchState|null>} get
 * @property {function(import('../entities/WatchState.mjs').WatchState, string): Promise<void>} set
 * @property {function(string): Promise<import('../entities/WatchState.mjs').WatchState[]>} getAll
 * @property {function(string): Promise<void>} clear
 */

/**
 * Validates that an object implements the IWatchStateDatastore interface
 * @param {any} store
 * @throws {Error} If validation fails
 */
export function validateWatchStateDatastore(store) {
  if (typeof store.get !== 'function') {
    throw new Error('WatchStateDatastore must implement get(itemId, storagePath): Promise<WatchState|null>');
  }
  if (typeof store.set !== 'function') {
    throw new Error('WatchStateDatastore must implement set(watchState, storagePath): Promise<void>');
  }
  if (typeof store.getAll !== 'function') {
    throw new Error('WatchStateDatastore must implement getAll(storagePath): Promise<WatchState[]>');
  }
  if (typeof store.clear !== 'function') {
    throw new Error('WatchStateDatastore must implement clear(storagePath): Promise<void>');
  }
}
