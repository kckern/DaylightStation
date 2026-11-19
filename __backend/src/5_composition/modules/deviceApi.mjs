import { createPianoScreenHoldPolicy } from "../../../../__app_modules/learning/piano/server/application/screenHoldPolicy.mjs";
// __backend/src/5_composition/modules/deviceApi.mjs
// Composition wiring for Device API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createDeviceRouter } from '#api/v1/routers/device.mjs';
import { getScreenOverrideService } from '#composition/modules/screenOverride.mjs';
import { getVolumeBoostService } from '#composition/modules/volumeBoost.mjs';
import { contentRequiresCamera } from "../policies/contentRequiresCamera.mjs";
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
import { DaylightAndroidForegroundProbe } from '#adapters/devices/DaylightAndroidForegroundProbe.mjs';
import { DaylightAndroidRestClient } from '#adapters/devices/DaylightAndroidRestClient.mjs';
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

/** The package AndroidExcursionGuard recognises as "the kiosk is in front". */
const EXCURSION_KIOSK_PACKAGE = 'de.ozerov.fully';

/**
 * A foreground probe per kiosk device, built on first use.
 *
 * A Fully Kiosk device is probed over ADB, so it needs an `adb` fallback. A
 * device on the Android kiosk app is asked through its control API and needs
 * none; it reports the kiosk itself, so the probe answers with the guard's
 * kiosk package whatever the app's own package is.
 */
export function createExcursionProbes({ configService, httpClient = null, kioskPackage = EXCURSION_KIOSK_PACKAGE, logger }) {
  const probes = new Map();
  const build = (deviceId) => {
    const control = configService?.getDeviceConfig?.(deviceId)?.content_control;
    if (control?.provider === 'daylight-android') {
      if (!control.host || !httpClient) return null;
      // The token comes from the household auth file only; one written into
      // devices.yml is ignored.
      if (control.token) logger?.warn?.('device.excursion.inline_token_ignored', { deviceId });
      const token = control.auth_ref ? configService?.getHouseholdAuth?.(control.auth_ref)?.[deviceId]?.token : null;
      return new DaylightAndroidForegroundProbe({
        restClient: new DaylightAndroidRestClient(
          { host: control.host, port: control.port, token: token || '' },
          { httpClient, logger },
        ),
        kioskPackage,
        logger,
      });
    }
    const fallback = control?.provider === 'fully-kiosk' ? control.fallback : null;
    return fallback?.provider === 'adb' && fallback.host
      ? new AndroidForegroundProbe({ adbAdapter: new AdbAdapter({ host: fallback.host, port: fallback.port }, { logger }), logger })
      : null;
  };
  return (deviceId) => {
    if (!probes.has(deviceId)) probes.set(deviceId, build(deviceId));
    return probes.get(deviceId);
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
    startStatusService = null,
    httpClient = null,
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
      holdPolicy: createPianoScreenHoldPolicy({ getPianoConfig: () => configService?.getHouseholdAppConfig?.(null, 'piano') || {} }),
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
    startStatusService,
    excursionGuard: new AndroidExcursionGuard({
      probeFor: createExcursionProbes({ configService, httpClient, logger }),
      policies: EXCURSION_POLICIES,
      kioskPackage: EXCURSION_KIOSK_PACKAGE,
      scheduler: new NodeApplicationScheduler(),
      logger,
    }),
  });
}
