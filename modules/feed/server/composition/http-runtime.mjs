import axios from "axios";
import crypto from "node:crypto";
import { HttpClient } from "#system/services/HttpClient.mjs";
import { NodeApplicationScheduler } from "#adapters/scheduling/NodeApplicationScheduler.mjs";
import { YamlFeedQueryRepository } from "../adapters/YamlFeedQueryRepository.mjs";

export async function installFeedApi({ configService, dataService, userService, rootLogger, userLoadFile, gratitudeServices, userLoadCurrent, contentServices, contentRegistry, mediaLibConfig, audiobookshelfConfig, mediaBasePath, feedServices, entropyServices, v1Routers }) {

    const { FeedAssemblyService } = await import("../application/services/FeedAssemblyService.mjs");
    const { FeedContentService } = await import("../application/services/FeedContentService.mjs");
    const { WebContentAdapter } = await import("../adapters/WebContentAdapter.mjs");
    const { createFeedRouter } = await import("../api/feed.mjs");
    const { RedditFeedAdapter } = await import("../adapters/sources/RedditFeedAdapter.mjs");
    const { WeatherFeedAdapter } = await import("../adapters/sources/WeatherFeedAdapter.mjs");
    const { HealthFeedAdapter } = await import("../adapters/sources/HealthFeedAdapter.mjs");
    const { GratitudeFeedAdapter } = await import("../adapters/sources/GratitudeFeedAdapter.mjs");
    const { StravaFeedAdapter } = await import("../adapters/sources/StravaFeedAdapter.mjs");
    const { TodoistFeedAdapter } = await import("../adapters/sources/TodoistFeedAdapter.mjs");
    const { ImmichFeedAdapter } = await import("../adapters/sources/ImmichFeedAdapter.mjs");
    const { PlexFeedAdapter } = await import("../adapters/sources/PlexFeedAdapter.mjs");
    const { JournalFeedAdapter } = await import("../adapters/sources/JournalFeedAdapter.mjs");
    const { YouTubeFeedAdapter } = await import("../adapters/sources/YouTubeFeedAdapter.mjs");
    const { YouTubeAdapter } = await import("#adapters/content/media/youtube/YouTubeAdapter.mjs");
    const { GoogleNewsFeedAdapter } = await import("../adapters/sources/GoogleNewsFeedAdapter.mjs");
    const { KomgaFeedAdapter } = await import("../adapters/sources/KomgaFeedAdapter.mjs");
    const { KomgaClient } = await import("../../../../capabilities/content-catalog/server/adapters/providers/readable/komga/KomgaClient.mjs");
    const { ReadalongFeedAdapter } = await import("../adapters/sources/ReadalongFeedAdapter.mjs");
    const { GoodreadsFeedAdapter } = await import("../adapters/sources/GoodreadsFeedAdapter.mjs");
    const { ABSEbookFeedAdapter } = await import("../adapters/sources/ABSEbookFeedAdapter.mjs");

    // Load query configs at bootstrap time (moves fs access out of application layer)
    // content/lists is a top-level tree, sibling to household/ — NOT household-scoped.
    const feedQueries = new YamlFeedQueryRepository({ dataService, configService, logger: rootLogger });
    const queryConfigs = feedQueries.loadHouseholdQueries();
    const loadUserQueries = (username) => feedQueries.loadUserQueries(username);

    // Feed source adapters (extracted from FeedAssemblyService)
    // Shared system HttpClient for all raw-HTTP feed adapters (P1.9).
    const feedHttpClient = new HttpClient({ logger: rootLogger.child({ module: 'feed-http' }) });
    const redditAdapter = new RedditFeedAdapter({
      dataService,
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'reddit-feed' }),
    });
    const weatherAdapter = new WeatherFeedAdapter({
      dataService,
      logger: rootLogger.child({ module: 'weather-feed' }),
    });
    const healthAdapter = new HealthFeedAdapter({
      loadLifelog: userLoadFile,
      logger: rootLogger.child({ module: 'health-feed' }),
    });
    const gratitudeAdapter = new GratitudeFeedAdapter({
      readSelectionQuotes: gratitudeServices.readSelectionQuotes,
      userService,
      logger: rootLogger.child({ module: 'gratitude-feed' }),
    });
    const stravaAdapter = new StravaFeedAdapter({
      loadLifelog: userLoadFile,
      logger: rootLogger.child({ module: 'strava-feed' }),
    });
    const todoistAdapter = new TodoistFeedAdapter({
      loadCurrentTasks: (username) => userLoadCurrent(username, 'todoist'),
      logger: rootLogger.child({ module: 'todoist-feed' }),
    });
    const immichConfig = configService.getAdapterConfig('immich');
    const plexConfig = configService.getAdapterConfig('plex');
    const immichAdapter = contentServices?.contentQueryService ? new ImmichFeedAdapter({
      contentQueryPort: contentServices.contentQueryService,
      contentRegistry: contentRegistry || null,
      webUrl: immichConfig?.webUrl || null,
      logger: rootLogger.child({ module: 'immich-feed' }),
    }) : null;
    const journalAdapter = new JournalFeedAdapter({
      loadLifelog: userLoadFile,
      logger: rootLogger.child({ module: 'journal-feed' }),
    });
    const plexAdapter = new PlexFeedAdapter({
      contentRegistry: contentRegistry || null,
      contentQueryPort: contentServices?.contentQueryService || null,
      webUrl: mediaLibConfig?.webUrl || mediaLibConfig?.host || null,
      plexHost: mediaLibConfig?.host || null,
      plexToken: mediaLibConfig?.token || null,
      logger: rootLogger.child({ module: 'plex-feed' }),
    });
    const googleAuth = dataService.system.read('auth/google');
    const pipedHost = configService.resolveServiceUrl('piped');
    const youtubeContentAdapter = pipedHost ? new YouTubeAdapter({
      host: pipedHost,
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'youtube-adapter' }),
    }) : null;
    const youtubeAdapter = googleAuth?.api_key ? new YouTubeFeedAdapter({
      apiKey: googleAuth.api_key,
      youtubeAdapter: youtubeContentAdapter,
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'youtube-feed' }),
    }) : null;
    const googleNewsAdapter = new GoogleNewsFeedAdapter({
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'googlenews-feed' }),
    });
    const komgaAuth = configService.getHouseholdAuth('komga');
    const komgaHost = configService.resolveServiceUrl('komga');
    const komgaFeedAdapter = komgaAuth?.token && komgaHost ? new KomgaFeedAdapter({
      client: new KomgaClient(
        { host: komgaHost, apiKey: komgaAuth.token },
        { httpClient: axios, logger: rootLogger.child({ module: 'komga-feed-client' }) }
      ),
      apiKey: komgaAuth.token,
      webUrl: configService.resolveServiceWebUrl('komga'),
      dataService,
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'komga-feed' }),
    }) : null;

    const readalongContentAdapter = contentRegistry?.get('readalong') || null;
    const readalongFeedAdapter = readalongContentAdapter ? new ReadalongFeedAdapter({
      readalongAdapter: readalongContentAdapter,
      logger: rootLogger.child({ module: 'readalong-feed' }),
    }) : null;

    const goodreadsFeedAdapter = new GoodreadsFeedAdapter({
      loadLifelog: userLoadFile,
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'goodreads-feed' }),
    });

    const { AudiobookshelfClient } = await import("../../../../capabilities/content-catalog/server/adapters/providers/readable/audiobookshelf/AudiobookshelfClient.mjs");
    const absEbookFeedAdapter = audiobookshelfConfig ? new ABSEbookFeedAdapter({
      absClient: new AudiobookshelfClient(audiobookshelfConfig, { httpClient: axios }),
      token: audiobookshelfConfig.token,
      mediaDir: mediaBasePath,
      webUrl: configService.resolveServiceWebUrl('audiobookshelf'),
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'abs-ebooks-feed' }),
    }) : null;

    // Start daily prefetch timer for abs-ebooks chapter cache
    if (absEbookFeedAdapter) {
      const allQueries = [...queryConfigs, ...loadUserQueries('user_1')];
      absEbookFeedAdapter.startPrefetchTimer(allQueries);
    }

    const { ScrollConfigLoader } = await import("../application/services/ScrollConfigLoader.mjs");
    const { DataServiceFeedConfigRepository } = await import("../adapters/DataServiceFeedConfigRepository.mjs");
    const { SpacingEnforcer } = await import("../application/services/SpacingEnforcer.mjs");
    const { TierAssemblyService } = await import("../application/services/TierAssemblyService.mjs");
    const { SourceResolver } = await import("../application/services/SourceResolver.mjs");
    const { FeedCacheService } = await import("../application/services/FeedCacheService.mjs");
    const { YamlFeedCacheRepository } = await import("../adapters/YamlFeedCacheRepository.mjs");

    const scrollConfigLoader = new ScrollConfigLoader({
      configRepository: new DataServiceFeedConfigRepository({ dataService }),
    });
    const spacingEnforcer = new SpacingEnforcer();
    const feedCacheService = new FeedCacheService({
      cacheRepository: new YamlFeedCacheRepository({ dataService }),
      scheduler: new NodeApplicationScheduler(),
      logger: rootLogger.child({ module: 'feed-cache' }),
    });

    const webContentAdapter = new WebContentAdapter({
      httpClient: feedHttpClient,
      logger: rootLogger.child({ module: 'web-content' }),
    });
    const feedContentService = new FeedContentService({
      webContentGateway: webContentAdapter,
      logger: rootLogger.child({ module: 'feed-content' }),
    });
    const { YamlSelectionTrackingStore } = await import("#adapters/persistence/yaml/YamlSelectionTrackingStore.mjs");
    const selectionTrackingStore = new YamlSelectionTrackingStore({ dataService, logger: rootLogger.child({ module: 'selection-tracking' }) });
    const { YamlDismissedItemsStore } = await import("#adapters/persistence/yaml/YamlDismissedItemsStore.mjs");
    const dismissedItemsStore = new YamlDismissedItemsStore({ dataService, logger: rootLogger.child({ module: 'feed-dismissed' }) });

    const { FeedPoolManager } = await import("../application/services/FeedPoolManager.mjs");
    const { FreshRSSSourceAdapter } = await import("../adapters/sources/FreshRSSSourceAdapter.mjs");
    const { HeadlineFeedAdapter } = await import("../adapters/sources/HeadlineFeedAdapter.mjs");
    const { EntropyFeedAdapter } = await import("../adapters/sources/EntropyFeedAdapter.mjs");

    const freshRSSFeedAdapter = new FreshRSSSourceAdapter({
      freshRSSAdapter: feedServices.freshRSSAdapter,
      configService,
      logger: rootLogger.child({ module: 'freshrss-feed' }),
    });
    const headlineFeedAdapter = new HeadlineFeedAdapter({
      headlineService: feedServices.headlineService,
      logger: rootLogger.child({ module: 'headline-feed' }),
    });
    const entropyFeedAdapter = new EntropyFeedAdapter({
      entropyService: entropyServices?.entropyService || null,
      logger: rootLogger.child({ module: 'entropy-feed' }),
    });

    const feedSourceAdapters = [redditAdapter, weatherAdapter, healthAdapter, gratitudeAdapter, stravaAdapter, todoistAdapter, immichAdapter, plexAdapter, journalAdapter, youtubeAdapter, googleNewsAdapter, komgaFeedAdapter, readalongFeedAdapter, goodreadsFeedAdapter, freshRSSFeedAdapter, headlineFeedAdapter, entropyFeedAdapter, absEbookFeedAdapter].filter(Boolean);

    const sourceResolver = new SourceResolver(feedSourceAdapters);

    const { ContentPluginRegistry } = await import("../application/services/ContentPluginRegistry.mjs");
    const { YouTubeContentPlugin } = await import("../adapters/plugins/youtube.mjs");
    const contentPluginRegistry = new ContentPluginRegistry([
      new YouTubeContentPlugin({ logger: rootLogger.child({ module: 'youtube-plugin' }) }),
    ]);

    const tierAssemblyService = new TierAssemblyService({
      spacingEnforcer,
      sourceResolver,
      logger: rootLogger.child({ module: 'tier-assembly' }),
    });

    const feedPoolManager = new FeedPoolManager({
      sourceAdapters: feedSourceAdapters,
      feedCacheService,
      queryConfigs,
      loadUserQueries,
      dismissedItemsStore,
      scheduler: new NodeApplicationScheduler(),
      logger: rootLogger.child({ module: 'feed-pool' }),
    });

    const { FeedFilterResolver } = await import("../application/services/FeedFilterResolver.mjs");
    const { FeedPrincipalResolver } = await import("../application/services/FeedPrincipalResolver.mjs");
    const { FeedReaderService } = await import("../application/services/FeedReaderService.mjs");
    const { FeedReaderTimelineService } = await import("../application/services/FeedReaderTimelineService.mjs");
    const { FeedScrollSessionService } = await import("../application/services/FeedScrollSessionService.mjs");
    const { FeedSessionPersistenceService } = await import("../application/services/FeedSessionPersistenceService.mjs");
    const feedFilterResolver = new FeedFilterResolver({
      sourceTypes: feedSourceAdapters.map(a => a.sourceType),
      queryNames: queryConfigs.map(q => q._filename?.replace('.yml', '')).filter(Boolean),
      aliases: {},
    });

    const feedAssemblyService = new FeedAssemblyService({
      feedPoolManager,
      sourceAdapters: feedSourceAdapters,
      sourceResolver,
      scrollConfigLoader,
      tierAssemblyService,
      feedContentService,
      selectionTrackingStore,
      feedFilterResolver,
      spacingEnforcer,
      contentPluginRegistry,
      logger: rootLogger.child({ module: 'feed-assembly' }),
    });
    const { YamlFeedItemStateStore } = await import("../adapters/persistence/YamlFeedItemStateStore.mjs");
    const { JsonlFeedHistoryStore } = await import("../adapters/persistence/JsonlFeedHistoryStore.mjs");
    const { YamlFeedSessionStore } = await import("../adapters/persistence/YamlFeedSessionStore.mjs");
    const { FeedStateService } = await import("../application/services/FeedStateService.mjs");
    const feedItemStateStore = new YamlFeedItemStateStore({
      dataService,
      logger: rootLogger.child({ module: 'feed-item-state-store' }),
    });
    const feedHistoryStore = new JsonlFeedHistoryStore({
      dataService,
      logger: rootLogger.child({ module: 'feed-history-store' }),
    });
    const feedSessionStore = new YamlFeedSessionStore({ dataService });
    const feedStateService = new FeedStateService({
      store: feedItemStateStore,
      historyStore: feedHistoryStore,
      sourceAdapters: feedSourceAdapters,
      legacyDismissedStore: dismissedItemsStore,
      clock: { now: () => Date.now() },
      createId: crypto.randomUUID,
      scheduler: new NodeApplicationScheduler(),
      logger: rootLogger.child({ module: 'feed-state' }),
    });
    const feedReaderService = new FeedReaderService({
      readerGateway: feedServices.freshRSSAdapter,
      sourceAdapters: feedSourceAdapters,
      dismissedItemsStore,
      contentPluginRegistry,
      logger: rootLogger.child({ module: 'feed-reader' }),
    });
    const feedPrincipalResolver = new FeedPrincipalResolver({
      defaultUsername: () => configService.getHeadOfHousehold?.(),
    });
    const feedReaderTimelineService = new FeedReaderTimelineService({
      reader: feedReaderService,
      content: feedContentService,
      state: feedStateService,
    });
    const feedScrollSessionService = new FeedScrollSessionService({
      assembly: feedAssemblyService,
      state: feedStateService,
      persistence: new FeedSessionPersistenceService({ store: feedSessionStore }),
      createId: crypto.randomUUID,
    });
    v1Routers.feed = createFeedRouter({
      feedReaderService,
      headlineService: feedServices.headlineService,
      feedAssemblyService,
      feedContentService,
      feedStateService,
      feedPrincipalResolver,
      feedReaderTimelineService,
      feedScrollSessionService,
      logger: rootLogger.child({ module: 'feed' }),
    });

}
