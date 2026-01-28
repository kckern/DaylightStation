/**
 * IDeviceControl Port - Hardware power and state control
 *
 * Abstraction for device power control (on/off/toggle) and optional volume.
 * Implemented by HomeAssistantDeviceAdapter.
 *
 * @module applications/devices/ports
 */

/**
 * @typedef {Object} DeviceControlResult
 * @property {boolean} ok - Whether operation succeeded
 * @property {string} [displayId] - Display that was controlled
 * @property {string} [previousState] - State before operation
 * @property {string} [currentState] - State after operation
 * @property {number} [elapsedMs] - Time taken
 * @property {string} [error] - Error message if failed
 */

/**
 * @typedef {Object} DeviceState
 * @property {string} state - Current power state ('on', 'off', 'unknown')
 * @property {Object.<string, string>} displays - State per display
 */

/**
 * Check if object implements IDeviceControl
 * @param {any} obj
 * @returns {boolean}
 */
export function isDeviceControl(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.powerOn === 'function' &&
    typeof obj.powerOff === 'function' &&
    typeof obj.getState === 'function'
  );
}

/**
 * Assert that object implements IDeviceControl
 * @param {any} obj
 * @param {string} [context]
 * @throws {Error} if object doesn't implement interface
 */
export function assertDeviceControl(obj, context = 'DeviceControl') {
  if (!isDeviceControl(obj)) {
    throw new Error(`${context} must implement IDeviceControl interface`);
  }
}

/**
 * Create a no-op device control (for devices without this capability)
 * @returns {Object}
 */
export function createNoOpDeviceControl() {
  return {
    powerOn: async () => ({ ok: false, error: 'Device control not configured' }),
    powerOff: async () => ({ ok: false, error: 'Device control not configured' }),
    getState: async () => ({ state: 'unknown', displays: {} }),
    setVolume: null,
    hasVolumeControl: () => false
  };
}

export default {
  isDeviceControl,
  assertDeviceControl,
  createNoOpDeviceControl
};
