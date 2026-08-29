/**
 * DeviceFactory - Builds Device instances from configuration
 *
 * Constructs Device aggregates from semantic blueprints. Translation of raw
 * deployment config and concrete capability construction belongs to the
 * injected IDeviceBlueprintFactory adapter.
 *
 * @module applications/devices/services
 */

import { Device } from './Device.mjs';
import { isDeviceBlueprintFactory } from '../ports/IDeviceBlueprintFactory.mjs';

export class DeviceFactory {
  #blueprintFactory;
  #logger;

  /**
   * @param {Object} config
   * @param {import('../ports/IDeviceBlueprintFactory.mjs').IDeviceBlueprintFactory} config.blueprintFactory
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!isDeviceBlueprintFactory(config?.blueprintFactory)) {
      throw new TypeError('DeviceFactory requires blueprintFactory.createBlueprint');
    }
    this.#blueprintFactory = config.blueprintFactory;
    this.#logger = config.logger || console;
  }

  /**
   * Build a Device from configuration
   * @param {string} deviceId - Device identifier
   * @param {Object} deviceConfig - Device configuration
   * @returns {Promise<Device>}
   */
  async build(deviceId, deviceConfig) {
    this.#logger.debug?.('deviceFactory.build', { deviceId });
    const blueprint = await this.#blueprintFactory.createBlueprint(deviceId, deviceConfig);
    if (!blueprint?.descriptor || !blueprint?.capabilities) {
      throw new TypeError('blueprintFactory returned an invalid device blueprint');
    }
    return new Device(blueprint.descriptor, blueprint.capabilities, { logger: this.#logger });
  }
}

export default DeviceFactory;
