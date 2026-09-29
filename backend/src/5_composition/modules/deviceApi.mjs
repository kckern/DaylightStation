// backend/src/5_composition/modules/deviceApi.mjs
// Composition wiring for Device API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createDeviceRouter } from '#api/v1/routers/device.mjs';
import { getScreenOverrideService } from '#composition/modules/screenOverride.mjs';
import { getVolumeBoostService } from '#composition/modules/volumeBoost.mjs';
import { contentRequiresCamera } from '#apps/devices/services/contentRequiresCamera.mjs';
import { DispatchIdempotencyService } from '#apps/devices/services/DispatchIdempotencyService.mjs';
import { DeviceFleetControlService } from '#apps/devices/services/DeviceFleetControlService.mjs';
import { DevicePresenceService } from '#apps/devices/services/DevicePresenceService.mjs';
import { DeviceSessionApiService } from '#apps/devices/services/DeviceSessionApiService.mjs';
import { DeviceScreenControlService } from '#apps/devices/services/DeviceScreenControlService.mjs';
import { DeviceContentDispatchService } from '#apps/devices/services/DeviceContentDispatchService.mjs';
import { DeviceRecoveryService } from '#apps/devices/services/DeviceRecoveryService.mjs';
import { AndroidExcursionGuard } from '#apps/devices/services/AndroidExcursionGuard.mjs';
import { AdbAdapter } from '#adapters/devices/AdbAdapter.mjs';
import { AndroidForegroundProbe } from '#adapters/devices/AndroidForegroundProbe.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { ConfigDeviceConfiguration } from '#adapters/devices/ConfigDeviceConfiguration.mjs';
import { ConfigKeyboardBindingCatalog } from '#adapters/devices/ConfigKeyboardBindingCatalog.mjs';
import { ScreenAddressResolver } from '#adapters/devices/ScreenAddressResolver.mjs';

// Which screens a kiosk-launched excursion may reach before the guard sends the
// device home. Settings is the one that needs it: opening its pairing screen
// otherwise opens all of Settings (see AndroidExcursionGuard).
const EXCURSION_POLICIES = Object.freeze({
  'com.android.tv.settings': { allow: ['.accessories.'], maxMs: 10 * 60_000 },
});

/** A foreground probe per ADB-reachable Fully Kiosk device, built on first use. */
function createExcursionProbes({ configService, logger }) {
  const probes = new Map();
  return (deviceId) => {
    if (probes.has(deviceId)) return probes.get(deviceId);
    const control = configService?.getDeviceConfig?.(deviceId)?.content_control;
    const fallback = control?.provider === 'fully-kiosk' ? control.fallback : null;
    const probe = fallback?.provider === 'adb' && fallback.host
      ? new AndroidForegroundProbe({ adbAdapter: new AdbAdapter({ host: fallback.host, port: fallback.port }, { logger }), logger })
      : null;
    probes.set(deviceId, probe);
    return probe;
  };
}

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
    kioskFrictionTracker,
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
      volumeBoosts: getVolumeBoostService(),
      scheduler: new NodeApplicationScheduler(),
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
    kioskFrictionTracker,
    excursionGuard: new AndroidExcursionGuard({
      probeFor: createExcursionProbes({ configService, logger }),
      policies: EXCURSION_POLICIES,
      kioskPackage: 'de.ozerov.fully',
      scheduler: new NodeApplicationScheduler(),
      logger,
    }),
  });
}
