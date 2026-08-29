import { createFeedRouter } from '#api/v1/routers/feed.mjs';
import { FeedPrincipalResolver } from '#apps/feed/services/FeedPrincipalResolver.mjs';
import { FeedReaderTimelineService } from '#apps/feed/services/FeedReaderTimelineService.mjs';
import { FeedScrollSessionService } from '#apps/feed/services/FeedScrollSessionService.mjs';

export function createFeedTestRouter(legacy = {}) {
  const {
    freshRSSAdapter = null, feedReaderService = null, configService = null,
    feedPrincipalResolver = null, feedReaderTimelineService = null,
    feedScrollSessionService = null, feedSessionPersistence = null,
    feedAssemblyService = null, feedContentService = null, feedStateService = null,
    contentPluginRegistry = null,
    ...options
  } = legacy;
  const reader = feedReaderService ?? adaptReader(freshRSSAdapter, contentPluginRegistry);
  const content = feedContentService ?? {
    resolveIconPath: () => null,
    resolveIcon: async () => null,
    proxyImage: async () => ({ contentType: 'image/svg+xml', data: Buffer.from('') }),
    extractReadableContent: async () => ({}),
  };
  return createFeedRouter({
    ...options,
    feedReaderService: reader,
    feedAssemblyService,
    feedContentService: content,
    feedStateService,
    feedPrincipalResolver: feedPrincipalResolver ?? new FeedPrincipalResolver({
      defaultUsername: () => configService?.getHeadOfHousehold?.(),
    }),
    feedReaderTimelineService: feedReaderTimelineService ?? new FeedReaderTimelineService({
      reader, content, state: feedStateService,
    }),
    feedScrollSessionService: feedScrollSessionService ?? (feedAssemblyService
      ? new FeedScrollSessionService({
        assembly: feedAssemblyService, state: feedStateService,
        persistence: feedSessionPersistence, createId: () => '00000000-0000-4000-8000-000000000001',
      })
      : null),
  });
}

function adaptReader(adapter = {}, contentPluginRegistry = null) {
  return {
    getCategories: (...args) => adapter.getCategories(...args),
    getFeeds: (...args) => adapter.getFeeds(...args),
    getItems: (...args) => adapter.getItems(...args),
    markItems: (ids, username, action) => (action === 'read'
      ? adapter.markRead(ids, username)
      : adapter.markUnread(ids, username)),
    dismiss: (...args) => adapter.dismiss?.(...args),
    enrich: (items) => contentPluginRegistry?.enrich?.(items) ?? items,
  };
}

export default createFeedTestRouter;
