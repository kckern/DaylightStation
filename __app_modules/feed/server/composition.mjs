import { HttpClient } from "#system/services/HttpClient.mjs";
import { FreshRSSFeedAdapter } from "./adapters/FreshRSSFeedAdapter.mjs";
import { RssHeadlineHarvester, SOURCE_BLOCKED_IMAGE_URLS } from "./adapters/RssHeadlineHarvester.mjs";
import { GOOGLE_NEWS_BLOCKED_IMAGE_PATTERNS } from "./adapters/sources/GoogleNewsFeedAdapter.mjs";
import { WebContentAdapter } from "./adapters/WebContentAdapter.mjs";
import { YamlHeadlineCacheStore } from "#adapters/persistence/yaml/YamlHeadlineCacheStore.mjs";
import { HeadlineService } from "./application/services/HeadlineService.mjs";
import { HeadlineStoryJudge } from "./application/services/HeadlineStoryJudge.mjs";
import { DataServiceFeedConfigRepository } from "./adapters/DataServiceFeedConfigRepository.mjs";
import RSSParser from "rss-parser";

export function createFeedServices(config) {
  const { dataService, configService, freshrssHost, decisionGateway = null, logger = console } = config;

  const freshRSSAdapter = new FreshRSSFeedAdapter({
    freshrssHost,
    dataService,
    logger,
  });

  const rssParser = new RSSParser({
    customFields: {
      item: [
        ['media:content', 'media:content', { keepArray: true }],
        ['media:thumbnail', 'media:thumbnail'],
      ]
    }
  });
  const harvester = new RssHeadlineHarvester({ rssParser, logger });

  const headlineStore = new YamlHeadlineCacheStore({ dataService, logger });

  const webContentGateway = new WebContentAdapter({ httpClient: new HttpClient({ logger }), logger });
  const feedConfigRepository = new DataServiceFeedConfigRepository({ dataService });

  const headlineStoryJudge = new HeadlineStoryJudge({ decisionGateway, logger });

  const headlineService = new HeadlineService({
    headlineStore,
    harvester,
    configRepository: feedConfigRepository,
    config: {
      defaults: { retentionHours: 48, maxPerSource: 10, dedupeWordCount: 8 },
      // Vendor placeholder-image lists injected as values (adapter-owned constants)
      blockedImageUrls: SOURCE_BLOCKED_IMAGE_URLS,
      blockedImagePatterns: GOOGLE_NEWS_BLOCKED_IMAGE_PATTERNS,
    },
    webContentGateway,
    storyJudge: headlineStoryJudge,
    logger,
  });

  // Harvest job for manual or scheduled triggering
  const headlineHarvestJob = async () => {
    const username = configService.getHeadOfHousehold();
    return headlineService.harvestAll(username);
  };

  // Note: feedRouter is created in app.mjs after FeedAssemblyService is wired
  return { freshRSSAdapter, headlineService, headlineStoryJudge, headlineHarvestJob, feedConfigRepository };
}
