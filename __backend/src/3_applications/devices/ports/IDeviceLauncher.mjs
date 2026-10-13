/**
 * IDeviceLauncher Port - Launch content on a target device
 *
 * Abstraction for launching content (apps, games, URLs) on devices.
 * Implemented by device-specific adapters (AdbLauncher, SshLauncher, etc.)
 *
 * @module applications/devices/ports
 */

/**
 * @typedef {Object} LaunchIntent
 * @property {string} target - Launch target identifier (package name, URL, etc.)
 * @property {Object} params - Launch parameters
 */

/**
 * @typedef {Object} LaunchResult
 * @property {boolean} ok - Whether operation succeeded
 * @property {string} [error] - Error message if failed
 */

/**
 * Port for launching content on a target device.
 * Implemented by device-specific adapters (AdbLauncher, SshLauncher, etc.)
 */
export class IDeviceLauncher {
  /**
   * Execute a launch intent on a device
   * @param {string} deviceId
   * @param {LaunchIntent} launchIntent
   * @returns {Promise<LaunchResult>}
   */
  async launch(deviceId, launchIntent) {
    throw new Error('IDeviceLauncher.launch must be implemented');
  }

  /**
   * Check if a device supports launching
   * @param {string} deviceId
   * @returns {Promise<boolean>}
   */
  async canLaunch(deviceId) {
    throw new Error('IDeviceLauncher.canLaunch must be implemented');
  }
}

/**
 * Duck-type check for IDeviceLauncher compliance
 * @param {any} obj
 * @returns {boolean}
 */
export function isDeviceLauncher(obj) {
  return obj != null &&
    typeof obj.launch === 'function' &&
    typeof obj.canLaunch === 'function';
}

/**
 * Assert that object implements IDeviceLauncher
 * @param {any} obj
 * @param {string} [context]
 * @throws {Error} if object doesn't implement interface
 */
export function assertDeviceLauncher(obj, context = 'DeviceLauncher') {
  if (!isDeviceLauncher(obj)) {
    throw new Error(`${context} must implement IDeviceLauncher interface`);
  }
}

/**
 * Create a no-op device launcher (for devices without this capability)
 * @returns {Object}
 */
export function createNoOpDeviceLauncher() {
  return {
    launch: async () => ({ ok: false, error: 'Device launcher not configured' }),
    canLaunch: async () => false
  };
}

export default {
  IDeviceLauncher,
  isDeviceLauncher,
  assertDeviceLauncher,
  createNoOpDeviceLauncher
};
