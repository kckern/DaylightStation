// Ordered neutral catalog installation phases. Product registration stays in installed composition.
import { ContentSourceRegistry } from "../adapters/ContentSourceRegistry.mjs";
import { FileAdapter } from "#adapters/content/media/files/FileAdapter.mjs";
import { PlexAdapter } from "../adapters/providers/plex/PlexAdapter.mjs";
import { LibbyAdapter } from "#adapters/content/media/libby/LibbyAdapter.mjs";
import { LocalContentAdapter } from "../adapters/providers/local-content/LocalContentAdapter.mjs";
import { ScriptureResolver } from "../adapters/providers/readalong/resolvers/scripture.mjs";
import { ListAdapter } from "../adapters/providers/list/ListAdapter.mjs";
import { YamlSequenceStore } from "../adapters/persistence/YamlSequenceStore.mjs";
import path from "node:path";
import { ImmichAdapter } from "../adapters/providers/gallery/immich/ImmichAdapter.mjs";
import { AudiobookshelfAdapter } from "../adapters/providers/readable/audiobookshelf/AudiobookshelfAdapter.mjs";
import { SingalongAdapter } from "../adapters/providers/singalong/SingalongAdapter.mjs";
import { ReadalongAdapter } from "../adapters/providers/readalong/ReadalongAdapter.mjs";
import { KomgaAdapter } from "../adapters/providers/readable/komga/KomgaAdapter.mjs";
import { QueryAdapter } from "../adapters/providers/query/QueryAdapter.mjs";
import { SavedQueryService } from "../application/SavedQueryService.mjs";
import { YamlSavedQueryDatastore } from "../adapters/persistence/YamlSavedQueryDatastore.mjs";
import mediaManifest from "#adapters/content/media/files/manifest.mjs";
import plexManifest from "../adapters/providers/plex/manifest.mjs";
import libbyManifest from "#adapters/content/media/libby/manifest.mjs";
import immichManifest from "../adapters/providers/gallery/immich/manifest.mjs";
import listManifest from "../adapters/providers/list/manifest.mjs";
import singalongManifest from "../adapters/providers/singalong/manifest.mjs";
import readalongManifest from "../adapters/providers/readalong/manifest.mjs";
import komgaManifest from "../adapters/providers/readable/komga/manifest.mjs";
import absManifest from "../adapters/providers/readable/audiobookshelf/manifest.mjs";
import queryManifest from "../adapters/providers/query/manifest.mjs";

export function createStationSequenceStore(rootDir, logger) {
  return new YamlSequenceStore({ rootDir, logger });
}

export function createCatalogSources(config, deps = {}, { curriculumEnrichment } = {}) {
  const { httpClient, mediaProgressMemory, mediaKeyResolver, app } = deps;
  const registry = new ContentSourceRegistry();

  if (config.libby?.username && deps.libbyClient && deps.libbyLeaseService) {
    registry.register(
      new LibbyAdapter({ client: deps.libbyClient, leases: deps.libbyLeaseService }),
      { category: libbyManifest.capability, provider: libbyManifest.provider },
    );
  }

  // Register media adapter (also handles local media browsing/roots)
  if (config.mediaBasePath) {
    registry.register(
      new FileAdapter({
        mediaBasePath: config.mediaBasePath,
        mediaProgressMemory,
        dataPath: config.dataPath || null,
        householdId: config.householdId || null,
        cacheBasePath: config.cacheBasePath || null,
        configService: deps.configService || null,
        // Optional override of the default search exclusions (video/fitness/)
        searchExcludePaths: config.mediaSearchExcludePaths || undefined
      }),
      { category: mediaManifest.capability, provider: mediaManifest.provider }
    );
  }

  // Register Plex adapter if configured
  if (config.plex?.host && httpClient) {
    registry.register(
      new PlexAdapter({
        host: config.plex.host,
        token: config.plex.token,
        mediaProgressMemory,  // Inject MediaProgressMemory for watch state persistence
        mediaKeyResolver,     // Inject MediaKeyResolver for normalizing media keys
        logger: deps.logger?.child?.({ module: 'plex-adapter' }) || deps.logger || console,
      }, { httpClient, curriculumEnrichment }),
      { category: plexManifest.capability, provider: plexManifest.provider }
    );
  }

  // Register local content adapter (optional)
  // Note: LocalContentAdapter has no manifest - uses 'local' category
  if (config.dataPath && config.mediaBasePath) {
    registry.register(
      new LocalContentAdapter({
        dataPath: config.dataPath,
        mediaPath: config.mediaBasePath,
        mediaProgressMemory,
        householdId: config.householdId || null,
        householdsBasePath: config.householdsBasePath || null,
        contentRegistry: registry,
        scriptureResolver: ScriptureResolver,
      }),
      { category: 'local', provider: 'local-content' }
    );
  }

  // Register ListAdapter for menus/programs/watchlists as content sources
  // Handles watchlist: prefix (and menu:, program:, query:)
  // Uses listDataPath (root data path) for content/lists/*
  const listDataPath = config.listDataPath || config.dataPath;
  const sequenceLogger = deps.logger?.child?.({ app: 'surround', module: 'station-sequence' }) || deps.logger || null;
  const sequenceStore = listDataPath
    ? createStationSequenceStore(path.join(listDataPath, 'content', 'surround'), sequenceLogger)
    : null;
  if (listDataPath) {
    const listAdapter = new ListAdapter({
      dataPath: listDataPath,
      householdId: config.householdId || null,
      registry,
      mediaProgressMemory,
      configService: deps.configService || null,
      nomusicLabels: config.nomusicLabels || [],
      musicOverlayPlaylist: config.musicOverlayPlaylist || null,
      sequenceStore,
      logger: sequenceLogger
    });
    registry.register(listAdapter, {
      category: listManifest.capability,
      provider: listManifest.provider
    });

    // Register 'watchlist' alias so registry.get('watchlist') returns ListAdapter
    registry.adapters.set('watchlist', listAdapter);
  }

  // Register QueryAdapter for saved queries (query:dailynews, etc.)
  // Reads query YAML files from content/lists/queries/ and user config/queries/
  let savedQueryService = null;
  if (listDataPath) {
    // content/ is a top-level tree, sibling to household/ — NOT household-scoped,
    // so no default-household folder name resolution is needed here.
    const savedQueryDatastore = new YamlSavedQueryDatastore({ dataPath: listDataPath });
    savedQueryService = new SavedQueryService({
      readQuery: savedQueryDatastore.readQuery.bind(savedQueryDatastore),
      listQueries: savedQueryDatastore.listQueries.bind(savedQueryDatastore),
      listQueriesDetailed: savedQueryDatastore.listQueriesDetailed.bind(savedQueryDatastore),
      writeQuery: savedQueryDatastore.writeQuery.bind(savedQueryDatastore),
      deleteQuery: savedQueryDatastore.deleteQuery.bind(savedQueryDatastore),
    });
    const fileAdapter = registry.get('files');
    registry.register(
      new QueryAdapter({ savedQueryService, fileAdapter, mediaProgressMemory, registry }),
      { category: queryManifest.capability, provider: queryManifest.provider }
    );
  }

  return { registry, savedQueryService, sequenceStore, httpClient, mediaProgressMemory, app };
}

export function registerRemoteCatalogSources(registry, config, httpClient) {
  // Register Immich adapter if configured
  if (config.immich?.host && config.immich?.apiKey && httpClient) {
    registry.register(
      new ImmichAdapter({
        host: config.immich.host,
        apiKey: config.immich.apiKey,
        slideDuration: config.immich.slideDuration || 10
      }, { httpClient }),
      { category: immichManifest.capability, provider: immichManifest.provider }
    );
  }

  // Register Audiobookshelf adapter if configured
  // (manifest metadata makes it resolvable via the 'readable' category and
  // 'abs' provider, alongside Komga)
  if (config.audiobookshelf?.host && config.audiobookshelf?.token && httpClient) {
    registry.register(
      new AudiobookshelfAdapter({
        host: config.audiobookshelf.host,
        token: config.audiobookshelf.token
      }, { httpClient }),
      { category: absManifest.capability, provider: absManifest.provider }
    );
  }

  // Register Komga adapter for comic/manga reading if configured
  if (config.komga?.host && config.komga?.apiKey && httpClient) {
    registry.register(
      new KomgaAdapter({
        host: config.komga.host,
        apiKey: config.komga.apiKey,
        proxyPath: config.komga.proxyPath
      }, { httpClient }),
      { category: komgaManifest.capability, provider: komgaManifest.provider }
    );
  }

}

export function registerTextCatalogSources(registry, config, mediaProgressMemory) {
  // Register SingalongAdapter for participatory sing-along content (hymns, primary songs)
  if (config.singalong?.dataPath && config.singalong?.mediaPath) {
    registry.register(
      new SingalongAdapter({
        dataPath: config.singalong.dataPath,
        mediaPath: config.singalong.mediaPath,
        mediaProgressMemory,
        storagePaths: config.storagePaths
      }),
      { category: singalongManifest.capability, provider: singalongManifest.provider }
    );
  }

  // Register ReadalongAdapter for follow-along readalong content (scripture, talks, poetry)
  if (config.readalong?.dataPath && config.readalong?.mediaPath) {
    registry.register(
      new ReadalongAdapter({
        dataPath: config.readalong.dataPath,
        mediaPath: config.readalong.mediaPath,
        mediaPathMap: config.readalong.mediaPathMap || null,
        mediaProgressMemory,
        storagePaths: config.storagePaths
      }),
      { category: readalongManifest.capability, provider: readalongManifest.provider }
    );
  }

}
