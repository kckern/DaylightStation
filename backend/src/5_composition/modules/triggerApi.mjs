// backend/src/5_composition/modules/triggerApi.mjs
// Composition wiring for Trigger API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';
import { YamlObservedStateStore } from '#adapters/persistence/yaml/YamlObservedStateStore.mjs';
import { createTriggerRouter } from '#api/v1/routers/trigger.mjs';
import { TriggerDispatchService } from '#apps/trigger/TriggerDispatchService.mjs';
import { broadcastEvent, createDeviceServices, createWakeAndLoadService } from '../bootstrap.mjs';

/**
 * Create Trigger application service + API router
 *
 * Trigger ties together the device dispatch surface (wakeAndLoadService for
 * play, deviceService for raw control, haGateway for HA scripts) with the
 * location-rooted trigger registry. The NFC modality source lives in
 * `data/household[-{hid}]/apps/nfc/config.yml`. Future modalities (barcode,
 * voice) feed the same registry under different `type` slots.
 *
 * Bootstrap is tolerant of stale/legacy YAML shapes: a parse failure logs a
 * warning and yields an empty registry (all triggers 404 with
 * LOCATION_NOT_FOUND). This keeps the rest of the API healthy while operators
 * migrate the file.
 *
 * @param {Object} config
 * @param {Object} config.deviceServices - Services from createDeviceServices
 * @param {Object} config.wakeAndLoadService - From createWakeAndLoadService
 * @param {Object} [config.haGateway] - Home Assistant gateway (optional, but required for ha-script actions)
 * @param {Object} config.contentIdResolver - From content services (used by resolveIntent)
 * @param {Function} config.broadcast - WebSocket broadcast function (broadcastEvent)
 * @param {Function} config.loadFile - Helper that loads YAML files relative to household dir
 * @param {Object} [config.logger] - Logger instance
 * @returns {{ triggerDispatchService: TriggerDispatchService, router: import('express').Router }}
 */
export function createTriggerApiRouter(config) {
  const {
    deviceServices,
    wakeAndLoadService,
    haGateway,
    tvControlAdapter = null,
    contentIdResolver,
    broadcast,
    loadFile,
    saveFile,
    logger = console,
  } = config;

  const observedStore = new YamlObservedStateStore({ loadFile, saveFile });
  observedStore.load();
  const triggerConfigRepository = new YamlTriggerConfigRepository({ saveFile, observedStore });
  let triggerConfig;
  try {
    triggerConfig = triggerConfigRepository.loadRegistry({ loadFile });
  } catch (err) {
    logger.warn?.('trigger.config.parse.failed', { error: err.message });
    triggerConfig = { nfc: { locations: {}, tags: {} }, state: { locations: {} }, responses: {}, endpoints: {} };
  }

  const triggerDispatchService = new TriggerDispatchService({
    config: triggerConfig,
    contentIdResolver,
    wakeAndLoadService,
    haGateway,
    deviceService: deviceServices.deviceService,
    tagWriter: triggerConfigRepository,
    broadcast,
    logger,
  });

  const router = createTriggerRouter({
    triggerDispatchService,
    tvControlAdapter,
    deviceService: deviceServices.deviceService,
    logger,
  });

  return { triggerDispatchService, router };
}
