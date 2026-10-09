import { HeadlineHarvesterAdapter } from "../adapters/HeadlineHarvesterAdapter.mjs";

export function registerFeedHeadlineHarvester({ harvesterServices, feedServices, rootLogger }) {
try {
    harvesterServices.harvesterService.register(new HeadlineHarvesterAdapter({
      headlineService: feedServices.headlineService,
      logger: rootLogger.child({ module: 'feed-headline-harvester' }),
    }));
  } catch (err) {
    rootLogger.warn?.('feed-headline-harvester.register.failed', { error: err.message });
  }
}
