// backend/src/2_domains/home-automation/IDisplayPowerCheck.mjs

/**
 * IDisplayPowerCheck Port — query whether a device's display is on.
 *
 * Adapters (Home Assistant sensor, ADB dumpsys, etc.) implement this.
 * The domain policy consumes it to decide "ready for content?".
 *
 * @module domains/home-automation
 */

/**
 * @typedef {Object} DisplayPowerResult
 * @property {boolean} on - Whether the display is confirmed on
 * @property {string} state - Raw state value from the source ('on', 'off', 'unknown', 'unavailable')
 * @property {string} source - What provided this answer ('ha_sensor', 'adb', 'none')
 */

/**
 * Check if object implements IDisplayPowerCheck
 * @param {any} obj
 * @returns {boolean}
 */
export function isDisplayPowerCheck(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.isDisplayOn === 'function'
  );
}

/**
 * Create a no-op display power check (no sensor configured)
 * @returns {Object}
 */
export function createNoOpDisplayPowerCheck() {
  return {
    isDisplayOn: async () => ({ on: false, state: 'unknown', source: 'none' })
  };
}

export default { isDisplayPowerCheck, createNoOpDisplayPowerCheck };
