// tests/isolated/application/feed/FeedAssemblyService.test.mjs
import { jest } from '@jest/globals';
import { FeedAssemblyService } from '#apps/feed/services/FeedAssemblyService.mjs';

describe('FeedAssemblyService scroll config integration', () => {
  let mockScrollConfigLoader;
  let mockSpacingEnforcer;

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
    mockSpacingEnforcer = {
      enforce: jest.fn().mockImplementation((items) => items),
    };
  });

  function createService(queryConfigs, adapters = []) {
    return new FeedAssemblyService({
      freshRSSAdapter: null,
      headlineService: null,
      entropyService: null,
      queryConfigs,
      sourceAdapters: adapters,
      scrollConfigLoader: mockScrollConfigLoader,
      spacingEnforcer: mockSpacingEnforcer,
      logger: { info: jest.fn(), warn: jest.fn() },
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
      sources: { reddit: { max_per_batch: 5 } },
      // health NOT listed => should be skipped
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
    expect(mockSpacingEnforcer.enforce).toHaveBeenCalled();
  });

  test('passes items through SpacingEnforcer', async () => {
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
    expect(mockSpacingEnforcer.enforce).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ spacing: { max_consecutive: 1 } }),
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
    const sources = result.items.map(i => i.source);
    // Should have reddit and weather (grounding), but NOT headlines
    expect(sources).not.toContain('headline');
    // Reddit should be present (it's the focused external source)
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
    const redditItems = result.items.filter(i => i.source === 'reddit');
    expect(redditItems.length).toBeGreaterThan(0);
    for (const item of redditItems) {
      expect(item.meta?.subreddit).toBe('science');
    }
  });
});
