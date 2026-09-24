// backend/src/5_composition/modules/triggerApi.mjs
// Composition wiring for Trigger API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { YamlTriggerConfigRepository } from '#adapters/trigger/YamlTriggerConfigRepository.mjs';
import { YamlObservedStateStore } from '#adapters/persistence/yaml/YamlObservedStateStore.mjs';
import { HttpEndpointGateway } from '#adapters/trigger/HttpEndpointGateway.mjs';
import { TriggerActuationGateway } from '#adapters/trigger/TriggerActuationGateway.mjs';
import { createTriggerRouter } from '#api/v1/routers/trigger.mjs';
import { dispatchSideEffect, TriggerSideEffectExecutor, UnknownSideEffectError } from '#apps/trigger/sideEffectHandlers.mjs';
import { TriggerDispatchService } from '#apps/trigger/TriggerDispatchService.mjs';
import { broadcastEvent, createDeviceServices, createWakeAndLoadService } from '../bootstrap.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { randomUUID } from 'node:crypto';
import { createVoiceTriggerService } from './voiceTrigger.mjs';

/**
 * Create Trigger application service + API router
 *
 * Trigger ties together the device dispatch surface (wakeAndLoadService for
 * play, deviceService for raw control, haGateway for HA scripts) with the
 * location-rooted trigger registry. The NFC modality source lives in
 * `triggers/sources.yml`; every modality (nfc, state, barcode, voice) feeds
 * the same registry under its own `type` slot. Voice transcripts
 * (POST /:location/voice) are handled by a VoiceTriggerService that dispatches
 * through the same TriggerDispatchService.
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
 * @param {Function} [config.onUnknownTag] - Told about every NFC tap that resolved to nothing ({location, uid, modality}), alongside the observed-registry write and the notify_unknown push (D9). Adds to them; replaces neither.
 * @param {Object[]} [config.contentInterceptors] - First refusal on a content dispatch, in order (the living-room reading session). Each may also suppress the reader location's `end` behaviour — see responseHandlers.content.
 * @param {Function} [config.screenBroadcast] - Screen-targeted broadcast helper (targetScreen, payload) used by contentDispatcher-driven flows
 * @param {Function} [config.commandResolver] - Resolves a raw scan/value string to a known command (e.g. resolveCommand)
 * @param {Object} [config.learnerActions] - Registry of what a school learner card DOES per reader (createLearnerActions). Absent, a learner tap answers `no_handler` by name.
 * @param {Object} [config.decisionGateway] - IDecisionGateway for voice transcripts (optional; null keeps voice exact-keyword only)
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
    onUnknownTag = null,
    screenBroadcast = null,
    commandResolver = null,
    learnerActions = null,
    decisionGateway = null,
    logger = console,
  } = config;

  const observedStore = new YamlObservedStateStore({ loadFile, saveFile });
  observedStore.load();
  const triggerConfigRepository = new YamlTriggerConfigRepository({ saveFile, observedStore });
  let triggerConfig;
  try {
    // One bad source or tag disables only itself; ERROR so it shows in a
    // `level:error` sweep, since that reader or card now does nothing.
    triggerConfig = triggerConfigRepository.loadRegistry({ loadFile, listDir,
      onSkip: (skip) => logger.error?.('trigger.config.entry.skipped', skip),
      // Loads, but probably wrong: a shadowed source, an unguarded voice source.
      onWarn: ({ event, ...data }) => logger.warn?.(event, data) });
    // Curated-out inbox stubs are swept AFTER the load, never during it: a read
    // must not depend on a write succeeding. Fire-and-forget — the registry in
    // memory is already correct, and a failed sweep only means the same stubs
    // get swept next boot.
    Promise.resolve(triggerConfigRepository.sweepInbox())
      .then(({ swept }) => {
        if (swept.length) logger.info?.('trigger.inbox.swept', { uids: swept, count: swept.length });
      })
      .catch((err) => logger.warn?.('trigger.inbox.sweep-failed', { error: err.message }));
  } catch (err) {
    // ERROR, not warn. This does not degrade one tag — it leaves EVERY tag in
    // the house unregistered, so a book card, an identity card and a reading
    // session all fail with "trigger-not-registered" and nothing on the surface
    // says why. It has to show up in a `level:error` sweep.
    logger.error?.('trigger.config.parse.failed', { error: err.message, impact: 'all-tags-unregistered' });
    triggerConfig = { nfc: { locations: {}, tags: {} }, state: { locations: {} }, barcode: { locations: {} }, voice: { locations: {} }, responses: {}, endpoints: {} };
  }

  const endpointGateway = new HttpEndpointGateway({ endpoints: triggerConfig.endpoints || {}, logger });
  const actuationGateway = new TriggerActuationGateway({
    deviceService: deviceServices.deviceService,
    homeGateway: haGateway,
    commandResolver,
    screenBroadcast,
  });

  const triggerDispatchService = new TriggerDispatchService({
    config: triggerConfig,
    contentIdResolver,
    wakeAndLoadService,
    actuationGateway,
    tagWriter: triggerConfigRepository,
    onUnknownTag,
    // The unknown-tag push names the room the reader's target device is in.
    locationLabel: (_location, locationConfig) => (locationConfig?.target
      ? deviceServices.deviceService?.get?.(locationConfig.target)?.location ?? null
      : null),
    contentDispatcher,
    contentInterceptors,
    endpointGateway,
    learnerActions,
    broadcast,
    createDispatchId: randomUUID,
    scheduler: new NodeApplicationScheduler(),
    logger,
  });

  const voiceTriggerService = createVoiceTriggerService({
    config: triggerConfig,
    decisionGateway,
    triggerDispatchService,
    createProposalId: randomUUID,
    logger,
  });

  const router = createTriggerRouter({
    triggerDispatchService,
    voiceTriggerService,
    sideEffectExecutor: new TriggerSideEffectExecutor({
      dispatch: (request) => dispatchSideEffect(request, {
        tvControlAdapter,
        deviceService: deviceServices.deviceService,
      }),
    }),
    isUnknownSideEffectError: (error) => error instanceof UnknownSideEffectError,
    logger,
  });

  // `triggerConfig` is the LIVE registry object the repository mutates in place
  // when a tag is renamed, not a copy — a consumer holding it sees a card
  // enrolled at runtime without a reload.
  return { triggerDispatchService, router, triggerConfig };
}
