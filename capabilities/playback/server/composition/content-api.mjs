import { createQueueRouter } from "../api/queue.mjs";
import { ContentExpression } from "../../../content-catalog/server/domain/ContentExpression.mjs";
import { ContentAccessService } from "../../../content-catalog/server/application/ContentAccessService.mjs";
import { QueueService } from "../application/services/QueueService.mjs";
import { QueuePresentationService } from "../application/QueuePresentationService.mjs";
import { planSurroundQueue } from "../application/services/surroundQueuePlan.mjs";
import { YamlSurroundStore } from "../adapters/surround/YamlSurroundStore.mjs";
import { SurroundConfigProjection } from "../adapters/surround/SurroundConfigProjection.mjs";
import { PlayResponseService } from "../application/services/PlayResponseService.mjs";
import path from "path";
import { MediaProgress } from "../../../content-catalog/server/progress.mjs";
import { PlaybackReadService } from "../application/services/PlaybackReadService.mjs";
import { UpdateContentProgress } from "../application/usecases/UpdateContentProgress.mjs";
import { MarkContentWatched } from "../application/usecases/MarkContentWatched.mjs";
import { RecordPlaybackProgress } from "../application/usecases/RecordPlaybackProgress.mjs";
import { nowTs24 } from "#system/utils/index.mjs";
import { PlaybackPublications } from "#adapters/eventbus/PlaybackPublications.mjs";

export function createPlaybackSurroundContext({ dataPath, logger, configService, mediaProgressMemory, progressSyncService, progressSyncSources }) {
  // Surround sidecars decorate playback; they are not a content source and so
  // never register with the registry. Composed here because this is the only
  // layer allowed to name the concrete store — consumers see ISurroundStore.
  // Two trees: rootDir holds performance sidecars (bound to a Plex item), libraryDir
  // the composer/work knowledge they reference. Split so the same corpus can feed
  // consumers other than playback — see docs/reference/player/surround/classical/.
  const surroundStore = new YamlSurroundStore({
    rootDir: path.join(dataPath, 'content/surround'),
    libraryDir: path.join(dataPath, 'content/library'),
    logger
  });

  // §5 of the surround design: an enriched container imposes its authored order
  // over shuffle. The opt-out is `enforceOrder: false` under the household's
  // `surround` app config; an absent config is the default, so nothing has to be
  // authored to get the specified behaviour — only to leave it.
  const { enforceOrder: surroundEnforceOrder } = new SurroundConfigProjection({ configService }).read();

  // Create PlayResponseService for play response building and watch state reconciliation
  const playResponseService = new PlayResponseService({ mediaProgressMemory, progressSyncService, progressSyncSources, surroundStore, logger });

  return { surroundStore, surroundEnforceOrder, playResponseService };
}

export function createPlaybackProgressOperations({ contentCatalog, mediaProgressMemory, progressSyncSources, progressSyncService, reportPlaybackSession, playLedger, isKnownSpotDevice, eventBus, userVideoProgressStore, economyService, logger }) {
  const updateContentProgress = new UpdateContentProgress({
    contentCatalog,
    mediaProgressMemory,
    nowTimestamp: nowTs24,
  });
  const recordPlaybackProgress = new RecordPlaybackProgress({
    contentCatalog,
    mediaProgressMemory,
    progressSyncSources,
    progressSyncService,
    // Presents playback to the media server as a real client. Built in app.mjs
    // because the Plex credentials and httpClient live there, not here. Null
    // when no media server is configured — the use case simply never fires.
    reportPlaybackSession,
    playLedger,
    isKnownSpotDevice,
    playbackPublications: new PlaybackPublications({ eventBus }),
    userVideoProgressStore,
    economyService,
    createMediaProgress: (props) => new MediaProgress(props),
    nowTimestamp: nowTs24,
    logger,
  });
  // Watched / unwatched marks (Media app household list, RQ-FIND-13). Writes
  // the same completion state play/log writes; see the use case header.
  const markContentWatched = mediaProgressMemory
    ? new MarkContentWatched({
      contentCatalog,
      mediaProgressMemory,
      progressSyncSources: progressSyncSources || new Set(),
      progressSyncService,
      nowTimestamp: nowTs24,
      logger,
    })
    : null;
  return { updateContentProgress, recordPlaybackProgress, markContentWatched };
}

export function createPlaybackReadOperations({ contentCatalog, contentIdResolver, contentQueryService, playResponseService, logger }) {
  const playbackReadService = new PlaybackReadService({
    contentCatalog,
    contentIdResolver,
    contentQueryService,
    playResponseService,
    logger,
  });

  return { playbackReadService };
}

export function createPlaybackQueueRouter({ contentIdResolver, contentCatalog, mediaProgressMemory, surroundStore, surroundEnforceOrder, logger }) {
  return createQueueRouter({
        contentExpression: ContentExpression,
        contentAccessService: new ContentAccessService({
          contentIdResolver,
          contentCatalog,
          queueService: new QueueService({ mediaProgressMemory, random: Math.random }),
        }),
        queuePresentationService: new QueuePresentationService({
          surroundStore,
          surroundPlanner: planSurroundQueue,
          enforceOrder: surroundEnforceOrder,
          logger,
        }),
        logger,
      });
}
