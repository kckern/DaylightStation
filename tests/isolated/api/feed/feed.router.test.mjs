// tests/isolated/api/feed/feed.router.test.mjs
import { jest } from '@jest/globals';
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
      getCategories: jest.fn().mockResolvedValue([
        { id: 'user/-/label/Tech', type: 'folder' },
      ]),
      getFeeds: jest.fn().mockResolvedValue([
        { id: 'feed/1', title: 'Hacker News', categories: [] },
      ]),
      getItems: jest.fn().mockResolvedValue({
        items: [
          { id: 'item1', title: 'Test Article', link: 'https://example.com', content: '<p>Body</p>' },
        ],
        continuation: null,
      }),
      markRead: jest.fn().mockResolvedValue(undefined),
    };
    mockHeadlineService = {
      getAllHeadlines: jest.fn().mockResolvedValue({
        sources: {
          cnn: { source: 'cnn', label: 'CNN', items: [{ title: 'News', link: 'https://cnn.com/1' }] },
        },
        lastHarvest: '2026-02-15T10:00:00Z',
      }),
      getSourceHeadlines: jest.fn().mockResolvedValue({
        source: 'cnn',
        label: 'CNN',
        items: [{ title: 'News' }],
      }),
      harvestAll: jest.fn().mockResolvedValue({ harvested: 2, errors: 0, totalItems: 15 }),
    };
    mockConfigService = {
      getHeadOfHousehold: jest.fn().mockReturnValue('kckern'),
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
      expect(mockFreshRSSAdapter.getCategories).toHaveBeenCalledWith('kckern');
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
      expect(mockFreshRSSAdapter.getItems).toHaveBeenCalledWith('feed/1', 'kckern', expect.any(Object));
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
      expect(mockFreshRSSAdapter.markRead).toHaveBeenCalledWith(['item1'], 'kckern');
    });
  });

  // Headlines endpoints
  describe('GET /headlines', () => {
    test('returns all cached headlines', async () => {
      const res = await request(app).get('/api/v1/feed/headlines');
      expect(res.status).toBe(200);
      expect(res.body.sources).toHaveProperty('cnn');
      expect(mockHeadlineService.getAllHeadlines).toHaveBeenCalledWith('kckern');
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
      expect(mockHeadlineService.harvestAll).toHaveBeenCalledWith('kckern');
    });
  });

  // Scroll endpoints
  describe('GET /scroll', () => {
    let scrollApp;
    let mockFeedAssemblyService;

    beforeEach(() => {
      mockFeedAssemblyService = {
        getNextBatch: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
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
        'kckern',
        expect.objectContaining({ focus: 'reddit:science' }),
      );
    });

    test('limit defaults to undefined when not provided', async () => {
      await request(scrollApp).get('/api/v1/feed/scroll');
      expect(mockFeedAssemblyService.getNextBatch).toHaveBeenCalledWith(
        'kckern',
        expect.objectContaining({ limit: undefined }),
      );
    });

    test('passes explicit limit as number', async () => {
      await request(scrollApp).get('/api/v1/feed/scroll?limit=20');
      expect(mockFeedAssemblyService.getNextBatch).toHaveBeenCalledWith(
        'kckern',
        expect.objectContaining({ limit: 20 }),
      );
    });
  });
});
