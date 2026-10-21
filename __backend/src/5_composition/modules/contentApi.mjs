import { createCatalogProxyServices } from "../../../../__capabilities/content-catalog/server/composition/proxy-services.mjs";
import { createContentQueryRouter } from '../../../../__capabilities/content-catalog/server/composition/api-context.mjs';
import { createPlaybackQueueRouter } from '../../../../__capabilities/playback/server/composition/content-api.mjs';
import { createLocalMediaRouter } from '../../../../__app_modules/media/media/server/composition/content-api.mjs';
import { createContentQueryContext, createContentBrowseOperations, createLegacyContentOperations } from '../../../../__capabilities/content-catalog/server/composition/api-context.mjs';
import { createPlaybackSurroundContext, createPlaybackProgressOperations, createPlaybackReadOperations } from '../../../../__capabilities/playback/server/composition/content-api.mjs';
import { createMediaResourceOperations, createMediaBrowseState } from '../../../../__app_modules/media/media/server/composition/content-api.mjs';
// __backend/src/5_composition/modules/contentApi.mjs
// Composition wiring for  API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createListRouter } from "../../../../__capabilities/content-catalog/server/api/list.mjs";

import { createLocalContentRouter } from "../../../../__capabilities/content-catalog/server/api/localContent.mjs";
import { createPlayRouter } from "../../../../__capabilities/playback/server/api/play.mjs";
import { createProxyPassthroughHandlers, createProxyRouter } from "#api/v1/routers/proxy.mjs";
import { createQueriesRouter } from "../../../../__capabilities/content-catalog/server/api/queries.mjs";

import { createSiblingsRouter } from "../../../../__capabilities/content-catalog/server/api/siblings.mjs";
import { createStreamRouter } from "../../../../__app_modules/media/media/server/api/stream.mjs";

import { ContentAlternatesService } from "../../../../__capabilities/content-catalog/server/application/ContentAlternatesService.mjs";

import { checkSchedule } from "../../../../__capabilities/device-dispatch/server/application/scheduleCheck.mjs";

import { YamlUserVideoProgressStore as UserVideoProgressStore } from "../../../../__app_modules/learning/piano/server/adapters/YamlUserVideoProgressStore.mjs";

import { validateSearchQuery } from "../../../../__app_modules/media/media/server/domain/validateMediaSearchQuery.mjs";

import { ContentAccessPolicyService } from "../../../../__app_modules/games/arcade/server/application/ContentAccessPolicyService.mjs";
import { createWatchCompletionRules } from "#shared/contracts/media/watchCompletion.mjs";














/**
 * Create API routers for the content domain
 * @param {Object} config
 * @param {ContentSourceRegistry} config.registry - Content source registry
 * @param {YamlMediaProgressMemory} config.mediaProgressMemory - Media progress memory
 * @param {object} config.menuMemoryRepository - Household menu-memory persistence port
 * @param {string} [config.cacheBasePath] - Base path for image cache
 * @param {string} [config.dataPath] - Base data path for local content
 * @param {import('#system/proxy/ProxyService.mjs').ProxyService} [config.proxyService] - Proxy service for external services
 * @param {import('#apps/content/usecases/ComposePresentationUseCase.mjs').ComposePresentationUseCase} [config.composePresentationUseCase] - Use case for composing presentations
 * @param {Object<string, string>} [config.prefixAliases] - Prefix aliases (e.g., { hymn: 'singalong:hymn' })
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Router configuration
 */
export function createApiRouters(config) {
  const { registry, sequenceStore = null, mediaProgressMemory, progressSyncService, progressSyncSources, menuMemoryRepository, cacheBasePath, dataPath, mediaBasePath, proxyService, retroarchProxy, composePresentationUseCase, configService, prefixAliases = {}, savedQueryService = null, eventBus = null, economyService = null, reportPlaybackSession = null, playLedger = null, isKnownSpotDevice = null, libbyStreamService = null, libbyCoverService = null, logger = console } = config;

  const { contentCatalog, contentIdResolver, aliasResolver, contentQueryService, siblingsService } = createContentQueryContext({ prefixAliases, registry, logger, configService, mediaProgressMemory });

  const { surroundStore, surroundEnforceOrder, playResponseService } = createPlaybackSurroundContext({ dataPath, logger, configService, mediaProgressMemory, progressSyncService, progressSyncSources });

  // Per-user video course progress store (piano kiosk). Injected into the play
  // router (write side, via /play/log) and exposed for the piano router (read side).
  const userVideoProgressStore = new UserVideoProgressStore({ configService, logger });

  const { localMediaAdapter, getLocalMediaResource, getLocalMediaThumbnail, getContentMediaResource } = createMediaResourceOperations({ registry, mediaBasePath, cacheBasePath, dataPath, logger, config });

  const contentAlternatesService = new ContentAlternatesService({ contentCatalog });
  const { menuMemory, browseCatalog } = createMediaBrowseState({ menuMemoryRepository, configService });

  const contentAccessPolicy = new ContentAccessPolicyService({
    loadSourceConfig: (name) => configService?.reloadHouseholdAppConfig?.(null, name) || {},
    checkSchedule,
  });
  // One completion rule per library (household media config `watch_completion`);
  // re-read on every judgement so a config reload takes effect.
  const completionRules = createWatchCompletionRules({
    readConfig: () => configService?.getHouseholdAppConfig?.(null, 'media')?.watch_completion,
    logger,
  });
  const { updateContentProgress, recordPlaybackProgress, markContentWatched } = createPlaybackProgressOperations({ contentCatalog, mediaProgressMemory, progressSyncSources, progressSyncService, reportPlaybackSession, playLedger, isKnownSpotDevice, completionRules, eventBus, userVideoProgressStore, economyService, logger });

  const { contentDiscovery, listBrowse, itemService } = createContentBrowseOperations({ contentCatalog, logger, contentIdResolver, contentQueryService, menuMemory });

  const { playbackReadService } = createPlaybackReadOperations({ contentCatalog, contentIdResolver, contentQueryService, playResponseService, logger });

  const { proxyLogger, proxyMediaService, mintPlaybackStream, compositeHeroService, dynamicStreamService, remoteThumbnailService } = createCatalogProxyServices({ logger, mediaBasePath, registry, proxyService, configService, retroarchProxy });
  const passthroughHandlers = createProxyPassthroughHandlers(proxyService);
  const { legacyLocalContentService } = createLegacyContentOperations({ registry, dataPath, mediaBasePath, mediaProgressMemory, logger });

  return {
    routers: {
      content: createContentQueryRouter({ cacheBasePath, composePresentationUseCase, contentQueryService, contentAccessPolicy, contentDiscovery, updateContentProgress, contentAlternatesService, validateSearchQuery, logger, aliasResolver }),
      proxy: createProxyRouter({
        proxyMediaService,
        mintPlaybackStream,
        compositeHeroService,
        remoteThumbnailService,
        dynamicStreamService,
        libbyStreamService,
        libbyCoverService,
        passthroughHandlers,
        logger: proxyLogger,
      }),
      localContent: createLocalContentRouter({ localContentService: legacyLocalContentService }),
      play: createPlayRouter({ recordPlaybackProgress, playbackReadService, logger }),
      list: createListRouter({ browseCatalog, listBrowse, recordMenuSelection: itemService.recordMenuSelection.bind(itemService), logger }),
      siblings: createSiblingsRouter({ siblingsService, contentIdResolver, logger }),
      queue: createPlaybackQueueRouter({ contentIdResolver, contentCatalog, mediaProgressMemory, surroundStore, surroundEnforceOrder, sequenceStore, dataPath, logger }),
      local: createLocalMediaRouter({ localMediaAdapter, getLocalMediaResource, getLocalMediaThumbnail, logger }),
      stream: createStreamRouter({
        getContentMediaResource,
        logger
      }),
      ...(savedQueryService ? { queries: createQueriesRouter({ savedQueryService }) } : {}),
    },
    // Expose services for other routers that need them
    services: {
      contentQueryService,
      contentIdResolver,
      contentCatalog,
      savedQueryService,
      userVideoProgressStore,
      markContentWatched,
    }
  };
}
