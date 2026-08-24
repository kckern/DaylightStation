// tests/isolated/api/feed/feed.router.test.mjs
import { vi, describe, test, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFeedRouter } from '#api/v1/routers/feed.mjs';

describe('Feed Router', () => {
  let app;
  let mockFreshRSSAdapter;
  let mockHeadlineService;
  let mockConfigService;

  beforeEach(() => {
    mockFreshRSSAdapter = {
      getCategories: vi.fn().mockResolvedValue([
        { id: 'user/-/label/Tech', type: 'folder' },
      ]),
      getFeeds: vi.fn().mockResolvedValue([
        { id: 'feed/1', title: 'Hacker News', categories: [] },
      ]),
      getItems: vi.fn().mockResolvedValue({
        items: [
          { id: 'item1', title: 'Test Article', link: 'https://example.com', content: '<p>Body</p>' },
        ],
        continuation: null,
      }),
      markRead: vi.fn().mockResolvedValue(undefined),
    };
    mockHeadlineService = {
      getPageList: vi.fn().mockReturnValue([{ id: 'main', label: 'Main' }]),
      getAllHeadlines: vi.fn().mockResolvedValue({
        sources: {
          cnn: { source: 'cnn', label: 'CNN', items: [{ title: 'News', link: 'https://cnn.com/1' }] },
        },
        lastHarvest: '2026-02-15T10:00:00Z',
      }),
      getSourceHeadlines: vi.fn().mockResolvedValue({
        source: 'cnn',
        label: 'CNN',
        items: [{ title: 'News' }],
      }),
      harvestAll: vi.fn().mockResolvedValue({ harvested: 2, errors: 0, totalItems: 15 }),
    };
    mockConfigService = {
      getHeadOfHousehold: vi.fn().mockReturnValue('user_1'),
    };

    const router = createFeedRouter({
      freshRSSAdapter: mockFreshRSSAdapter,
      headlineService: mockHeadlineService,
      configService: mockConfigService,
    });

    app = express();
    app.use(express.json());
    app.use('/api/v1/feed', router);
  });

  // Reader endpoints
  describe('GET /reader/categories', () => {
    test('returns FreshRSS categories', async () => {
      const res = await request(app).get('/api/v1/feed/reader/categories');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(mockFreshRSSAdapter.getCategories).toHaveBeenCalledWith('user_1');
    });
  });

  describe('GET /reader/feeds', () => {
    test('returns FreshRSS subscriptions', async () => {
      const res = await request(app).get('/api/v1/feed/reader/feeds');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe('GET /reader/items', () => {
    test('returns items for a feed', async () => {
      const res = await request(app).get('/api/v1/feed/reader/items?feed=feed/1');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.continuation).toBeNull();
      expect(mockFreshRSSAdapter.getItems).toHaveBeenCalledWith('feed/1', 'user_1', expect.any(Object));
    });

    test('returns 400 without feed param', async () => {
      const res = await request(app).get('/api/v1/feed/reader/items');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /reader/items/mark', () => {
    test('marks items read', async () => {
      const res = await request(app)
        .post('/api/v1/feed/reader/items/mark')
        .send({ itemIds: ['item1'], action: 'read' });
      expect(res.status).toBe(200);
      expect(mockFreshRSSAdapter.markRead).toHaveBeenCalledWith(['item1'], 'user_1');
    });
  });

  // Headlines endpoints
  describe('GET /headlines', () => {
    test('returns all cached headlines', async () => {
      const res = await request(app).get('/api/v1/feed/headlines');
      expect(res.status).toBe(200);
      expect(res.body.sources).toHaveProperty('cnn');
      expect(mockHeadlineService.getAllHeadlines).toHaveBeenCalledWith('user_1', 'main');
    });
  });

  describe('GET /headlines/:source', () => {
    test('returns headlines for one source', async () => {
      const res = await request(app).get('/api/v1/feed/headlines/cnn');
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('cnn');
    });

    test('returns 404 for unknown source', async () => {
      mockHeadlineService.getSourceHeadlines.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/feed/headlines/unknown');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /headlines/harvest', () => {
    test('triggers manual harvest', async () => {
      const res = await request(app).post('/api/v1/feed/headlines/harvest');
      expect(res.status).toBe(200);
      expect(res.body.harvested).toBe(2);
      expect(mockHeadlineService.harvestAll).toHaveBeenCalledWith('user_1', undefined);
    });
  });

  // Scroll endpoints
  describe('GET /scroll', () => {
    let scrollApp;
    let mockFeedAssemblyService;

    beforeEach(() => {
      mockFeedAssemblyService = {
        getNextBatch: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
      };
      const router = createFeedRouter({
        freshRSSAdapter: mockFreshRSSAdapter,
        headlineService: mockHeadlineService,
        feedAssemblyService: mockFeedAssemblyService,
        configService: mockConfigService,
      });
      scrollApp = express();
      scrollApp.use(express.json());
      scrollApp.use('/api/v1/feed', router);
    });

    test('passes focus param to feedAssemblyService', async () => {
      await request(scrollApp).get('/api/v1/feed/scroll?focus=reddit:science');
      expect(mockFeedAssemblyService.getNextBatch).toHaveBeenCalledWith(
        'user_1',
        expect.objectContaining({ focus: 'reddit:science' }),
      );
    });

    test('limit defaults to undefined when not provided', async () => {
      await request(scrollApp).get('/api/v1/feed/scroll');
      expect(mockFeedAssemblyService.getNextBatch).toHaveBeenCalledWith(
        'user_1',
        expect.objectContaining({ limit: undefined }),
      );
    });

    test('passes explicit limit as number', async () => {
      await request(scrollApp).get('/api/v1/feed/scroll?limit=20');
      expect(mockFeedAssemblyService.getNextBatch).toHaveBeenCalledWith(
        'user_1',
        expect.objectContaining({ limit: 20 }),
      );
    });

    test('passes filter param to feedAssemblyService', async () => {
      await request(scrollApp).get('/api/v1/feed/scroll?filter=reddit:worldnews,usnews');
      expect(mockFeedAssemblyService.getNextBatch).toHaveBeenCalledWith(
        'user_1',
        expect.objectContaining({ filter: 'reddit:worldnews,usnews' }),
      );
    });

    test('filter param defaults to null when not provided', async () => {
      await request(scrollApp).get('/api/v1/feed/scroll');
      expect(mockFeedAssemblyService.getNextBatch).toHaveBeenCalledWith(
        'user_1',
        expect.objectContaining({ filter: null }),
      );
    });
  });

  describe('unified state, search, and scroll sessions', () => {
    let featureApp;
    let feedStateService;
    let feedAssemblyService;

    beforeEach(() => {
      feedStateService = {
        enrich: vi.fn((_username, items) => items),
        mutate: vi.fn().mockResolvedValue([{ id: 'one', state: { isSaved: true } }]),
        summary: vi.fn().mockReturnValue({ unread: 4, readerUnread: 2, saved: 1, archived: 0, pendingSync: 0 }),
        retryPending: vi.fn().mockResolvedValue(undefined),
        ensureHistoryBackfill: vi.fn(),
        historyBackfillStatus: vi.fn().mockReturnValue({ status: 'complete', indexed: 40 }),
        search: vi.fn().mockReturnValue({ items: [{ id: 'one' }], total: 1, nextOffset: null }),
        getWorkspace: vi.fn().mockReturnValue({ preferences: { theme: 'dark' }, checkpoints: {} }),
        updatePreferences: vi.fn().mockResolvedValue({ theme: 'sepia' }),
        recordCheckpoint: vi.fn().mockResolvedValue({ itemId: 'one', scrollOffset: 42, visitedAt: '2026-08-24T12:00:00.000Z' }),
        listAnnotations: vi.fn().mockReturnValue([{ id: 'note-1', itemId: 'one', note: 'Important' }]),
        createAnnotation: vi.fn().mockResolvedValue({ id: 'note-1', itemId: 'one', note: 'Important' }),
        updateAnnotation: vi.fn().mockResolvedValue({ id: 'note-1', itemId: 'one', note: 'Revised' }),
        deleteAnnotation: vi.fn().mockResolvedValue(true),
        exportData: vi.fn().mockReturnValue({ format: 'daylight.feed-export/v1', states: [] }),
        importData: vi.fn().mockResolvedValue({ states: 1, annotations: 0, items: 1 }),
        getSourcePreferences: vi.fn().mockReturnValue({ reddit: 'less' }),
        updateSourcePreference: vi.fn().mockResolvedValue({ reddit: 'more' }),
      };
      feedAssemblyService = {
        getNextBatch: vi.fn().mockResolvedValue({ items: [{ id: 'one' }], hasMore: true, caughtUp: false }),
        snapshotSession: vi.fn().mockReturnValue({ pool: [{ id: 'one' }], seenItems: [{ id: 'one' }] }),
        restoreSession: vi.fn().mockReturnValue(true),
        getSessionItems: vi.fn().mockReturnValue([{ id: 'one' }]),
        sessionHasMore: vi.fn().mockReturnValue(true),
        getSessionMetadata: vi.fn().mockReturnValue({ colors: { wire: '#fff' } }),
      };
      featureApp = express();
      featureApp.use(express.json());
      featureApp.use('/api/v1/feed', createFeedRouter({
        freshRSSAdapter: mockFreshRSSAdapter,
        headlineService: mockHeadlineService,
        feedAssemblyService,
        feedStateService,
        configService: mockConfigService,
      }));
    });

    test('mutates and summarizes unified item state', async () => {
      const mutation = await request(featureApp).patch('/api/v1/feed/items/state').send({ itemIds: ['one'], action: 'save' });
      const summary = await request(featureApp).get('/api/v1/feed/items/state/summary');
      expect(mutation.status).toBe(200);
      expect(summary.body).toMatchObject({ unread: 4, readerUnread: 2, saved: 1 });
    });

    test('passes indexed search filters and reports coverage', async () => {
      const res = await request(featureApp).get('/api/v1/feed/search?q=storm&mode=headlines&source=Wire&from=2026-01-01');
      expect(res.status).toBe(200);
      expect(feedStateService.search).toHaveBeenCalledWith('user_1', expect.objectContaining({ query: 'storm', mode: 'headlines', source: 'Wire', from: '2026-01-01' }));
      expect(res.body.coverage.status).toBe('complete');
    });

    test('creates and resumes a scroll session with served items', async () => {
      const created = await request(featureApp).post('/api/v1/feed/scroll/sessions').send({ filter: 'wire' });
      const resumed = await request(featureApp).get(`/api/v1/feed/scroll/sessions/${created.body.sessionId}?resume=1`);
      expect(created.status).toBe(201);
      expect(resumed.status).toBe(200);
      expect(resumed.body).toMatchObject({ resumed: true, hasMore: true, items: [{ id: 'one' }] });
    });

    test('loads and updates account-scoped workspace settings and checkpoints', async () => {
      const workspace = await request(featureApp).get('/api/v1/feed/workspace');
      const preferences = await request(featureApp).patch('/api/v1/feed/workspace/preferences').send({ theme: 'sepia' });
      const checkpoint = await request(featureApp).put('/api/v1/feed/workspace/checkpoints/reader').send({ itemId: 'one', scrollOffset: 42 });

      expect(workspace.body).toMatchObject({ preferences: { theme: 'dark' } });
      expect(preferences.body).toEqual({ preferences: { theme: 'sepia' } });
      expect(checkpoint.body.checkpoint).toMatchObject({ itemId: 'one', scrollOffset: 42 });
      expect(feedStateService.recordCheckpoint).toHaveBeenCalledWith('user_1', 'reader', { itemId: 'one', scrollOffset: 42 });

      const source = await request(featureApp).put('/api/v1/feed/workspace/sources/reddit').send({ level: 'more' });
      expect(source.body).toEqual({ sourcePreferences: { reddit: 'more' } });
      expect(feedStateService.updateSourcePreference).toHaveBeenCalledWith('user_1', 'reddit', 'more');
    });

    test('provides annotation CRUD with validation and not-found semantics', async () => {
      const created = await request(featureApp).post('/api/v1/feed/annotations').send({ itemId: 'one', note: 'Important' });
      const listed = await request(featureApp).get('/api/v1/feed/annotations?itemId=one');
      const updated = await request(featureApp).patch('/api/v1/feed/annotations/note-1').send({ note: 'Revised' });
      const removed = await request(featureApp).delete('/api/v1/feed/annotations/note-1');

      expect(created.status).toBe(201);
      expect(listed.body.annotations).toHaveLength(1);
      expect(updated.body.annotation.note).toBe('Revised');
      expect(removed.body).toEqual({ removed: true });
      expect((await request(featureApp).post('/api/v1/feed/annotations').send({ note: 'Missing item' })).status).toBe(400);
    });

    test('exports and imports the portable feed format', async () => {
      const exported = await request(featureApp).get('/api/v1/feed/data/export');
      const imported = await request(featureApp).post('/api/v1/feed/data/import').send({ format: 'daylight.feed-export/v1' });

      expect(exported.status).toBe(200);
      expect(exported.headers['content-disposition']).toContain('daylight-feed-');
      expect(imported.body).toEqual({ imported: { states: 1, annotations: 0, items: 1 } });
      expect(feedStateService.importData).toHaveBeenCalledWith('user_1', { format: 'daylight.feed-export/v1' });
    });
  });

  // Content plugin enrichment
  describe('Content plugin enrichment on /reader/stream', () => {
    test('enriches YouTube URLs from FreshRSS with contentType and videoId', async () => {
      const { ContentPluginRegistry } = await import('#apps/feed/services/ContentPluginRegistry.mjs');
      const { YouTubeContentPlugin } = await import('#adapters/feed/plugins/youtube.mjs');
      const registry = new ContentPluginRegistry([new YouTubeContentPlugin()]);

      const ytMockAdapter = {
        ...mockFreshRSSAdapter,
        getItems: vi.fn().mockResolvedValue({
          items: [{
            id: 'yt-item-1',
            title: 'Cool Video',
            link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            content: '<p>Video description</p>',
            published: new Date('2026-02-18T12:00:00Z'),
            author: null,
            feedTitle: 'My YouTube Channel',
            feedId: 'feed/yt1',
            categories: [],
          }],
          continuation: null,
        }),
        getFeeds: vi.fn().mockResolvedValue([]),
      };

      const ytApp = express();
      ytApp.use(express.json());
      ytApp.use('/api/v1/feed', createFeedRouter({
        freshRSSAdapter: ytMockAdapter,
        headlineService: mockHeadlineService,
        feedAssemblyService: { getNextBatch: vi.fn() },
        // Production calls feedContentService.resolveIconPath; expose both
        // names so we don't depend on which one is in flight.
        feedContentService: { resolveIcon: vi.fn(), resolveIconPath: vi.fn() },
        contentPluginRegistry: registry,
        configService: mockConfigService,
      }));

      const res = await request(ytApp).get('/api/v1/feed/reader/stream?days=3');
      expect(res.status).toBe(200);
      const item = res.body.items[0];
      expect(item.contentType).toBe('youtube');
      expect(item.meta.videoId).toBe('dQw4w9WgXcQ');
      expect(item.meta.playable).toBe(true);
    });
  });
});
