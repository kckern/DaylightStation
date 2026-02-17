// tests/isolated/application/feed/HeadlineService.test.mjs
import { jest } from '@jest/globals';
import { HeadlineService } from '#apps/feed/services/HeadlineService.mjs';

describe('HeadlineService', () => {
  let service;
  let mockStore;
  let mockHarvester;
  let mockDataService;

  const userConfig = {
    headline_pages: [
      {
        id: 'main',
        label: 'Main',
        grid: '1fr 1fr',
        sources: [
          { id: 'cnn', label: 'CNN', url: 'http://rss.cnn.com/rss/cnn_topstories.rss', row: 1, col: 1 },
          { id: 'abc', label: 'ABC News', url: 'https://abcnews.go.com/abcnews/topstories', row: 1, col: 2 },
        ],
      },
    ],
    headlines: { retention_hours: 48, max_per_source: 12 },
  };

  beforeEach(() => {
    mockStore = {
      loadSource: jest.fn().mockResolvedValue(null),
      saveSource: jest.fn().mockResolvedValue(true),
      loadAllSources: jest.fn().mockResolvedValue({}),
      pruneOlderThan: jest.fn().mockResolvedValue(0),
    };
    mockHarvester = {
      harvest: jest.fn().mockResolvedValue({
        source: 'cnn',
        label: 'CNN',
        lastHarvest: new Date().toISOString(),
        items: Array.from({ length: 15 }, (_, i) => ({
          title: `Test ${i}`,
          link: `https://cnn.com/${i}`,
          timestamp: new Date().toISOString(),
        })),
      }),
    };
    mockDataService = {
      user: {
        read: jest.fn().mockReturnValue(userConfig),
      },
    };
    service = new HeadlineService({
      headlineStore: mockStore,
      harvester: mockHarvester,
      dataService: mockDataService,
    });
  });

  describe('harvestAll', () => {
    test('harvests all configured sources', async () => {
      const result = await service.harvestAll('kckern');

      expect(mockHarvester.harvest).toHaveBeenCalledTimes(2);
      expect(mockStore.saveSource).toHaveBeenCalledTimes(2);
      expect(result.harvested).toBe(2);
    });

    test('prunes old items after harvest', async () => {
      await service.harvestAll('kckern');
      expect(mockStore.pruneOlderThan).toHaveBeenCalledTimes(2);
    });

    test('continues on individual source failure', async () => {
      mockHarvester.harvest
        .mockResolvedValueOnce({ source: 'cnn', label: 'CNN', lastHarvest: new Date().toISOString(), items: [], error: 'fail' })
        .mockResolvedValueOnce({ source: 'abc', label: 'ABC', lastHarvest: new Date().toISOString(), items: [{ title: 'X', timestamp: new Date().toISOString() }] });

      const result = await service.harvestAll('kckern');
      expect(result.harvested).toBe(2);
      expect(result.errors).toBe(1);
    });
  });

  describe('getAllHeadlines', () => {
    test('returns all sources from store', async () => {
      mockStore.loadAllSources.mockResolvedValue({
        cnn: { source: 'cnn', label: 'CNN', items: [{ title: 'A' }] },
        abc: { source: 'abc', label: 'ABC News', items: [{ title: 'B' }] },
      });

      const result = await service.getAllHeadlines('kckern', 'main');
      expect(result.sources).toHaveProperty('cnn');
      expect(result.sources).toHaveProperty('abc');
    });
  });

  describe('getSourceHeadlines', () => {
    test('returns single source from store', async () => {
      mockStore.loadSource.mockResolvedValue({
        source: 'cnn',
        label: 'CNN',
        items: [{ title: 'A' }],
      });

      const result = await service.getSourceHeadlines('cnn', 'kckern');
      expect(result.source).toBe('cnn');
      expect(result.items).toHaveLength(1);
    });

    test('returns null for unknown source', async () => {
      mockStore.loadSource.mockResolvedValue(null);
      const result = await service.getSourceHeadlines('unknown', 'kckern');
      expect(result).toBeNull();
    });
  });

  describe('og:image enrichment', () => {
    let mockWebContentGateway;
    let singleSourceConfig;

    beforeEach(() => {
      mockWebContentGateway = {
        extractReadableContent: jest.fn().mockResolvedValue({
          title: 'Article Title',
          content: 'body text',
          wordCount: 2,
          ogImage: 'https://example.com/hero.jpg',
          ogDescription: 'desc',
        }),
      };

      // Use a single-source config so assertions are clear
      singleSourceConfig = {
        headline_pages: [
          {
            id: 'main',
            label: 'Main',
            sources: [
              { id: 'src1', label: 'Source One', url: 'http://example.com/feed.rss', row: 1, col: 1 },
            ],
          },
        ],
        headlines: { retention_hours: 48, max_per_source: 12 },
      };
    });

    function buildServiceWithAdapter(feedConfig) {
      const ds = { user: { read: jest.fn().mockReturnValue(feedConfig || singleSourceConfig) } };
      return new HeadlineService({
        headlineStore: mockStore,
        harvester: mockHarvester,
        dataService: ds,
        webContentGateway: mockWebContentGateway,
      });
    }

    test('enriches items missing image with og:image after harvest', async () => {
      const svc = buildServiceWithAdapter();
      const now = new Date().toISOString();

      mockHarvester.harvest.mockResolvedValue({
        source: 'src1',
        label: 'Source One',
        lastHarvest: now,
        items: [
          { id: 'item-1', title: 'No image article', link: 'https://example.com/article1', timestamp: now },
          { id: 'item-2', title: 'Has image', link: 'https://example.com/article2', image: 'https://example.com/existing.jpg', timestamp: now },
        ],
      });

      // No existing cache
      mockStore.loadSource.mockResolvedValue(null);

      await svc.harvestAll('kckern');

      // Should only fetch og:image for item-1 (item-2 already has an image)
      expect(mockWebContentGateway.extractReadableContent).toHaveBeenCalledTimes(1);
      expect(mockWebContentGateway.extractReadableContent).toHaveBeenCalledWith('https://example.com/article1');

      // Verify save was called with enriched item
      const savedResult = mockStore.saveSource.mock.calls[0][1];
      expect(savedResult.items[0].image).toBe('https://example.com/hero.jpg');
      expect(savedResult.items[1].image).toBe('https://example.com/existing.jpg');
    });

    test('skips enrichment for items already in cache', async () => {
      const svc = buildServiceWithAdapter();
      const now = new Date().toISOString();

      mockHarvester.harvest.mockResolvedValue({
        source: 'src1',
        label: 'Source One',
        lastHarvest: now,
        items: [
          { id: 'existing-1', title: 'Old article', link: 'https://example.com/old', timestamp: now },
          { id: 'new-1', title: 'New article', link: 'https://example.com/new', timestamp: now },
        ],
      });

      // existing-1 is already in cache
      mockStore.loadSource.mockResolvedValue({
        items: [{ id: 'existing-1', title: 'Old article', link: 'https://example.com/old' }],
      });

      await svc.harvestAll('kckern');

      // Should only enrich new-1 (existing-1 already in cache, so skipped)
      expect(mockWebContentGateway.extractReadableContent).toHaveBeenCalledTimes(1);
      expect(mockWebContentGateway.extractReadableContent).toHaveBeenCalledWith('https://example.com/new');
    });

    test('leaves image undefined when og:image fetch fails', async () => {
      mockWebContentGateway.extractReadableContent.mockRejectedValue(new Error('Network error'));

      const svc = buildServiceWithAdapter();
      const now = new Date().toISOString();

      mockHarvester.harvest.mockResolvedValue({
        source: 'src1',
        label: 'Source One',
        lastHarvest: now,
        items: [
          { id: 'item-1', title: 'Failing article', link: 'https://example.com/fail', timestamp: now },
        ],
      });

      mockStore.loadSource.mockResolvedValue(null);

      await svc.harvestAll('kckern');

      const savedResult = mockStore.saveSource.mock.calls[0][1];
      expect(savedResult.items[0].image).toBeUndefined();
    });

    test('leaves image undefined when og:image is absent from page', async () => {
      mockWebContentGateway.extractReadableContent.mockResolvedValue({
        title: 'Article',
        content: 'body',
        wordCount: 1,
        ogImage: null,
        ogDescription: null,
      });

      const svc = buildServiceWithAdapter();
      const now = new Date().toISOString();

      mockHarvester.harvest.mockResolvedValue({
        source: 'src1',
        label: 'Source One',
        lastHarvest: now,
        items: [
          { id: 'item-1', title: 'No og:image', link: 'https://example.com/noog', timestamp: now },
        ],
      });

      mockStore.loadSource.mockResolvedValue(null);

      await svc.harvestAll('kckern');

      const savedResult = mockStore.saveSource.mock.calls[0][1];
      expect(savedResult.items[0].image).toBeUndefined();
    });

    test('rejects generic placeholder og:image (Google News icon)', async () => {
      mockWebContentGateway.extractReadableContent.mockResolvedValue({
        title: 'Article',
        content: 'body',
        wordCount: 1,
        ogImage: 'https://lh3.googleusercontent.com/J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc=s0-w300',
        ogDescription: 'desc',
      });

      const svc = buildServiceWithAdapter();
      const now = new Date().toISOString();

      mockHarvester.harvest.mockResolvedValue({
        source: 'src1',
        label: 'Source One',
        lastHarvest: now,
        items: [
          { id: 'item-1', title: 'Google News article', link: 'https://example.com/article', timestamp: now },
        ],
      });

      mockStore.loadSource.mockResolvedValue(null);

      await svc.harvestAll('kckern');

      const savedResult = mockStore.saveSource.mock.calls[0][1];
      expect(savedResult.items[0].image).toBeUndefined();
    });

    test('rejects generic placeholder og:image (exact URL match)', async () => {
      mockWebContentGateway.extractReadableContent.mockResolvedValue({
        title: 'Article',
        content: 'body',
        wordCount: 1,
        ogImage: 'https://s.abcnews.com/images/US/abc_news_default_2000x2000_update_4x3t_384.jpg',
        ogDescription: 'desc',
      });

      const svc = buildServiceWithAdapter();
      const now = new Date().toISOString();

      mockHarvester.harvest.mockResolvedValue({
        source: 'src1',
        label: 'Source One',
        lastHarvest: now,
        items: [
          { id: 'item-1', title: 'ABC article', link: 'https://example.com/abc', timestamp: now },
        ],
      });

      mockStore.loadSource.mockResolvedValue(null);

      await svc.harvestAll('kckern');

      const savedResult = mockStore.saveSource.mock.calls[0][1];
      expect(savedResult.items[0].image).toBeUndefined();
    });

    test('strips generic placeholder images from RSS harvest results', async () => {
      // No webContentGateway — use the default service (no enrichment)
      const ds = { user: { read: jest.fn().mockReturnValue(singleSourceConfig) } };
      const svc = new HeadlineService({
        headlineStore: mockStore,
        harvester: mockHarvester,
        dataService: ds,
      });
      const now = new Date().toISOString();

      mockHarvester.harvest.mockResolvedValue({
        source: 'src1',
        label: 'Source One',
        lastHarvest: now,
        items: [
          { id: 'item-1', title: 'Has generic image', link: 'https://example.com/a1', image: 'https://lh3.googleusercontent.com/ABC123=s0-w300', imageWidth: 300, imageHeight: 200, timestamp: now },
          { id: 'item-2', title: 'Has legit image', link: 'https://example.com/a2', image: 'https://cdn.example.com/photo.jpg', timestamp: now },
        ],
      });

      mockStore.loadSource.mockResolvedValue(null);

      await svc.harvestAll('kckern');

      const savedResult = mockStore.saveSource.mock.calls[0][1];
      // Generic image should be stripped
      expect(savedResult.items[0].image).toBeUndefined();
      expect(savedResult.items[0].imageWidth).toBeUndefined();
      expect(savedResult.items[0].imageHeight).toBeUndefined();
      // Legit image should remain
      expect(savedResult.items[1].image).toBe('https://cdn.example.com/photo.jpg');
    });

    test('works without webContentGateway (backward compat)', async () => {
      // Default service has no webContentGateway
      const now = new Date().toISOString();
      mockHarvester.harvest.mockResolvedValue({
        source: 'cnn',
        label: 'CNN',
        lastHarvest: now,
        items: [
          { id: 'item-1', title: 'Article', link: 'https://cnn.com/1', timestamp: now },
        ],
      });

      mockStore.loadSource.mockResolvedValue(null);

      // Should not throw — no webContentGateway means enrichment is skipped
      const result = await service.harvestAll('kckern');
      expect(result.harvested).toBe(2);

      // saveSource should still be called
      expect(mockStore.saveSource).toHaveBeenCalled();
    });
  });
});
