import {HttpClient} from '#system/services/HttpClient.mjs';
import {NodeApplicationScheduler} from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import {PlaybackHubContainer} from '../application/playback-hub/PlaybackHubContainer.mjs';
import {HttpPlaybackHubAdapter} from '../adapters/playback-hub/HttpPlaybackHubAdapter.mjs';
import {YamlHubConfigDatastore} from '../adapters/playback-hub/YamlHubConfigDatastore.mjs';
import {createPlaybackHubRouter} from '../api/playbackHub.mjs';

export async function createPlaybackHubServices(config) {
  const { configService, eventBus, logger = console } = config;

  const services = configService.getAllServices?.() ?? {};
  const hubServiceCfg = services.playback_hub;
  if (!hubServiceCfg) {
    logger.warn?.('playback-hub.disabled', { reason: 'services.playback_hub missing' });
    return null;
  }
  const baseUrl = hubServiceCfg.docker;
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    logger.warn?.('playback-hub.disabled', { reason: 'services.playback_hub.docker missing' });
    return null;
  }
  const requestTimeoutSec = typeof hubServiceCfg.request_timeout_sec === 'number'
    ? hubServiceCfg.request_timeout_sec
    : 2;

  const gateway = new HttpPlaybackHubAdapter({
    baseUrl,
    requestTimeoutSec,
    // The broadcaster owns outage reporting and recovery.  Keep the generic
    // transport's per-probe network error out of the production error stream;
    // otherwise a physically offline hub emits two alarming records every
    // retry despite the broadcaster already exposing one actionable warning.
    httpClient: new HttpClient({
      logger: {
        debug: logger.debug?.bind(logger),
        error: () => {},
      },
    }),
    logger,
  });

  // Resolve through the registry rather than hardcoding, so the read side
  // (configLoader) and this write-capable datastore can never disagree about
  // which file is authoritative. Returns an ABSOLUTE path WITH extension —
  // the same shape the hardcoded path.join produced.
  const yamlPath = configService.getHouseholdAppConfigPath(null, 'playback-hub');
  const configRepository = new YamlHubConfigDatastore({
    yamlPath,
    logger,
  });

  // Adapter from WebSocketEventBus to the broadcaster's expected publisher
  // shape. Broadcaster publishes `{ topic, type, data }`; the bus internally
  // multiplexes by topic. We forward the payload (including type+data) under
  // the supplied topic so WS subscribers receive the full envelope.
  const eventPublisher = {
    publish(payload) {
      if (!payload || typeof payload !== 'object') return;
      const { topic, ...rest } = payload;
      if (typeof topic !== 'string' || topic.length === 0) return;
      eventBus.broadcast(topic, rest);
    },
  };

  const container = new PlaybackHubContainer({
    gateway,
    configRepository,
    eventPublisher,
    logger,
    broadcasterOptions: {
      intervalMs: 3000, maxBackoffMs: 30000,
      scheduler: new NodeApplicationScheduler(),
    },
  });
  await container.start();

  const router = createPlaybackHubRouter({
    operations: {
      getHubStatus: container.getHubStatus,
      getHubConfig: container.getHubConfig,
      sendHubCommand: container.sendHubCommand,
      updateDeviceConfig: container.updateDeviceConfig,
      saveScheduledFire: container.saveScheduledFire,
      deleteScheduledFire: container.deleteScheduledFire,
      verifyAudioFlowing: container.verifyAudioFlowing,
    },
    logger,
  });

  logger.info?.('playback-hub.bootstrap.complete', { baseUrl, requestTimeoutSec, yamlPath });
  return { container, router };
}
