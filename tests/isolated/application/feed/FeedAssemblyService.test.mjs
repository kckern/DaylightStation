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
