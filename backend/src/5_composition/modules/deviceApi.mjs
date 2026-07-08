// backend/src/5_composition/modules/deviceApi.mjs
// Composition wiring for Device API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createDeviceRouter } from '#api/v1/routers/device.mjs';
import { createDeviceServices } from '../bootstrap.mjs';

/**
 * Create device API router
 * @param {Object} config
 * @param {Object} config.deviceServices - Services from createDeviceServices
 * @param {import('#system/config/index.mjs').ConfigService} [config.configService] - Config service for device configuration
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createDeviceApiRouter(config) {
  const {
    deviceServices,
    wakeAndLoadService,
    sessionControlService,
    dispatchIdempotencyService,
    configService,
    loadFile,
    pianoMidiWakeService,
    logger = console
  } = config;

  return createDeviceRouter({
    deviceService: deviceServices.deviceService,
    wakeAndLoadService,
    sessionControlService,
    dispatchIdempotencyService,
    configService,
    loadFile,
    pianoMidiWakeService,
    logger
  });
}
