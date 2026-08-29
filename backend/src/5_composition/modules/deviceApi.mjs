// backend/src/5_composition/modules/deviceApi.mjs
// Composition wiring for Device API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createDeviceRouter } from '#api/v1/routers/device.mjs';
import { getScreenOverrideService } from '#composition/modules/screenOverride.mjs';
import { contentRequiresCamera } from '#apps/devices/services/contentRequiresCamera.mjs';
import { DispatchIdempotencyService } from '#apps/devices/services/DispatchIdempotencyService.mjs';
import { DeviceFleetControlService } from '#apps/devices/services/DeviceFleetControlService.mjs';
import { DevicePresenceService } from '#apps/devices/services/DevicePresenceService.mjs';
import { DeviceSessionApiService } from '#apps/devices/services/DeviceSessionApiService.mjs';
import { DeviceScreenControlService } from '#apps/devices/services/DeviceScreenControlService.mjs';
import { DeviceContentDispatchService } from '#apps/devices/services/DeviceContentDispatchService.mjs';
import { DeviceRecoveryService } from '#apps/devices/services/DeviceRecoveryService.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { ConfigDeviceConfiguration } from '#adapters/devices/ConfigDeviceConfiguration.mjs';
import { ConfigKeyboardBindingCatalog } from '#adapters/devices/ConfigKeyboardBindingCatalog.mjs';
import { ScreenAddressResolver } from '#adapters/devices/ScreenAddressResolver.mjs';

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
    callControl,
    logger = console
  } = config;

  const devices = deviceServices.deviceService;
  const configuration = new ConfigDeviceConfiguration({ configService });
  const keyboardBindings = typeof loadFile === 'function'
    ? new ConfigKeyboardBindingCatalog({ loadFile })
    : null;
  const idempotency = dispatchIdempotencyService
    ?? new DispatchIdempotencyService({ clock: { now: () => Date.now() }, logger });

  return createDeviceRouter({
    fleetService: new DeviceFleetControlService({
      devices,
      configuration,
      callControl,
      logger,
    }),
    presenceService: new DevicePresenceService({
      store: config.presenceStore ?? null,
      readGate: config.readGate ?? null,
    }),
    sessionService: new DeviceSessionApiService({ sessionControl: sessionControlService, logger }),
    screenService: new DeviceScreenControlService({
      devices,
      configuration,
      screenOverrides: getScreenOverrideService(),
      midiWake: pianoMidiWakeService,
      logger,
    }),
    dispatchService: new DeviceContentDispatchService({
      wakeAndLoad: wakeAndLoadService,
      idempotency,
      configuration,
      keyboardBindings,
      logger,
    }),
    recoveryService: new DeviceRecoveryService({
      devices, contentRequiresCamera, screenAddressResolver: new ScreenAddressResolver(),
      scheduler: new NodeApplicationScheduler(), logger,
    }),
  });
}
