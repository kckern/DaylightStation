// backend/src/5_composition/modules/mediaHouse.mjs
// Composition for the Media app's household layer: the screen registry,
// routines, how playback started, played earlier and suggestions.
// See docs/reference/media/media-app-technical.md §2.5–2.9.

import { createMediaHouseRouter } from '#api/v1/routers/mediaHouse.mjs';
import { ScreenRegistryService } from '#apps/media/ScreenRegistryService.mjs';
import { ScreenSignalsReader } from '#apps/media/ScreenSignalsReader.mjs';
import { YamlScreenRegistryDatastore } from '#adapters/persistence/yaml/YamlScreenRegistryDatastore.mjs';
import { ConfigMediaScreenCatalog } from '#adapters/devices/ConfigMediaScreenCatalog.mjs';
import { EventBusScreenPresence } from '#adapters/eventbus/EventBusScreenPresence.mjs';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import { RoutineCatalogService } from '#apps/media/RoutineCatalogService.mjs';
import { RoutineHistoryService } from '#apps/media/RoutineHistoryService.mjs';
import { RoutineLoadRecorder } from '#apps/media/RoutineLoadRecorder.mjs';
import { LoadOriginHints } from '#apps/media/LoadOriginHints.mjs';
import { RoutineTriggerDedupeService } from '#apps/devices/services/RoutineTriggerDedupeService.mjs';
import { YamlRoutineHistoryDatastore } from '#adapters/persistence/yaml/YamlRoutineHistoryDatastore.mjs';
import { YamlRoutineSnapshotDatastore } from '#adapters/persistence/yaml/YamlRoutineSnapshotDatastore.mjs';
import { HomeAssistantRoutineFileSource } from '#adapters/home-automation/HomeAssistantRoutineFileSource.mjs';
import { currentRequestContext } from '#system/runtime/requestContext.mjs';

/**
 * @param {Object} deps
 * @param {Object} deps.configService
 * @param {Object} [deps.eventBus] - browsers' playback_state frames refresh the registry
 * @param {Object} [deps.livenessService] - DeviceLivenessService
 * @param {Object} [deps.playLedger] - PlayLedgerRecorder
 * @param {Object} [deps.progressMemory] - media progress (spot moves on merge)
 * @param {Function} [deps.createMediaProgress]
 * @param {LoadOriginHints} [deps.originHints] - shared with the PlayLedgerRecorder
 * @param {Object} deps.logger
 * @returns {{router, screenRegistry, routineCatalog, routineHistory, originHints,
 *   wrapWakeAndLoad: (wakeAndLoad: {execute: Function}) => {execute: Function}}}
 */
export function createMediaHouseModule({
  configService,
  eventBus = null,
  livenessService = null,
  playLedger = null,
  progressMemory = null,
  createMediaProgress = (props) => new MediaProgress(props),
  originHints = new LoadOriginHints(),
  logger,
}) {
  const log = (module) => logger.child?.({ module }) ?? logger;

  const screenRegistry = new ScreenRegistryService({
    store: new YamlScreenRegistryDatastore({ configService }),
    configuredScreens: new ConfigMediaScreenCatalog({ configService }),
    signals: new ScreenSignalsReader({ livenessService, playLedger, logger: log('media-screens') }),
    progress: progressMemory,
    createMediaProgress,
    logger: log('media-screens'),
  });

  if (eventBus?.onClientMessage) {
    new EventBusScreenPresence({
      eventBus,
      onSeen: ({ id, name, room }) => screenRegistry.announce({ id, name, room }),
      logger: log('media-screens'),
    }).attach();
  }

  // Routines: Home Assistant config read in place when this process can see
  // it (system config media-routines.yml `homeAssistant.configDir`), else the
  // last imported snapshot; plus routines only the history has seen.
  const routinesConfig = configService.getAppConfig?.('media-routines') || {};
  const routineLog = log('media-routines');
  const historyStore = new YamlRoutineHistoryDatastore({ configService });
  const routineCatalog = new RoutineCatalogService({
    liveSources: [new HomeAssistantRoutineFileSource({ ...(routinesConfig.homeAssistant || {}), logger: routineLog })],
    snapshots: new YamlRoutineSnapshotDatastore({ configService }),
    history: historyStore,
    logger: routineLog,
  });
  screenRegistry.setRoutineCatalog(routineCatalog);
  const routineHistory = new RoutineHistoryService({
    store: historyStore, catalog: routineCatalog, screens: screenRegistry, playLedger, logger: routineLog,
  });
  const routineDedupe = new RoutineTriggerDedupeService();

  const wrapWakeAndLoad = (wakeAndLoad) => (wakeAndLoad
    ? new RoutineLoadRecorder({
      wakeAndLoad,
      context: currentRequestContext,
      catalog: routineCatalog,
      history: routineHistory,
      hints: originHints,
      dedupe: routineDedupe,
      logger: routineLog,
    })
    : null);

  const router = createMediaHouseRouter({ screenRegistry, routineCatalog, routineHistory, logger: log('media-house-api') });

  return { router, screenRegistry, routineCatalog, routineHistory, originHints, wrapWakeAndLoad };
}

export default createMediaHouseModule;
