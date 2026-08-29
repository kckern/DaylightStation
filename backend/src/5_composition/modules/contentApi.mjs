// backend/src/5_composition/modules/contentApi.mjs
// Composition wiring for  API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { ListAdapter } from '#adapters/content/list/ListAdapter.mjs';
import { FileAdapter } from '#adapters/content/media/files/FileAdapter.mjs';
import { RegistryContentCatalogGateway } from '#adapters/content/RegistryContentCatalogGateway.mjs';
import { YamlMediaProgressMemory } from '#adapters/persistence/yaml/YamlMediaProgressMemory.mjs';
import { YamlSurroundStore } from '#adapters/content/surround/YamlSurroundStore.mjs';
import { SurroundConfigProjection } from '#adapters/content/surround/SurroundConfigProjection.mjs';
import { ListNameCatalog } from '#adapters/content/list/ListNameCatalog.mjs';
import { createContentRouter } from '#api/v1/routers/content.mjs';
import { createListRouter } from '#api/v1/routers/list.mjs';
import { ItemService } from '#apps/content/ItemService.mjs';
import { createLocalRouter } from '#api/v1/routers/local.mjs';
import { createLocalContentRouter } from '#api/v1/routers/localContent.mjs';
import { createPlayRouter } from '#api/v1/routers/play.mjs';
import { createProxyPassthroughHandlers, createProxyRouter } from '#api/v1/routers/proxy.mjs';
import { createQueriesRouter } from '#api/v1/routers/queries.mjs';
import { createQueueRouter } from '#api/v1/routers/queue.mjs';
import { createSiblingsRouter } from '#api/v1/routers/siblings.mjs';
import { createStreamRouter } from '#api/v1/routers/stream.mjs';
import { ContentIdResolver } from '#apps/content/ContentIdResolver.mjs';
import { ContentAccessService } from '#apps/content/ContentAccessService.mjs';
import { QueuePresentationService } from '#apps/content/QueuePresentationService.mjs';
import { ContentAlternatesService } from '#apps/content/ContentAlternatesService.mjs';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';
import { LegacyLocalContentService } from '#apps/content/LegacyLocalContentService.mjs';
import { ContentQueryAliasResolver } from '#apps/content/services/ContentQueryAliasResolver.mjs';
import { checkSchedule } from '#apps/content/services/scheduleCheck.mjs';
import { PlayResponseService } from '#apps/content/services/PlayResponseService.mjs';
import { planSurroundQueue } from '#apps/content/services/surroundQueuePlan.mjs';
import { SiblingsService } from '#apps/content/services/SiblingsService.mjs';
import { YamlUserVideoProgressStore as UserVideoProgressStore } from '#adapters/persistence/yaml/YamlUserVideoProgressStore.mjs';
import { ContentSourceRegistry } from '#adapters/content/ContentSourceRegistry.mjs';
import { QueueService } from '#apps/content/services/QueueService.mjs';
import { validateSearchQuery } from '#domains/media/validateMediaSearchQuery.mjs';
import { isMediaSearchable } from '#apps/content/services/isMediaSearchable.mjs';
import { ProxyService } from '#system/proxy/ProxyService.mjs';
import path from 'path';
import { ContentExpression } from '#domains/content/ContentExpression.mjs';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import { MenuMemoryService } from '#apps/content/services/MenuMemoryService.mjs';
import { BrowseCatalogService } from '#apps/content/services/BrowseCatalogService.mjs';
import { ContentAccessPolicyService } from '#apps/content/services/ContentAccessPolicyService.mjs';
import { ContentDiscoveryService } from '#apps/content/services/ContentDiscoveryService.mjs';
import { ContentAliasCatalogService } from '#apps/content/services/ContentAliasCatalogService.mjs';
import { ListBrowseService } from '#apps/content/services/ListBrowseService.mjs';
import { PlaybackReadService } from '#apps/content/services/PlaybackReadService.mjs';
import { UpdateContentProgress } from '#apps/content/usecases/UpdateContentProgress.mjs';
import { RecordPlaybackProgress } from '#apps/content/usecases/RecordPlaybackProgress.mjs';
import { nowTs24 } from '#system/utils/index.mjs';
import { generatePlaceholderImage } from '#rendering/placeholder/placeholderImage.mjs';
import { FfmpegVideoThumbnailGenerator } from '#adapters/media/FfmpegVideoThumbnailGenerator.mjs';
import { NodePromiseDeadline } from '#adapters/scheduling/NodePromiseDeadline.mjs';
import { PlaybackPublications } from '#adapters/eventbus/PlaybackPublications.mjs';
import { FilesystemLocalMediaRepository } from '#adapters/media/FilesystemLocalMediaRepository.mjs';
import { FilesystemContentMediaRepository } from '#adapters/media/FilesystemContentMediaRepository.mjs';
import { LegacyLocalContentRepository } from '#adapters/content/LegacyLocalContentRepository.mjs';
import { GetLocalMediaResource } from '#apps/media/usecases/GetLocalMediaResource.mjs';
import { GetLocalMediaThumbnail } from '#apps/media/usecases/GetLocalMediaThumbnail.mjs';
import { LocalMediaCatalogService } from '#apps/media/LocalMediaCatalogService.mjs';
import { GetContentMediaResource } from '#apps/media/usecases/GetContentMediaResource.mjs';
import { ProxyMediaService } from '#apps/proxy/ProxyMediaService.mjs';
import { CompositeHeroService } from '#apps/proxy/CompositeHeroService.mjs';
import { RemoteThumbnailService } from '#apps/proxy/RemoteThumbnailService.mjs';
import { DynamicStreamService } from '#apps/proxy/DynamicStreamService.mjs';
import { MintPlaybackStream } from '#apps/proxy/MintPlaybackStream.mjs';
import { FilesystemProxyMediaRepository } from '#adapters/proxy/FilesystemProxyMediaRepository.mjs';
import { FilesystemProxyAssetCache } from '#adapters/proxy/FilesystemProxyAssetCache.mjs';
import { KomgaCompositeImageSource } from '#adapters/proxy/KomgaCompositeImageSource.mjs';
import { XploreThumbnailSource } from '#adapters/proxy/XploreThumbnailSource.mjs';
import { HttpDynamicStreamGateway } from '#adapters/proxy/HttpDynamicStreamGateway.mjs';
import { RegistryPlaybackStreamGateway } from '#adapters/proxy/RegistryPlaybackStreamGateway.mjs';
import { compositeHeroImage } from '#rendering/canvas/compositeHero.mjs';
import { buildBareContentNameMap, CONTENT_SEARCH_BUDGET, LEGACY_CONTENT_ALIASES } from '#apps/content/ContentRuntimePolicy.mjs';

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
  const { registry, mediaProgressMemory, progressSyncService, progressSyncSources, menuMemoryRepository, cacheBasePath, dataPath, mediaBasePath, proxyService, retroarchProxy, composePresentationUseCase, configService, prefixAliases = {}, savedQueryService = null, eventBus = null, economyService = null, logger = console } = config;

  // Register prefix aliases (e.g., hymn → singalong:hymn) from config
  // This enables the content API to resolve aliased prefixes via registry.resolveFromPrefix()
  if (Object.keys(prefixAliases).length > 0) {
    registry.registerPrefixAliases(prefixAliases);
    logger.debug?.('bootstrap.prefixAliases.registered', { prefixes: Object.keys(prefixAliases) });
  }

  // Scan list directories for bare name resolution (Layer 4a).
  // Priority: menu > program > watchlist (later iterations overwrite).
  const bareNameMap = buildBareContentNameMap(new ListNameCatalog({ listAdapter: registry.get('list') }));

  // Create ContentIdResolver for unified content ID resolution.
  // Prefix aliases (hymn, scripture, etc.) are already registered in the registry
  // via registerPrefixAliases() above — ContentIdResolver Layer 2 resolves them.
  // systemAliases is reserved for future aliases not backed by registry prefixes.
  const contentCatalog = new RegistryContentCatalogGateway({ registry, isSearchable: isMediaSearchable, prefixAliases, logger });
  const contentIdResolver = new ContentIdResolver(contentCatalog, {
    systemAliases: LEGACY_CONTENT_ALIASES,
    householdAliases: {},
    bareNameMap,
  });

  // Create ContentQueryAliasResolver for semantic query prefixes (music:, photos:, etc.)
  const aliasResolver = new ContentQueryAliasResolver({
    contentCatalog,
    loadUserAliases: () => configService.getAppConfig('content', 'aliases'),
    prefixAliases,
  });

  // Create ContentQueryService for unified query interface.
  // Per-adapter search budget: 3s default keeps streamed search snappy; the
  // local YAML/file-scan sources measured slower on this host (2026-07 live
  // samples — abs ~3.3-4.9s, singalong ~4.2-7.2s, readalong ~0.9-5.2s,
  // local-content ~0.7-4.0s, files ~1.6-3.9s) get explicit higher budgets so
  // their legitimate results aren't cut off.
  const contentQueryService = new ContentQueryService({
    contentCatalog,
    mediaProgressMemory,
    prefixAliases,
    logger,
    aliasResolver,
    deadline: new NodePromiseDeadline(),
    ...CONTENT_SEARCH_BUDGET,
  });

  // Create SiblingsService for sibling resolution
  const siblingsService = new SiblingsService({ contentCatalog, logger });

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

  // Per-user video course progress store (piano kiosk). Injected into the play
  // router (write side, via /play/log) and exposed for the piano router (read side).
  const userVideoProgressStore = new UserVideoProgressStore({ configService, logger });

  // Get FileAdapter from registry for local router (handles local media browsing)
  const localMediaAdapter = registry.get('files');
  const thumbnailGenerator = new FfmpegVideoThumbnailGenerator();
  const localMediaRepository = new FilesystemLocalMediaRepository({
    mediaBasePath,
    cacheBasePath: cacheBasePath || path.join(dataPath, 'system/cache'),
    thumbnailGenerator,
    logger,
  });
  const getLocalMediaResource = new GetLocalMediaResource({ repository: localMediaRepository });
  const getLocalMediaThumbnail = new GetLocalMediaThumbnail({ repository: localMediaRepository });
  const contentMediaRepository = new FilesystemContentMediaRepository({
    singalongMediaPath: path.join(mediaBasePath, 'audio', 'singalong'),
    singalongDataPath: config.singalong?.dataPath,
    readalongAudioPath: path.join(mediaBasePath, 'audio', 'readalong'),
    readalongVideoPath: path.join(mediaBasePath, 'video', 'readalong'),
  });
  const getContentMediaResource = new GetContentMediaResource({ repository: contentMediaRepository });
  const contentAlternatesService = new ContentAlternatesService({ contentCatalog });
  const menuMemory = new MenuMemoryService({
    load: menuMemoryRepository.load,
    save: menuMemoryRepository.save,
  });
  const browseCatalog = new BrowseCatalogService({
    loadMediaConfig: () => configService?.getHouseholdAppConfig?.(null, 'media') || {},
  });
  const contentAccessPolicy = new ContentAccessPolicyService({
    loadSourceConfig: (name) => configService?.reloadHouseholdAppConfig?.(null, name) || {},
    checkSchedule,
  });
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
    playbackPublications: new PlaybackPublications({ eventBus }),
    userVideoProgressStore,
    economyService,
    createMediaProgress: (props) => new MediaProgress(props),
    nowTimestamp: nowTs24,
    logger,
  });
  const contentDiscovery = new ContentDiscoveryService({ contentCatalog, logger });
  const listBrowse = new ListBrowseService({
    contentCatalog,
    contentIdResolver,
    contentQueryService,
    menuMemory,
    logger,
  });
  const itemService = new ItemService({
    contentCatalog,
    contentQueryService,
    menuMemory,
    logger,
  });
  const playbackReadService = new PlaybackReadService({
    contentCatalog,
    contentIdResolver,
    contentQueryService,
    playResponseService,
    logger,
  });

  const proxyLogger = logger.child?.({ module: 'proxy-api' }) || logger;
  const proxyAssetCache = new FilesystemProxyAssetCache({ mediaBasePath });
  const proxyMediaService = new ProxyMediaService({
    repository: new FilesystemProxyMediaRepository({ registry, mediaBasePath, logger: proxyLogger }),
  });
  const mintPlaybackStream = new MintPlaybackStream({
    gateway: new RegistryPlaybackStreamGateway({ registry, logger: proxyLogger }),
  });
  const compositeHeroService = new CompositeHeroService({
    cache: proxyAssetCache,
    source: new KomgaCompositeImageSource({ adapter: proxyService?.getAdapter?.('komga') }),
    render: compositeHeroImage,
  });
  const dynamicStreamService = new DynamicStreamService({
    gateway: new HttpDynamicStreamGateway({
      getProfiles: () => configService?.getStreamingProfiles?.() || [],
    }),
    logger: proxyLogger,
  });
  const remoteThumbnailService = retroarchProxy
    ? new RemoteThumbnailService({
      cache: proxyAssetCache,
      source: new XploreThumbnailSource({
        baseUrl: retroarchProxy.baseUrl,
        thumbnailsPath: retroarchProxy.thumbnailsPath,
      }),
      delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      retryDelayMs: 1500,
      logger: proxyLogger,
    })
    : null;
  const passthroughHandlers = createProxyPassthroughHandlers(proxyService);
  const legacyLocalContentService = new LegacyLocalContentService({
    repository: new LegacyLocalContentRepository({
      registry,
      dataPath,
      mediaBasePath,
      mediaProgressMemory,
      generatePlaceholder: generatePlaceholderImage,
      placeholderFontPath: mediaBasePath ? path.join(mediaBasePath, 'fonts/RobotoCondensed-Regular.ttf') : null,
    }),
    logger,
  });

  return {
    routers: {
      content: createContentRouter({
        cacheBasePath,
        composePresentationUseCase,
        contentQueryService,
        contentAccessPolicy,
        contentDiscovery,
        updateContentProgress,
        findContentAlternates: contentAlternatesService.findAlternates.bind(contentAlternatesService),
        validateSearchQuery,
        logger,
        contentAliasCatalog: new ContentAliasCatalogService({ aliases: aliasResolver, discovery: contentDiscovery }),
      }),
      proxy: createProxyRouter({
        proxyMediaService,
        mintPlaybackStream,
        compositeHeroService,
        remoteThumbnailService,
        dynamicStreamService,
        passthroughHandlers,
        logger: proxyLogger,
      }),
      localContent: createLocalContentRouter({ localContentService: legacyLocalContentService }),
      play: createPlayRouter({ recordPlaybackProgress, playbackReadService, logger }),
      list: createListRouter({ browseCatalog, listBrowse, recordMenuSelection: itemService.recordMenuSelection.bind(itemService), logger }),
      siblings: createSiblingsRouter({ siblingsService, contentIdResolver, logger }),
      queue: createQueueRouter({
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
      }),
      local: createLocalRouter({
        localMediaCatalog: new LocalMediaCatalogService({ source: localMediaAdapter }),
        getLocalMediaResource,
        getLocalMediaThumbnail,
        logger,
      }),
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
    }
  };
}
