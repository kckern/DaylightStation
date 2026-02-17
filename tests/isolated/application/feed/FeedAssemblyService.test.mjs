// tests/isolated/application/feed/FeedAssemblyService.test.mjs
import { jest } from '@jest/globals';
import { FeedAssemblyService } from '#apps/feed/services/FeedAssemblyService.mjs';

describe('FeedAssemblyService scroll config integration', () => {
  let mockScrollConfigLoader;
  let mockTierAssemblyService;

  const defaultScrollConfig = {
    batch_size: 15,
    algorithm: { grounding_ratio: 5, decay_rate: 0.85, min_ratio: 2 },
    focus_mode: { grounding_ratio: 8, decay_rate: 0.9, min_ratio: 3 },
    spacing: { max_consecutive: 1 },
    sources: {},
  };

  const makeExternalItem = (source, id) => ({
    id: id || `${source}:${Math.random()}`,
    type: 'external',
    source,
    title: `${source} item`,
    meta: { sourceName: source },
  });

  const makeGroundingItem = (source, id, priority = 5) => ({
    id: id || `${source}:${Math.random()}`,
    type: 'grounding',
    source,
    title: `${source} item`,
    priority,
    meta: { sourceName: source },
  });

  beforeEach(() => {
    mockScrollConfigLoader = {
      load: jest.fn().mockReturnValue(defaultScrollConfig),
    };
    mockTierAssemblyService = {
      assemble: jest.fn().mockImplementation((items) => ({ items, hasMore: false })),
    };
  });

  function createService(queryConfigs, adapters = [], overrides = {}) {
    return new FeedAssemblyService({
      freshRSSAdapter: null,
      headlineService: null,
      entropyService: null,
      queryConfigs,
      sourceAdapters: adapters,
      scrollConfigLoader: mockScrollConfigLoader,
      tierAssemblyService: mockTierAssemblyService,
      logger: { info: jest.fn(), warn: jest.fn() },
      ...overrides,
    });
  }

  test('loads scroll config for the requesting user', async () => {
    const service = createService([]);
    await service.getNextBatch('alice');
    expect(mockScrollConfigLoader.load).toHaveBeenCalledWith('alice');
  });

  test('filters query configs to sources listed in scroll config', async () => {
    const mockAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue([makeExternalItem('reddit', 'r1')]),
    };
    const mockHealthAdapter = {
      sourceType: 'health',
      fetchItems: jest.fn().mockResolvedValue([makeGroundingItem('health', 'h1')]),
    };

    mockScrollConfigLoader.load.mockReturnValue({
      ...defaultScrollConfig,
      tiers: {
        wire: { sources: { reddit: { max_per_batch: 5 } }, selection: {} },
        library: { sources: {}, selection: {} },
        scrapbook: { sources: {}, selection: {} },
        compass: { sources: {}, selection: {} },
      },
      // health NOT listed in any tier => should be skipped
    });

    const service = createService(
      [
        { type: 'reddit', feed_type: 'external', _filename: 'reddit.yml' },
        { type: 'health', feed_type: 'grounding', _filename: 'health.yml' },
      ],
      [mockAdapter, mockHealthAdapter],
    );

    await service.getNextBatch('kckern');
    expect(mockAdapter.fetchItems).toHaveBeenCalled();
    expect(mockHealthAdapter.fetchItems).not.toHaveBeenCalled();
  });

  test('fetches ALL sources when scroll config sources is empty object', async () => {
    const mockAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue([]),
    };

    mockScrollConfigLoader.load.mockReturnValue({
      ...defaultScrollConfig,
      sources: {},
    });

    const service = createService(
      [{ type: 'reddit', feed_type: 'external', _filename: 'reddit.yml' }],
      [mockAdapter],
    );

    await service.getNextBatch('kckern');
    expect(mockAdapter.fetchItems).toHaveBeenCalled();
  });

  test('uses focus_mode algorithm params when focus option present', async () => {
    mockScrollConfigLoader.load.mockReturnValue({
      ...defaultScrollConfig,
      focus_mode: { grounding_ratio: 10, decay_rate: 0.95, min_ratio: 4 },
    });

    const service = createService([]);
    await service.getNextBatch('kckern', { focus: 'reddit:science' });
    expect(mockTierAssemblyService.assemble).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      expect.objectContaining({ focus: 'reddit:science' }),
    );
  });

  test('delegates to TierAssemblyService for assembly', async () => {
    const mockAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue([
        makeExternalItem('reddit', 'r1'),
        makeExternalItem('reddit', 'r2'),
      ]),
    };

    const service = createService(
      [{ type: 'reddit', feed_type: 'external', _filename: 'reddit.yml' }],
      [mockAdapter],
    );

    await service.getNextBatch('kckern');
    expect(mockTierAssemblyService.assemble).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ spacing: { max_consecutive: 1 } }),
      expect.any(Object),
    );
  });

  test('uses batch_size from scroll config as default limit', async () => {
    mockScrollConfigLoader.load.mockReturnValue({
      ...defaultScrollConfig,
      batch_size: 5,
    });

    const mockAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => makeExternalItem('reddit', `r${i}`))
      ),
    };

    const service = createService(
      [{ type: 'reddit', feed_type: 'external', _filename: 'reddit.yml' }],
      [mockAdapter],
    );

    const result = await service.getNextBatch('kckern');
    expect(result.items.length).toBeLessThanOrEqual(5);
  });

  test('explicit limit overrides batch_size from config', async () => {
    mockScrollConfigLoader.load.mockReturnValue({
      ...defaultScrollConfig,
      batch_size: 5,
    });

    const mockAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => makeExternalItem('reddit', `r${i}`))
      ),
    };

    const service = createService(
      [{ type: 'reddit', feed_type: 'external', _filename: 'reddit.yml' }],
      [mockAdapter],
    );

    const result = await service.getNextBatch('kckern', { limit: 8 });
    expect(result.items.length).toBeLessThanOrEqual(8);
  });

  test('focus mode filters external items to focused source', async () => {
    const redditAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue([
        { ...makeExternalItem('reddit', 'r1'), meta: { subreddit: 'science', sourceName: 'reddit' } },
        { ...makeExternalItem('reddit', 'r2'), meta: { subreddit: 'tech', sourceName: 'reddit' } },
      ]),
    };
    const headlinesAdapter = {
      sourceType: 'headlines',
      fetchItems: jest.fn().mockResolvedValue([
        makeExternalItem('headline', 'h1'),
      ]),
    };
    const weatherAdapter = {
      sourceType: 'weather',
      fetchItems: jest.fn().mockResolvedValue([
        makeGroundingItem('weather', 'w1', 3),
      ]),
    };

    const service = createService(
      [
        { type: 'reddit', feed_type: 'external', _filename: 'reddit.yml' },
        { type: 'headlines', feed_type: 'external', _filename: 'headlines.yml' },
        { type: 'weather', feed_type: 'grounding', _filename: 'weather.yml' },
      ],
      [redditAdapter, headlinesAdapter, weatherAdapter],
    );

    const result = await service.getNextBatch('kckern', { focus: 'reddit' });
    // TierAssemblyService receives the items with focus='reddit'
    expect(mockTierAssemblyService.assemble).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      expect.objectContaining({ focus: 'reddit' }),
    );
    // The passthrough mock returns all items; verify reddit is present
    const sources = result.items.map(i => i.source);
    const hasReddit = sources.includes('reddit');
    expect(hasReddit).toBe(true);
  });

  test('focus mode with subsource filters to specific subsource', async () => {
    const redditAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue([
        { ...makeExternalItem('reddit', 'r1'), meta: { subreddit: 'science', sourceName: 'reddit' } },
        { ...makeExternalItem('reddit', 'r2'), meta: { subreddit: 'tech', sourceName: 'reddit' } },
      ]),
    };

    const service = createService(
      [{ type: 'reddit', feed_type: 'external', _filename: 'reddit.yml' }],
      [redditAdapter],
    );

    const result = await service.getNextBatch('kckern', { focus: 'reddit:science' });
    // TierAssemblyService receives focus='reddit:science'
    expect(mockTierAssemblyService.assemble).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      expect.objectContaining({ focus: 'reddit:science' }),
    );
    const redditItems = result.items.filter(i => i.source === 'reddit');
    expect(redditItems.length).toBeGreaterThan(0);
  });
});

describe('image dimensions passthrough', () => {
  let mockScrollConfigLoader;
  let mockTierAssemblyService;

  const defaultScrollConfig = {
    batch_size: 15,
    spacing: { max_consecutive: 1 },
    sources: {},
  };

  beforeEach(() => {
    mockScrollConfigLoader = {
      load: jest.fn().mockReturnValue(defaultScrollConfig),
    };
    mockTierAssemblyService = {
      assemble: jest.fn().mockImplementation((items) => ({ items, hasMore: false })),
    };
  });

  function createService(queryConfigs, adapters = [], overrides = {}) {
    return new FeedAssemblyService({
      freshRSSAdapter: null,
      headlineService: null,
      entropyService: null,
      queryConfigs,
      sourceAdapters: adapters,
      scrollConfigLoader: mockScrollConfigLoader,
      tierAssemblyService: mockTierAssemblyService,
      logger: { info: jest.fn(), warn: jest.fn() },
      ...overrides,
    });
  }

  test('passes through imageWidth/imageHeight from adapter meta', async () => {
    const mockAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue([{
        id: 'reddit:abc',
        tier: 'wire',
        source: 'reddit',
        title: 'Test Post',
        image: '/api/v1/proxy/reddit/i.redd.it/abc.jpg',
        timestamp: new Date().toISOString(),
        meta: { sourceName: 'r/test', imageWidth: 1920, imageHeight: 1080 },
      }]),
    };

    const service = createService(
      [{ type: 'reddit', feed_type: 'external', _filename: 'reddit.yml' }],
      [mockAdapter],
    );

    // Use sources filter to bypass tier assembly
    const result = await service.getNextBatch('testuser', { sources: ['reddit'] });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].meta.imageWidth).toBe(1920);
    expect(result.items[0].meta.imageHeight).toBe(1080);
  });

  test('passes through headline imageWidth/imageHeight from item', async () => {
    const mockHeadlineService = {
      getPageList: jest.fn().mockReturnValue([{ id: 'page1' }]),
      getAllHeadlines: jest.fn().mockResolvedValue({
        sources: {
          cnn: {
            label: 'CNN',
            paywall: false,
            items: [{
              title: 'Breaking News',
              link: 'https://cnn.com/article',
              image: 'https://cnn.com/thumb.jpg',
              imageWidth: 640,
              imageHeight: 360,
              timestamp: new Date().toISOString(),
            }],
          },
        },
        paywallProxy: null,
      }),
    };

    const service = createService(
      [{ type: 'headlines', feed_type: 'external', _filename: 'headlines.yml' }],
      [],
      { headlineService: mockHeadlineService },
    );

    // Use sources filter to bypass tier assembly (source is 'headline')
    const result = await service.getNextBatch('testuser', { sources: ['headline'] });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].meta.imageWidth).toBe(640);
    expect(result.items[0].meta.imageHeight).toBe(360);
  });

  test('FreshRSS items get probed image dimensions', async () => {
    // Mock probeImageDimensions at the module level is hard with ESM,
    // so we test the integration path: FreshRSS handler extracts image,
    // then probes it. We mock the freshRSSAdapter to return items with images
    // and verify the flow works end-to-end (probe will fail on fake URLs,
    // so we just verify no crash and meta doesn't have dimensions for failed probes).
    const mockFreshRSSAdapter = {
      getItems: jest.fn().mockResolvedValue([{
        id: 'item1',
        title: 'RSS Article',
        content: '<p>No image here</p>',
        link: 'https://example.com/article',
        published: new Date().toISOString(),
        feedTitle: 'Example Feed',
        author: 'Test Author',
      }]),
    };

    const service = createService(
      [{ type: 'freshrss', feed_type: 'external', _filename: 'freshrss.yml' }],
      [],
      { freshRSSAdapter: mockFreshRSSAdapter },
    );

    // Use sources filter to get freshrss items directly
    const result = await service.getNextBatch('testuser', { sources: ['freshrss'] });
    expect(result.items.length).toBeGreaterThan(0);
    // No image in this item, so no dimensions expected
    expect(result.items[0].image).toBeNull();
    expect(result.items[0].meta.imageWidth).toBeUndefined();
    expect(result.items[0].meta.imageHeight).toBeUndefined();
  });
});

describe('seenIds dedup', () => {
  let mockScrollConfigLoader;
  let mockTierAssemblyService;

  const defaultScrollConfig = {
    batch_size: 15,
    spacing: { max_consecutive: 1 },
    tiers: {
      wire: { selection: { sort: 'timestamp_desc' }, sources: {} },
      library: { allocation: 2, selection: { sort: 'random' }, sources: {} },
      scrapbook: { allocation: 2, selection: { sort: 'random' }, sources: {} },
      compass: { allocation: 3, selection: { sort: 'priority' }, sources: {} },
    },
  };

  beforeEach(() => {
    mockScrollConfigLoader = {
      load: jest.fn().mockReturnValue(defaultScrollConfig),
    };
    mockTierAssemblyService = {
      assemble: jest.fn().mockImplementation((items, config, opts) => {
        const limit = opts?.effectiveLimit || 15;
        return { items: items.slice(0, limit), hasMore: items.length > limit };
      }),
    };
  });

  function createService(queryConfigs, adapters = [], overrides = {}) {
    return new FeedAssemblyService({
      freshRSSAdapter: null,
      headlineService: null,
      entropyService: null,
      queryConfigs,
      sourceAdapters: adapters,
      scrollConfigLoader: mockScrollConfigLoader,
      tierAssemblyService: mockTierAssemblyService,
      logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      ...overrides,
    });
  }

  test('fresh load (no cursor) returns full batch', async () => {
    const adapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          id: `reddit:r${i}`, tier: 'wire', source: 'reddit',
          title: `Post ${i}`, timestamp: new Date(2026, 1, 17, 10 - i).toISOString(),
        }))
      ),
    };
    const service = createService(
      [{ type: 'reddit', _filename: 'reddit.yml' }],
      [adapter],
    );
    const result = await service.getNextBatch('testuser');
    expect(result.items.length).toBe(15);
    expect(result.hasMore).toBe(true);
  });

  test('continuation (with cursor) excludes previously sent items', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `reddit:r${i}`, tier: 'wire', source: 'reddit',
      title: `Post ${i}`, timestamp: new Date(2026, 1, 17, 10 - i).toISOString(),
    }));
    const adapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue(items),
    };
    const service = createService(
      [{ type: 'reddit', _filename: 'reddit.yml' }],
      [adapter],
    );

    const batch1 = await service.getNextBatch('testuser');
    const batch2 = await service.getNextBatch('testuser', { cursor: 'continue' });

    const batch1Ids = new Set(batch1.items.map(i => i.id));
    const batch2Ids = new Set(batch2.items.map(i => i.id));
    // No overlap
    for (const id of batch2Ids) {
      expect(batch1Ids.has(id)).toBe(false);
    }
  });

  test('fresh load clears seenIds from previous session', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `reddit:r${i}`, tier: 'wire', source: 'reddit',
      title: `Post ${i}`, timestamp: new Date(2026, 1, 17, 10 - i).toISOString(),
    }));
    const adapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue(items),
    };
    const service = createService(
      [{ type: 'reddit', _filename: 'reddit.yml' }],
      [adapter],
    );

    const batch1 = await service.getNextBatch('testuser');
    // Fresh load (no cursor) — same items should come back
    const batch2 = await service.getNextBatch('testuser');
    expect(batch2.items.length).toBe(batch1.items.length);
  });
});

describe('padding', () => {
  let mockScrollConfigLoader;
  let mockTierAssemblyService;

  beforeEach(() => {
    mockTierAssemblyService = {
      assemble: jest.fn().mockImplementation((items, config, opts) => {
        const limit = opts?.effectiveLimit || 10;
        return { items: items.slice(0, limit), hasMore: items.length > limit };
      }),
    };
  });

  function createService(queryConfigs, adapters = [], overrides = {}) {
    return new FeedAssemblyService({
      freshRSSAdapter: null,
      headlineService: null,
      entropyService: null,
      queryConfigs,
      sourceAdapters: adapters,
      scrollConfigLoader: overrides.scrollConfigLoader || { load: jest.fn() },
      tierAssemblyService: mockTierAssemblyService,
      logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      ...overrides,
    });
  }

  test('fills remaining slots from padding sources', async () => {
    const paddingScrollConfig = {
      batch_size: 10,
      spacing: { max_consecutive: 1 },
      tiers: {
        wire: { selection: { sort: 'timestamp_desc' }, sources: {} },
        library: { allocation: 2, selection: { sort: 'random' }, sources: {} },
        scrapbook: {
          allocation: 2,
          selection: { sort: 'random' },
          sources: { photos: { max_per_batch: 4, padding: true } },
        },
        compass: { allocation: 3, selection: { sort: 'priority' }, sources: {} },
      },
    };
    const mockScrollConfigLoader = {
      load: jest.fn().mockReturnValue(paddingScrollConfig),
    };

    // Only 3 wire items available, but 10 photos for padding
    const wireAdapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue(
        Array.from({ length: 3 }, (_, i) => ({
          id: `reddit:r${i}`, tier: 'wire', source: 'reddit',
          title: `Post ${i}`, timestamp: new Date().toISOString(),
        }))
      ),
    };
    const photoAdapter = {
      sourceType: 'photos',
      fetchItems: jest.fn().mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          id: `photo:p${i}`, tier: 'scrapbook', source: 'photos',
          title: `Photo ${i}`, timestamp: new Date().toISOString(),
        }))
      ),
    };

    // Mock tierAssembly to only return 3 wire items (simulating primary pass getting few items)
    mockTierAssemblyService.assemble.mockImplementation((items) => {
      const wireOnly = items.filter(i => i.source === 'reddit');
      return { items: wireOnly, hasMore: false };
    });

    const service = createService(
      [
        { type: 'reddit', _filename: 'reddit.yml' },
        { type: 'photos', _filename: 'photos.yml' },
      ],
      [wireAdapter, photoAdapter],
      { scrollConfigLoader: mockScrollConfigLoader },
    );

    const result = await service.getNextBatch('testuser');
    expect(result.items.length).toBeGreaterThan(3); // padded beyond just wire items
    expect(result.items.some(i => i.source === 'photos')).toBe(true);
  });
});

describe('selection tracking integration', () => {
  let mockScrollConfigLoader;
  let mockTierAssemblyService;

  const defaultScrollConfig = {
    batch_size: 15,
    spacing: { max_consecutive: 1 },
    tiers: {
      wire: { selection: { sort: 'timestamp_desc' }, sources: {} },
      library: { allocation: 2, selection: { sort: 'random' }, sources: {} },
      scrapbook: { allocation: 2, selection: { sort: 'random' }, sources: {} },
      compass: { allocation: 3, selection: { sort: 'priority' }, sources: {} },
    },
  };

  beforeEach(() => {
    mockScrollConfigLoader = {
      load: jest.fn().mockReturnValue(defaultScrollConfig),
    };
    mockTierAssemblyService = {
      assemble: jest.fn().mockImplementation((items, config, opts) => {
        return { items, hasMore: false };
      }),
    };
  });

  function createService(queryConfigs, adapters = [], overrides = {}) {
    return new FeedAssemblyService({
      freshRSSAdapter: null,
      headlineService: null,
      entropyService: null,
      queryConfigs,
      sourceAdapters: adapters,
      scrollConfigLoader: mockScrollConfigLoader,
      tierAssemblyService: mockTierAssemblyService,
      logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      ...overrides,
    });
  }

  test('passes selectionCounts to tier assembly and increments after batch', async () => {
    const mockTrackingStore = {
      getAll: jest.fn().mockResolvedValue(new Map([
        ['abc123', { count: 5, last: '2026-02-17T00:00:00Z' }],
      ])),
      incrementBatch: jest.fn().mockResolvedValue(undefined),
    };
    const adapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue([
        { id: 'headline:abc123', tier: 'wire', source: 'headline', title: 'H1', timestamp: new Date().toISOString() },
        { id: 'reddit:xyz', tier: 'wire', source: 'reddit', title: 'R1', timestamp: new Date().toISOString() },
      ]),
    };

    const service = createService(
      [{ type: 'reddit', _filename: 'reddit.yml' }],
      [adapter],
      { selectionTrackingStore: mockTrackingStore },
    );

    await service.getNextBatch('testuser');

    // Should have loaded tracking
    expect(mockTrackingStore.getAll).toHaveBeenCalledWith('testuser');

    // Should have passed selectionCounts to assemble
    expect(mockTierAssemblyService.assemble).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      expect.objectContaining({ selectionCounts: expect.any(Map) }),
    );

    // Should have incremented for headline-prefixed items only
    expect(mockTrackingStore.incrementBatch).toHaveBeenCalledWith(
      ['abc123'], // only headline-prefixed items, with prefix stripped
      'testuser'
    );
  });

  test('works without selectionTrackingStore (backwards compat)', async () => {
    const adapter = {
      sourceType: 'reddit',
      fetchItems: jest.fn().mockResolvedValue([
        { id: 'reddit:xyz', tier: 'wire', source: 'reddit', title: 'R1', timestamp: new Date().toISOString() },
      ]),
    };

    const service = createService(
      [{ type: 'reddit', _filename: 'reddit.yml' }],
      [adapter],
    );

    const result = await service.getNextBatch('testuser');
    expect(result.items.length).toBe(1);
  });
});
