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

/**
 * @param {Object} deps
 * @param {Object} deps.configService
 * @param {Object} [deps.eventBus] - browsers' playback_state frames refresh the registry
 * @param {Object} [deps.livenessService] - DeviceLivenessService
 * @param {Object} [deps.playLedger] - PlayLedgerRecorder
 * @param {Object} [deps.progressMemory] - media progress (spot moves on merge)
 * @param {Function} [deps.createMediaProgress]
 * @param {Object} deps.logger
 */
export function createMediaHouseModule({
  configService,
  eventBus = null,
  livenessService = null,
  playLedger = null,
  progressMemory = null,
  createMediaProgress = (props) => new MediaProgress(props),
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

  const router = createMediaHouseRouter({ screenRegistry, logger: log('media-house-api') });

  return { router, screenRegistry };
}

export default createMediaHouseModule;
