// tests/unit/content/services/QueueService.test.mjs
import { jest } from '@jest/globals';
import { QueueService } from '../../../../backend/src/1_domains/content/services/QueueService.mjs';
import { PlayableItem } from '../../../../backend/src/1_domains/content/capabilities/Playable.mjs';
import { WatchState } from '../../../../backend/src/1_domains/content/entities/WatchState.mjs';

describe('QueueService', () => {
  let service;
  let mockWatchStore;

  const createPlayable = (id, title) => new PlayableItem({
    id: `test:${id}`,
    source: 'test',
    title,
    mediaType: 'video',
    mediaUrl: `/stream/${id}`,
    resumable: true
  });

  beforeEach(() => {
    mockWatchStore = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      getAll: jest.fn().mockResolvedValue([]),
      clear: jest.fn().mockResolvedValue(undefined)
    };
    service = new QueueService({ watchStore: mockWatchStore });
  });

  describe('getNextPlayable', () => {
    test('returns first unwatched item', async () => {
      const items = [
        createPlayable('1', 'Episode 1'),
        createPlayable('2', 'Episode 2'),
        createPlayable('3', 'Episode 3')
      ];

      const next = await service.getNextPlayable(items, 'test');
      expect(next.id).toBe('test:1');
    });

    test('returns in-progress item over unwatched', async () => {
      const items = [
        createPlayable('1', 'Episode 1'),
        createPlayable('2', 'Episode 2')
      ];

      mockWatchStore.get.mockImplementation(async (id) => {
        if (id === 'test:2') {
          return new WatchState({ itemId: 'test:2', playhead: 1800, duration: 3600 });
        }
        return null;
      });

      const next = await service.getNextPlayable(items, 'test');
      expect(next.id).toBe('test:2');
    });

    test('skips watched items', async () => {
      const items = [
        createPlayable('1', 'Episode 1'),
        createPlayable('2', 'Episode 2')
      ];

      mockWatchStore.get.mockImplementation(async (id) => {
        if (id === 'test:1') {
          return new WatchState({ itemId: 'test:1', playhead: 3500, duration: 3600 }); // 97% watched
        }
        return null;
      });

      const next = await service.getNextPlayable(items, 'test');
      expect(next.id).toBe('test:2');
    });

    test('returns null when all items watched', async () => {
      const items = [createPlayable('1', 'Episode 1')];

      mockWatchStore.get.mockResolvedValue(
        new WatchState({ itemId: 'test:1', playhead: 3500, duration: 3600 })
      );

      const next = await service.getNextPlayable(items, 'test');
      expect(next).toBeNull();
    });

    test('returns null for empty items array', async () => {
      const next = await service.getNextPlayable([], 'test');
      expect(next).toBeNull();
    });

    test('includes resume position for in-progress items', async () => {
      const items = [createPlayable('1', 'Episode 1')];

      mockWatchStore.get.mockResolvedValue(
        new WatchState({ itemId: 'test:1', playhead: 1800, duration: 3600 })
      );

      const next = await service.getNextPlayable(items, 'test');
      expect(next.resumePosition).toBe(1800);
    });
  });

  describe('getAllPlayables', () => {
    test('returns all items in order', async () => {
      const items = [
        createPlayable('1', 'Episode 1'),
        createPlayable('2', 'Episode 2')
      ];

      const all = await service.getAllPlayables(items);
      expect(all.length).toBe(2);
      expect(all[0].id).toBe('test:1');
      expect(all[1].id).toBe('test:2');
    });

    test('returns empty array for empty input', async () => {
      const all = await service.getAllPlayables([]);
      expect(all.length).toBe(0);
    });
  });
});
