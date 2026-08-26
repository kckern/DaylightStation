// backend/src/5_composition/modules/triggerApi.mjs
// Composition wiring for Trigger API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';
import { YamlObservedStateStore } from '#adapters/persistence/yaml/YamlObservedStateStore.mjs';
import { HttpEndpointGateway } from '#adapters/trigger/HttpEndpointGateway.mjs';
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
 * @param {Function} [config.listDir] - Lists *.yml in a household-relative dir (grouped NFC tag files)
 * @param {Object} [config.contentDispatcher] - ContentDispatcher instance (optimistic content posture; shared with barcode ingress)
 * @param {Object[]} [config.contentInterceptors] - First refusal on a content dispatch, in order (the living-room reading session). Each may also suppress the reader location's `end` behaviour — see responseHandlers.content.
 * @param {Function} [config.screenBroadcast] - Screen-targeted broadcast helper (targetScreen, payload) used by contentDispatcher-driven flows
 * @param {Function} [config.commandResolver] - Resolves a raw scan/value string to a known command (e.g. resolveCommand)
 * @param {Object} [config.learnerActions] - Registry of what a school learner card DOES per reader (createLearnerActions). Absent, a learner tap answers `no_handler` by name.
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
    listDir = null,
    saveFile,
    contentDispatcher = null,
    contentInterceptors = [],
    screenBroadcast = null,
    commandResolver = null,
    learnerActions = null,
    logger = console,
  } = config;

  const observedStore = new YamlObservedStateStore({ loadFile, saveFile });
  observedStore.load();
  const triggerConfigRepository = new YamlTriggerConfigRepository({ saveFile, observedStore });
  let triggerConfig;
  try {
    triggerConfig = triggerConfigRepository.loadRegistry({ loadFile, listDir });
  } catch (err) {
    logger.warn?.('trigger.config.parse.failed', { error: err.message });
    triggerConfig = { nfc: { locations: {}, tags: {} }, state: { locations: {} }, responses: {}, endpoints: {} };
  }

  const endpointGateway = new HttpEndpointGateway({ endpoints: triggerConfig.endpoints || {}, logger });

  const triggerDispatchService = new TriggerDispatchService({
    config: triggerConfig,
    contentIdResolver,
    wakeAndLoadService,
    haGateway,
    deviceService: deviceServices.deviceService,
    tagWriter: triggerConfigRepository,
    contentDispatcher,
    contentInterceptors,
    screenBroadcast,
    commandResolver,
    endpointGateway,
    learnerActions,
    broadcast,
    logger,
  });

  const router = createTriggerRouter({
    triggerDispatchService,
    tvControlAdapter,
    deviceService: deviceServices.deviceService,
    logger,
  });

  // `triggerConfig` is the LIVE registry object the repository mutates in place
  // when a tag is renamed, not a copy — a consumer holding it sees a card
  // enrolled at runtime without a reload.
  return { triggerDispatchService, router, triggerConfig };
}
