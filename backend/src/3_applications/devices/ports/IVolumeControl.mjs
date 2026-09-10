/**
 * IVolumeControl Port — hardware audio level for a device.
 *
 * Distinct from IOsControl (SSH `amixer`) and from the `volume_script` hanging
 * off IDeviceControl (Home Assistant). Those two grew out of devices that had a
 * shell or an HA entity; a kiosk panel has neither, and its only remote surface
 * is the kiosk app itself. This port is the seam for "something already on the
 * device owns the audio level, and we ask it nicely".
 *
 * Levels are 0..100 for the caller's convenience. Implementations map that onto
 * whatever the hardware actually offers, which is rarely 100 steps —
 * `appliedIndex` / `maxIndex` report what it landed on so a caller can tell the
 * difference between "set to 55" and "set to the 10th of 18 notches".
 *
 * @module applications/devices/ports
 */

/**
 * @typedef {Object} VolumeControlResult
 * @property {boolean} ok
 * @property {number} [level] - The 0..100 level that was requested of the hardware
 * @property {number} [appliedIndex] - Hardware index actually selected, when known
 * @property {number} [maxIndex] - Hardware maximum index, when known
 * @property {string} [error]
 */

/**
 * Check if object implements IVolumeControl
 * @param {any} obj
 * @returns {boolean}
 */
export function isVolumeControl(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.setVolume === 'function' &&
    typeof obj.hasVolumeControl === 'function'
  );
}

/**
 * Assert that object implements IVolumeControl
 * @param {any} obj
 * @param {string} [context]
 * @throws {Error} if object doesn't implement interface
 */
export function assertVolumeControl(obj, context = 'VolumeControl') {
  if (!isVolumeControl(obj)) {
    throw new Error(`${context} must implement IVolumeControl interface`);
  }
}

export class IVolumeControl {
  async setVolume() { throw new Error('IVolumeControl.setVolume not implemented'); }
  async getVolume() { throw new Error('IVolumeControl.getVolume not implemented'); }
  hasVolumeControl() { return false; }
}

/**
 * Create a no-op volume control (for devices without this capability)
 * @returns {Object}
 */
export function createNoOpVolumeControl() {
  return {
    setVolume: async () => ({ ok: false, error: 'Volume control not configured' }),
    getVolume: async () => ({ ok: false, error: 'Volume control not configured' }),
    hasVolumeControl: () => false,
  };
}

export default {
  isVolumeControl,
  assertVolumeControl,
  createNoOpVolumeControl,
};
