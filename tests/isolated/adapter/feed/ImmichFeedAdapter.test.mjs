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
});
