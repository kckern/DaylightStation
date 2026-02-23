// backend/src/1_adapters/home-automation/HaSensorDisplayPowerCheck.mjs

/**
 * HaSensorDisplayPowerCheck — checks display power via HA state sensor.
 *
 * Implements IDisplayPowerCheck port using the Home Assistant gateway.
 * Reads the binary_sensor/input_boolean configured as state_sensor for
 * the device's display.
 *
 * @module adapters/home-automation
 */

export class HaSensorDisplayPowerCheck {
  #gateway;
  #sensorMap; // deviceId -> sensorEntityId
  #logger;

  /**
   * @param {Object} config
   * @param {Object.<string, string>} config.sensorMap - Map of deviceId to HA sensor entity
   * @param {Object} deps
   * @param {Object} deps.gateway - Home Assistant gateway (getState method)
   * @param {Object} [deps.logger]
   */
  constructor(config, deps) {
    this.#gateway = deps.gateway;
    this.#sensorMap = config.sensorMap || {};
    this.#logger = deps.logger || console;
  }

  /**
   * Check if the device's display is on.
   * @param {string} deviceId
   * @returns {Promise<DisplayPowerResult>}
   */
  async isDisplayOn(deviceId) {
    const sensor = this.#sensorMap[deviceId];

    if (!sensor) {
      this.#logger.debug?.('ha-sensor-power-check.no-sensor', { deviceId });
      return { on: false, state: 'unknown', source: 'none' };
    }

    try {
      const result = await this.#gateway.getState(sensor);
      const state = result?.state || 'unknown';
      const isOn = state === 'on';

      this.#logger.debug?.('ha-sensor-power-check.result', {
        deviceId, sensor, state, isOn
      });

      return { on: isOn, state, source: 'ha_sensor' };
    } catch (err) {
      this.#logger.warn?.('ha-sensor-power-check.error', {
        deviceId, sensor, error: err.message
      });
      return { on: false, state: 'error', source: 'ha_sensor' };
    }
  }
}
