/**
 * IOsControl Port - OS-level commands
 *
 * Abstraction for OS-level operations like volume control via SSH.
 * Implemented by SshOsAdapter.
 *
 * @module applications/devices/ports
 */

/**
 * @typedef {Object} OsControlResult
 * @property {boolean} ok - Whether operation succeeded
 * @property {string} [command] - Command that was executed
 * @property {string} [output] - Command output
 * @property {string} [error] - Error message if failed
 */

/**
 * Check if object implements IOsControl
 * @param {any} obj
 * @returns {boolean}
 */
export function isOsControl(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.execute === 'function'
  );
}

/**
 * Assert that object implements IOsControl
 * @param {any} obj
 * @param {string} [context]
 * @throws {Error} if object doesn't implement interface
 */
export function assertOsControl(obj, context = 'OsControl') {
  if (!isOsControl(obj)) {
    throw new Error(`${context} must implement IOsControl interface`);
  }
}

/**
 * Create a no-op OS control (for devices without this capability)
 * @returns {Object}
 */
export function createNoOpOsControl() {
  return {
    execute: async () => ({ ok: false, error: 'OS control not configured' }),
    setVolume: null,
    setAudioDevice: null,
    hasVolumeControl: () => false
  };
}

export default {
  isOsControl,
  assertOsControl,
  createNoOpOsControl
};
