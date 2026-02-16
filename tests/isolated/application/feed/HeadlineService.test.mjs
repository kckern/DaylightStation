// tests/isolated/application/feed/HeadlineService.test.mjs
import { jest } from '@jest/globals';
import { HeadlineService } from '#apps/feed/services/HeadlineService.mjs';

describe('HeadlineService', () => {
  let service;
  let mockStore;
  let mockHarvester;
  let mockConfigService;
  let mockDataService;

  const userConfig = {
    headline_sources: [
      { id: 'cnn', label: 'CNN', url: 'http://rss.cnn.com/rss/cnn_topstories.rss' },
      { id: 'abc', label: 'ABC News', url: 'https://abcnews.go.com/abcnews/topstories' },
    ],
    freshrss_headline_feeds: [],
    headlines: { retention_hours: 48 },
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
        items: [{ title: 'Test', link: 'https://cnn.com/1', timestamp: new Date().toISOString() }],
      }),
    };
    mockDataService = {
      user: {
        read: jest.fn().mockReturnValue(userConfig),
      },
    };
    mockConfigService = {
      getHeadOfHousehold: jest.fn().mockReturnValue('kckern'),
    };
    service = new HeadlineService({
      headlineStore: mockStore,
      harvester: mockHarvester,
      dataService: mockDataService,
      configService: mockConfigService,
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
        .mockResolvedValueOnce({ source: 'abc', label: 'ABC', lastHarvest: new Date().toISOString(), items: [{ title: 'X' }] });

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

      const result = await service.getAllHeadlines('kckern');
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
});
