/**
 * DeviceService - Manages device registry and provides device access
 *
 * Loads device configurations from household config and builds Device instances
 * with appropriate capability adapters.
 *
 * @module applications/devices/services
 */

import { ApplicationError } from '#apps/shared/errors/index.mjs';

export class DeviceService {
  #devices;
  #deviceFactory;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} deps
   * @param {Object} deps.deviceFactory - Factory for building devices from config
   * @param {Object} [deps.logger]
   */
  constructor(config, deps = {}) {
    if (!deps.deviceFactory) {
      throw new ApplicationError('DeviceService requires deviceFactory', {
        code: 'MISSING_DEPENDENCY'
      });
    }

    this.#devices = new Map();
    this.#deviceFactory = deps.deviceFactory;
    this.#logger = deps.logger || console;
  }

  /**
   * Initialize devices from config
   * @param {Object} devicesConfig - Device configurations keyed by device ID
   * @returns {Promise<void>}
   */
  async initialize(devicesConfig) {
    if (!devicesConfig || typeof devicesConfig !== 'object') {
      this.#logger.warn?.('deviceService.initialize.noConfig');
      return;
    }

    this.#logger.info?.('deviceService.initialize', {
      deviceCount: Object.keys(devicesConfig).length
    });

    for (const [deviceId, config] of Object.entries(devicesConfig)) {
      try {
        const device = await this.#deviceFactory.build(deviceId, config);
        this.#devices.set(deviceId, device);
        this.#logger.info?.('deviceService.deviceRegistered', {
          deviceId,
          type: config.type,
          capabilities: device.getCapabilities()
        });
      } catch (error) {
        this.#logger.error?.('deviceService.deviceBuildError', {
          deviceId,
          error: error.message
        });
      }
    }
  }

  /**
   * Get a device by ID
   * @param {string} deviceId
   * @returns {import('./Device.mjs').Device | null}
   */
  get(deviceId) {
    return this.#devices.get(deviceId) || null;
  }

  /**
   * Get a device by ID, throw if not found
   * @param {string} deviceId
   * @returns {import('./Device.mjs').Device}
   * @throws {ApplicationError} if device not found
   */
  getOrThrow(deviceId) {
    const device = this.get(deviceId);
    if (!device) {
      throw new ApplicationError('Device not found', {
        code: 'DEVICE_NOT_FOUND',
        deviceId
      });
    }
    return device;
  }

  /**
   * List all device IDs
   * @returns {string[]}
   */
  listDeviceIds() {
    return Array.from(this.#devices.keys());
  }

  /**
   * List all devices with their info
   * @returns {Array<{id: string, type: string, capabilities: Object}>}
   */
  listDevices() {
    return Array.from(this.#devices.entries()).map(([id, device]) => ({
      id,
      type: device.type,
      capabilities: device.getCapabilities()
    }));
  }

  /**
   * Check if a device exists
   * @param {string} deviceId
   * @returns {boolean}
   */
  has(deviceId) {
    return this.#devices.has(deviceId);
  }

  /**
   * Get device count
   * @returns {number}
   */
  get count() {
    return this.#devices.size;
  }
}

export default DeviceService;
