// tests/isolated/adapter/feed/ImmichFeedAdapter.test.mjs
import { jest } from '@jest/globals';
import { ImmichFeedAdapter } from '#adapters/feed/sources/ImmichFeedAdapter.mjs';

describe('ImmichFeedAdapter', () => {
  const logger = { warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchItems image dimensions', () => {
    test('includes imageWidth and imageHeight in meta when viewable has dimensions', async () => {
      const mockContentQueryService = {
        search: jest.fn().mockResolvedValue({
          items: [
            { id: 'immich:asset1', localId: 'asset1', metadata: {} },
          ],
        }),
      };

      const mockImmichContent = {
        getViewable: jest.fn().mockResolvedValue({
          width: 4032,
          height: 3024,
          metadata: {
            capturedAt: '2025-06-15T10:30:00.000Z',
            exif: { city: 'Seattle' },
            people: [],
          },
        }),
        search: jest.fn(),
        getRandomMemories: jest.fn(),
      };

      const contentRegistry = new Map();
      contentRegistry.set('immich', mockImmichContent);

      const adapter = new ImmichFeedAdapter({
        contentQueryPort: mockContentQueryService,
        contentRegistry,
        logger,
      });

      const items = await adapter.fetchItems(
        { type: 'immich', tier: 'scrapbook', limit: 1 },
        'testuser',
      );

      expect(items).toHaveLength(1);
      expect(items[0].meta.imageWidth).toBe(4032);
      expect(items[0].meta.imageHeight).toBe(3024);
    });

    test('does not include imageWidth/imageHeight when viewable lacks dimensions', async () => {
      const mockContentQueryService = {
        search: jest.fn().mockResolvedValue({
          items: [
            { id: 'immich:asset2', localId: 'asset2', metadata: {} },
          ],
        }),
      };

      const mockImmichContent = {
        getViewable: jest.fn().mockResolvedValue({
          metadata: {
            capturedAt: '2025-06-15T10:30:00.000Z',
            exif: { city: 'Portland' },
            people: [],
          },
        }),
        search: jest.fn(),
        getRandomMemories: jest.fn(),
      };

      const contentRegistry = new Map();
      contentRegistry.set('immich', mockImmichContent);

      const adapter = new ImmichFeedAdapter({
        contentQueryPort: mockContentQueryService,
        contentRegistry,
        logger,
      });

      const items = await adapter.fetchItems(
        { type: 'immich', tier: 'scrapbook', limit: 1 },
        'testuser',
      );

      expect(items).toHaveLength(1);
      expect(items[0].meta.imageWidth).toBeUndefined();
      expect(items[0].meta.imageHeight).toBeUndefined();
    });
  });

  describe('fetchItems title with face tags', () => {
    test('title shows people and location when both available', async () => {
      const mockContentQueryService = {
        search: jest.fn().mockResolvedValue({
          items: [{ id: 'immich:a1', localId: 'a1', metadata: {} }],
        }),
      };

      const mockImmichContent = {
        getViewable: jest.fn().mockResolvedValue({
          metadata: {
            capturedAt: '2025-06-15T10:30:00.000Z',
            exif: { city: 'New York City' },
            people: ['Bob', 'Bill', 'Biff'],
          },
        }),
        search: jest.fn(),
        getRandomMemories: jest.fn(),
      };

      const contentRegistry = new Map();
      contentRegistry.set('immich', mockImmichContent);

      const adapter = new ImmichFeedAdapter({
        contentQueryPort: mockContentQueryService,
        contentRegistry,
        logger,
      });

      const items = await adapter.fetchItems(
        { type: 'immich', tier: 'scrapbook', limit: 1 },
        'testuser',
      );

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Bob, Bill, and Biff \u2022 New York City');
      expect(items[0].subtitle).toMatch(/Sun 15 Jun, 2025/);
      expect(items[0].meta.people).toEqual(['Bob', 'Bill', 'Biff']);
    });

    test('title shows only people when no location', async () => {
      const mockContentQueryService = {
        search: jest.fn().mockResolvedValue({
          items: [{ id: 'immich:a2', localId: 'a2', metadata: {} }],
        }),
      };

      const mockImmichContent = {
        getViewable: jest.fn().mockResolvedValue({
          metadata: {
            capturedAt: '2025-06-15T10:30:00.000Z',
            exif: {},
            people: ['Alice', 'Bob'],
          },
        }),
        search: jest.fn(),
        getRandomMemories: jest.fn(),
      };

      const contentRegistry = new Map();
      contentRegistry.set('immich', mockImmichContent);

      const adapter = new ImmichFeedAdapter({
        contentQueryPort: mockContentQueryService,
        contentRegistry,
        logger,
      });

      const items = await adapter.fetchItems(
        { type: 'immich', tier: 'scrapbook', limit: 1 },
        'testuser',
      );

      expect(items[0].title).toBe('Alice and Bob');
    });

    test('title shows time-of-day in location when no people', async () => {
      const mockContentQueryService = {
        search: jest.fn().mockResolvedValue({
          items: [{ id: 'immich:a3', localId: 'a3', metadata: {} }],
        }),
      };

      const mockImmichContent = {
        getViewable: jest.fn().mockResolvedValue({
          metadata: {
            capturedAt: '2025-06-15T17:30:00.000Z',
            exif: { city: 'Seattle' },
            people: [],
          },
        }),
        search: jest.fn(),
        getRandomMemories: jest.fn(),
      };

      const contentRegistry = new Map();
      contentRegistry.set('immich', mockImmichContent);

      const adapter = new ImmichFeedAdapter({
        contentQueryPort: mockContentQueryService,
        contentRegistry,
        logger,
      });

      const items = await adapter.fetchItems(
        { type: 'immich', tier: 'scrapbook', limit: 1 },
        'testuser',
      );

      // 17:30 UTC — period depends on local TZ but format is "{Period} in Seattle"
      expect(items[0].title).toMatch(/^.+ in Seattle$/);
    });

    test('title uses day and time of day when no people or location', async () => {
      const mockContentQueryService = {
        search: jest.fn().mockResolvedValue({
          items: [{ id: 'immich:a4', localId: 'a4', metadata: {} }],
        }),
      };

      const mockImmichContent = {
        getViewable: jest.fn().mockResolvedValue({
          metadata: {
            capturedAt: '2025-06-15T10:30:00.000Z',
            exif: {},
            people: [],
          },
        }),
        search: jest.fn(),
        getRandomMemories: jest.fn(),
      };

      const contentRegistry = new Map();
      contentRegistry.set('immich', mockImmichContent);

      const adapter = new ImmichFeedAdapter({
        contentQueryPort: mockContentQueryService,
        contentRegistry,
        logger,
      });

      const items = await adapter.fetchItems(
        { type: 'immich', tier: 'scrapbook', limit: 1 },
        'testuser',
      );

      // 2025-06-15 10:30 UTC — day/period depends on local TZ, but format is "Dayname Period"
      expect(items[0].title).toMatch(/^(Sunday|Saturday|Monday) (Late Night|Morning|Mid-Morning|Lunchtime|Afternoon|Evening|Night)$/);
    });

    test('title falls back to Memory when no people, location, or date', async () => {
      const mockContentQueryService = {
        search: jest.fn().mockResolvedValue({
          items: [{ id: 'immich:a6', localId: 'a6', metadata: {} }],
        }),
      };

      const mockImmichContent = {
        getViewable: jest.fn().mockResolvedValue({
          metadata: {
            exif: {},
            people: [],
          },
        }),
        search: jest.fn(),
        getRandomMemories: jest.fn(),
      };

      const contentRegistry = new Map();
      contentRegistry.set('immich', mockImmichContent);

      const adapter = new ImmichFeedAdapter({
        contentQueryPort: mockContentQueryService,
        contentRegistry,
        logger,
      });

      const items = await adapter.fetchItems(
        { type: 'immich', tier: 'scrapbook', limit: 1 },
        'testuser',
      );

      expect(items[0].title).toBe('Memory');
    });

    test('single person shows just name without commas', async () => {
      const mockContentQueryService = {
        search: jest.fn().mockResolvedValue({
          items: [{ id: 'immich:a5', localId: 'a5', metadata: {} }],
        }),
      };

      const mockImmichContent = {
        getViewable: jest.fn().mockResolvedValue({
          metadata: {
            capturedAt: '2025-06-15T10:30:00.000Z',
            exif: { city: 'Portland' },
            people: ['Alice'],
          },
        }),
        search: jest.fn(),
        getRandomMemories: jest.fn(),
      };

      const contentRegistry = new Map();
      contentRegistry.set('immich', mockImmichContent);

      const adapter = new ImmichFeedAdapter({
        contentQueryPort: mockContentQueryService,
        contentRegistry,
        logger,
      });

      const items = await adapter.fetchItems(
        { type: 'immich', tier: 'scrapbook', limit: 1 },
        'testuser',
      );

      expect(items[0].title).toBe('Alice \u2022 Portland');
    });
  });
});
