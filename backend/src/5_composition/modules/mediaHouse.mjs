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
import { EventBusBrowserPlayback } from '#adapters/eventbus/EventBusBrowserPlayback.mjs';
import { BrowserPlaybackTracker } from '#apps/media/BrowserPlaybackTracker.mjs';
import { RoutineCatalogService } from '#apps/media/RoutineCatalogService.mjs';
import { RoutineHistoryService } from '#apps/media/RoutineHistoryService.mjs';
import { RoutineLoadRecorder } from '#apps/media/RoutineLoadRecorder.mjs';
import { LoadOriginHints } from '#apps/media/LoadOriginHints.mjs';
import { RoutineTriggerDedupeService } from '#apps/devices/services/RoutineTriggerDedupeService.mjs';
import { YamlRoutineHistoryDatastore } from '#adapters/persistence/yaml/YamlRoutineHistoryDatastore.mjs';
import { YamlRoutineSnapshotDatastore } from '#adapters/persistence/yaml/YamlRoutineSnapshotDatastore.mjs';
import { HomeAssistantRoutineFileSource } from '#adapters/home-automation/HomeAssistantRoutineFileSource.mjs';
import { currentRequestContext } from '#system/runtime/requestContext.mjs';
import { ScreenPlaybackService } from '#apps/media/ScreenPlaybackService.mjs';
import { MediaSuggestionsService } from '#apps/media/MediaSuggestionsService.mjs';

/**
 * @param {Object} deps
 * @param {Object} deps.configService
 * @param {Object} [deps.eventBus] - browsers' playback_state frames refresh the registry
 * @param {Object} [deps.livenessService] - DeviceLivenessService
 * @param {Object} [deps.playLedger] - PlayLedgerRecorder
 * @param {Object} [deps.progressMemory] - media progress (spot folds on merge/unmerge; needs updateSpots)
 * @param {LoadOriginHints} [deps.originHints] - shared with the PlayLedgerRecorder
 * @param {Object} [deps.householdMediaMemory] - HouseholdMediaMemoryService (display fields, now playing)
 * @param {{getRecentlyAdded: Function}|null} [deps.plexAdapter] - "New" suggestions
 * @param {Function} [deps.nowLocal] - local `YYYY-MM-DD HH:mm:ss` (time-of-day suggestions)
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
  originHints = new LoadOriginHints(),
  householdMediaMemory = null,
  plexAdapter = null,
  nowLocal = null,
  logger,
}) {
  const log = (module) => logger.child?.({ module }) ?? logger;

  const screenRegistry = new ScreenRegistryService({
    store: new YamlScreenRegistryDatastore({ configService }),
    configuredScreens: new ConfigMediaScreenCatalog({ configService }),
    signals: new ScreenSignalsReader({ livenessService, playLedger, logger: log('media-screens') }),
    progress: progressMemory,
    logger: log('media-screens'),
  });

  if (eventBus?.onClientMessage) {
    new EventBusScreenPresence({
      eventBus,
      onSeen: ({ id, name, room, playing }) => screenRegistry.announce({ id, name, room, playing }),
      logger: log('media-screens'),
    }).attach();
  }

  // What each browser tab says it is playing and who started it (started-by).
  const browserPlayback = new BrowserPlaybackTracker();
  if (eventBus?.onClientMessage) new EventBusBrowserPlayback({ eventBus, tracker: browserPlayback }).attach();

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
    playLedger,
    logger: routineLog,
  });
  screenRegistry.setRoutineCatalog(routineCatalog);
  // Warm it: the load path only ever takes a cache hit (peekMatch).
  routineCatalog.peek();
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

  const screenPlayback = playLedger
    ? new ScreenPlaybackService({
      playLedger, livenessService, memory: householdMediaMemory, screens: screenRegistry, browserPlayback, logger: log('media-screen-playback'),
    })
    : null;

  const suggestions = householdMediaMemory && nowLocal
    ? new MediaSuggestionsService({
      memory: householdMediaMemory,
      playLedger,
      recentAdditions: typeof plexAdapter?.getRecentlyAdded === 'function'
        ? { list: ({ since, limit }) => plexAdapter.getRecentlyAdded({ since, limit }) }
        : null,
      screens: screenRegistry,
      nowLocal,
      logger: log('media-suggestions'),
    })
    : null;

  // Suggestions cache candidates for 5 min; a removal, restore or watched
  // mark must show at once on every screen (FIND.13a/AC2, FIND.10a/AC6).
  if (suggestions && typeof householdMediaMemory?.onListChanged === 'function') {
    // Process-lifetime subscription: this module has no teardown path, and the
    // memory service lives exactly as long as the process, so the returned
    // unsubscribe is intentionally not kept.
    householdMediaMemory.onListChanged(({ householdId }) => {
      if (householdId == null) suggestions.invalidateAll();
      else suggestions.invalidate(householdId);
    });
  }

  const router = createMediaHouseRouter({
    screenRegistry, routineCatalog, routineHistory, screenPlayback, suggestions,
    householdExists: typeof configService.householdExists === 'function' ? (h) => configService.householdExists(h) : null,
    logger: log('media-house-api'),
  });

  return { router, screenRegistry, routineCatalog, routineHistory, screenPlayback, suggestions, originHints, wrapWakeAndLoad };
}

export default createMediaHouseModule;
