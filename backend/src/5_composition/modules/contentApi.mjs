// backend/src/5_composition/modules/contentApi.mjs
// Composition wiring for  API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { ListAdapter } from '#adapters/content/list/ListAdapter.mjs';
import { FileAdapter } from '#adapters/content/media/files/FileAdapter.mjs';
import { YamlMediaProgressMemory } from '#adapters/persistence/yaml/YamlMediaProgressMemory.mjs';
import { createContentRouter } from '#api/v1/routers/content.mjs';
import { createListRouter } from '#api/v1/routers/list.mjs';
import { createLocalRouter } from '#api/v1/routers/local.mjs';
import { createLocalContentRouter } from '#api/v1/routers/localContent.mjs';
import { createPlayRouter } from '#api/v1/routers/play.mjs';
import { createProxyRouter } from '#api/v1/routers/proxy.mjs';
import { createQueriesRouter } from '#api/v1/routers/queries.mjs';
import { createQueueRouter } from '#api/v1/routers/queue.mjs';
import { createSiblingsRouter } from '#api/v1/routers/siblings.mjs';
import { createStreamRouter } from '#api/v1/routers/stream.mjs';
import { ContentIdResolver } from '#apps/content/ContentIdResolver.mjs';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';
import { ContentQueryAliasResolver } from '#apps/content/services/ContentQueryAliasResolver.mjs';
import { PlayResponseService } from '#apps/content/services/PlayResponseService.mjs';
import { SiblingsService } from '#apps/content/services/SiblingsService.mjs';
import { UserVideoProgressStore } from '#apps/piano/UserVideoProgressStore.mjs';
import { ContentSourceRegistry } from '#domains/content/services/ContentSourceRegistry.mjs';
import { QueueService } from '#domains/content/services/QueueService.mjs';
import { ProxyService } from '#system/proxy/ProxyService.mjs';
import path from 'path';

/**
 * Create API routers for the content domain
 * @param {Object} config
 * @param {ContentSourceRegistry} config.registry - Content source registry
 * @param {YamlMediaProgressMemory} config.mediaProgressMemory - Media progress memory
 * @param {Function} [config.loadFile] - Function to load YAML files
 * @param {Function} [config.saveFile] - Function to save YAML files
 * @param {string} [config.cacheBasePath] - Base path for image cache
 * @param {string} [config.dataPath] - Base data path for local content
 * @param {import('#system/proxy/ProxyService.mjs').ProxyService} [config.proxyService] - Proxy service for external services
 * @param {import('#apps/content/usecases/ComposePresentationUseCase.mjs').ComposePresentationUseCase} [config.composePresentationUseCase] - Use case for composing presentations
 * @param {Object<string, string>} [config.prefixAliases] - Prefix aliases (e.g., { hymn: 'singalong:hymn' })
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Router configuration
 */
export function createApiRouters(config) {
  const { registry, mediaProgressMemory, progressSyncService, progressSyncSources, loadFile, saveFile, cacheBasePath, dataPath, mediaBasePath, proxyService, retroarchProxy, composePresentationUseCase, configService, prefixAliases = {}, savedQueryService = null, eventBus = null, logger = console } = config;

  // Register prefix aliases (e.g., hymn → singalong:hymn) from config
  // This enables the content API to resolve aliased prefixes via registry.resolveFromPrefix()
  if (Object.keys(prefixAliases).length > 0) {
    registry.registerPrefixAliases(prefixAliases);
    logger.debug?.('bootstrap.prefixAliases.registered', { prefixes: Object.keys(prefixAliases) });
  }

  // Scan list directories for bare name resolution (Layer 4a).
  // Priority: menu > program > watchlist (later iterations overwrite).
  const bareNameMap = {};
  const listAdapterForScan = registry.get('list');
  if (listAdapterForScan?._getAllListNames) {
    for (const [prefix, listType] of [['watchlist', 'watchlists'], ['program', 'programs'], ['menu', 'menus']]) {
      for (const name of listAdapterForScan._getAllListNames(listType)) {
        bareNameMap[name] = prefix;
      }
    }
  }

  // Create ContentIdResolver for unified content ID resolution.
  // Prefix aliases (hymn, scripture, etc.) are already registered in the registry
  // via registerPrefixAliases() above — ContentIdResolver Layer 2 resolves them.
  // systemAliases is reserved for future aliases not backed by registry prefixes.
  const contentIdResolver = new ContentIdResolver(registry, {
    systemAliases: {
      // Simple source renames (legacy names → canonical adapter names).
      // Note: "media" is handled by FileAdapter's prefix list (Layer 2).
      // "local" was removed from FileAdapter's prefix list since local:X should
      // resolve to ListAdapter (watchlist) via this alias (Layer 3), not FileAdapter.
      local: 'watchlist:',
      singing: 'singalong:',
      narrated: 'readalong:',
      list: 'menu:',
    },
    householdAliases: {},
    bareNameMap,
  });

  // Create ContentQueryAliasResolver for semantic query prefixes (music:, photos:, etc.)
  const aliasResolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });

  // Create ContentQueryService for unified query interface
  const contentQueryService = new ContentQueryService({ registry, mediaProgressMemory, prefixAliases, logger, aliasResolver });

  // Create SiblingsService for sibling resolution
  const siblingsService = new SiblingsService({ registry, logger });

  // Create PlayResponseService for play response building and watch state reconciliation
  const playResponseService = new PlayResponseService({ mediaProgressMemory, progressSyncService, progressSyncSources });

  // Per-user video course progress store (piano kiosk). Injected into the play
  // router (write side, via /play/log) and exposed for the piano router (read side).
  const userVideoProgressStore = new UserVideoProgressStore({ configService, logger });

  // Get FileAdapter from registry for local router (handles local media browsing)
  const localMediaAdapter = registry.get('files');

  return {
    routers: {
      content: createContentRouter(registry, mediaProgressMemory, { loadFile, saveFile, cacheBasePath, composePresentationUseCase, contentQueryService, configService, logger, aliasResolver }),
      proxy: createProxyRouter({ registry, proxyService, configService, mediaBasePath, dataPath, retroarchProxy, logger }),
      localContent: createLocalContentRouter({ registry, dataPath, mediaBasePath, mediaProgressMemory }),
      play: createPlayRouter({ registry, mediaProgressMemory, playResponseService, contentQueryService, contentIdResolver, progressSyncService, progressSyncSources, eventBus, userVideoProgressStore, logger }),
      list: createListRouter({ registry, loadFile, configService, contentQueryService, contentIdResolver, menuMemoryPath: configService.getHouseholdPath('history/menu_memory'), logger }),
      siblings: createSiblingsRouter({ siblingsService, contentIdResolver, logger }),
      queue: createQueueRouter({ contentIdResolver, queueService: new QueueService({ mediaProgressMemory }), logger }),
      local: createLocalRouter({ localMediaAdapter, mediaBasePath, cacheBasePath: cacheBasePath || path.join(dataPath, 'system/cache'), logger }),
      stream: createStreamRouter({
        singalongMediaPath: path.join(mediaBasePath, 'audio', 'singalong'),
        singalongDataPath: config.singalong?.dataPath,
        readalongAudioPath: path.join(mediaBasePath, 'audio', 'readalong'),
        readalongVideoPath: path.join(mediaBasePath, 'video', 'readalong'),
        logger
      }),
      ...(savedQueryService ? { queries: createQueriesRouter({ savedQueryService }) } : {}),
    },
    // Expose services for other routers that need them
    services: {
      contentQueryService,
      contentIdResolver,
      savedQueryService,
      userVideoProgressStore,
    }
  };
}
