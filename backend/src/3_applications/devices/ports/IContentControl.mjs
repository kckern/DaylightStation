/**
 * IContentControl Port - Display content loading
 *
 * Abstraction for loading content on device displays.
 * Implemented by FullyKioskContentAdapter and WebSocketContentAdapter.
 *
 * @module applications/devices/ports
 */

/**
 * @typedef {Object} ContentLoadResult
 * @property {boolean} ok - Whether operation succeeded
 * @property {string} [url] - URL that was loaded
 * @property {number} [loadTimeMs] - Time to load
 * @property {string} [error] - Error message if failed
 */

/**
 * @typedef {Object} ContentStatus
 * @property {boolean} ready - Whether content control is ready
 * @property {string} [currentUrl] - Currently loaded URL
 * @property {string} [provider] - Provider name
 */

/**
 * Check if object implements IContentControl
 * @param {any} obj
 * @returns {boolean}
 */
export function isContentControl(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.load === 'function' &&
    typeof obj.getStatus === 'function'
  );
}

/**
 * Assert that object implements IContentControl
 * @param {any} obj
 * @param {string} [context]
 * @throws {Error} if object doesn't implement interface
 */
export function assertContentControl(obj, context = 'ContentControl') {
  if (!isContentControl(obj)) {
    throw new Error(`${context} must implement IContentControl interface`);
  }
}

/**
 * Create a no-op content control (for devices without this capability)
 * @returns {Object}
 */
export function createNoOpContentControl() {
  return {
    load: async () => ({ ok: false, error: 'Content control not configured' }),
    getStatus: async () => ({ ready: false, provider: 'none' }),
    prepareForContent: async () => ({ ok: true })
  };
}

export default {
  isContentControl,
  assertContentControl,
  createNoOpContentControl
};
