import { YamlMediaQueueDatastore } from '../adapters/persistence/YamlMediaQueueDatastore.mjs';
import { MediaQueueService } from '../application/MediaQueueService.mjs';

export function createMediaServices(config) {
  const { configService, defaultHouseholdId, logger = console } = config;

  const queueStore = new YamlMediaQueueDatastore({ configService });

  const mediaQueueService = new MediaQueueService({
    queueStore,
    defaultHouseholdId,
    logger,
  });

  return { queueStore, mediaQueueService };
}
