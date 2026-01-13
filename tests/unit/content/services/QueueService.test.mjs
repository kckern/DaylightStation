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

  describe('sortByPriority', () => {
    test('orders in_progress items first', () => {
      const items = [
        { id: '1', title: 'Unwatched', percent: 0, priority: 'medium' },
        { id: '2', title: 'In Progress', percent: 45, priority: 'in_progress' },
        { id: '3', title: 'Also Unwatched', percent: 0, priority: 'medium' }
      ];
      const sorted = QueueService.sortByPriority(items);
      expect(sorted[0].id).toBe('2');
    });

    test('orders urgent items after in_progress', () => {
      const items = [
        { id: '1', title: 'Normal', percent: 0, priority: 'medium' },
        { id: '2', title: 'Urgent', percent: 0, priority: 'urgent' },
        { id: '3', title: 'In Progress', percent: 50, priority: 'in_progress' }
      ];
      const sorted = QueueService.sortByPriority(items);
      expect(sorted[0].id).toBe('3'); // in_progress first
      expect(sorted[1].id).toBe('2'); // urgent second
    });

    test('sorts in_progress items by percent descending', () => {
      const items = [
        { id: '1', title: 'Low Progress', percent: 20, priority: 'in_progress' },
        { id: '2', title: 'High Progress', percent: 80, priority: 'in_progress' },
        { id: '3', title: 'Mid Progress', percent: 50, priority: 'in_progress' }
      ];
      const sorted = QueueService.sortByPriority(items);
      expect(sorted[0].id).toBe('2'); // 80%
      expect(sorted[1].id).toBe('3'); // 50%
      expect(sorted[2].id).toBe('1'); // 20%
    });

    test('preserves original order for same priority items', () => {
      const items = [
        { id: '1', title: 'First', percent: 0, priority: 'medium' },
        { id: '2', title: 'Second', percent: 0, priority: 'medium' },
        { id: '3', title: 'Third', percent: 0, priority: 'medium' }
      ];
      const sorted = QueueService.sortByPriority(items);
      expect(sorted.map(i => i.id)).toEqual(['1', '2', '3']);
    });

    test('handles full priority ordering', () => {
      const items = [
        { id: '1', title: 'Low', percent: 0, priority: 'low' },
        { id: '2', title: 'High', percent: 0, priority: 'high' },
        { id: '3', title: 'Urgent', percent: 0, priority: 'urgent' },
        { id: '4', title: 'Medium', percent: 0, priority: 'medium' },
        { id: '5', title: 'In Progress', percent: 30, priority: 'in_progress' }
      ];
      const sorted = QueueService.sortByPriority(items);
      expect(sorted.map(i => i.id)).toEqual(['5', '3', '2', '4', '1']);
    });

    test('treats items without priority as medium', () => {
      const items = [
        { id: '1', title: 'No Priority', percent: 0 },
        { id: '2', title: 'Urgent', percent: 0, priority: 'urgent' },
        { id: '3', title: 'Low', percent: 0, priority: 'low' }
      ];
      const sorted = QueueService.sortByPriority(items);
      expect(sorted[0].id).toBe('2'); // urgent
      expect(sorted[1].id).toBe('1'); // no priority (treated as medium)
      expect(sorted[2].id).toBe('3'); // low
    });
  });

  describe('skip_after filtering', () => {
    test('should skip items past their skip_after date', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Current', skip_after: '2026-12-31' },
        { id: '2', title: 'Expired', skip_after: '2025-01-01' },
        { id: '3', title: 'No Deadline', skip_after: null }
      ];
      const filtered = QueueService.filterBySkipAfter(items, now);
      expect(filtered.map(i => i.id)).toEqual(['1', '3']);
    });

    test('should mark items as urgent if skip_after within 8 days', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Urgent', skip_after: '2026-01-20', priority: 'medium' }, // 7 days
        { id: '2', title: 'Not Urgent', skip_after: '2026-01-25', priority: 'medium' } // 12 days
      ];
      const enriched = QueueService.applyUrgency(items, now);
      expect(enriched[0].priority).toBe('urgent');
      expect(enriched[1].priority).toBe('medium');
    });

    test('should not upgrade in_progress to urgent', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'In Progress', skip_after: '2026-01-15', priority: 'in_progress' }
      ];
      const enriched = QueueService.applyUrgency(items, now);
      expect(enriched[0].priority).toBe('in_progress'); // stays in_progress
    });

    test('should handle items without skip_after date', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'No Deadline', priority: 'medium' }
      ];
      const enriched = QueueService.applyUrgency(items, now);
      expect(enriched[0].priority).toBe('medium'); // unchanged
    });
  });

  describe('wait_until filtering', () => {
    test('should skip items with wait_until more than 2 days in future', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Available Now', wait_until: '2026-01-12' },
        { id: '2', title: 'Soon Available', wait_until: '2026-01-15' }, // 2 days
        { id: '3', title: 'Not Yet', wait_until: '2026-01-20' }, // 7 days
        { id: '4', title: 'No Wait', wait_until: null }
      ];
      const filtered = QueueService.filterByWaitUntil(items, now);
      expect(filtered.map(i => i.id)).toEqual(['1', '2', '4']);
    });

    test('should include items with wait_until exactly 2 days ahead', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Boundary', wait_until: '2026-01-15' } // exactly 2 days
      ];
      const filtered = QueueService.filterByWaitUntil(items, now);
      expect(filtered.length).toBe(1);
    });

    test('should include items with past wait_until dates', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Past', wait_until: '2026-01-01' }
      ];
      const filtered = QueueService.filterByWaitUntil(items, now);
      expect(filtered.length).toBe(1);
    });
  });

  describe('hold and watched filtering', () => {
    test('should skip items on hold', () => {
      const items = [
        { id: '1', title: 'Active', hold: false },
        { id: '2', title: 'On Hold', hold: true },
        { id: '3', title: 'No Hold Field' }
      ];
      const filtered = QueueService.filterByHold(items);
      expect(filtered.map(i => i.id)).toEqual(['1', '3']);
    });

    test('should skip items marked as watched', () => {
      const items = [
        { id: '1', title: 'Unwatched', watched: false, percent: 0 },
        { id: '2', title: 'Watched Flag', watched: true, percent: 50 },
        { id: '3', title: 'Watched by Percent', watched: false, percent: 95 },
        { id: '4', title: 'In Progress', watched: false, percent: 50 }
      ];
      const filtered = QueueService.filterByWatched(items);
      expect(filtered.map(i => i.id)).toEqual(['1', '4']);
    });

    test('should use 90% threshold for watched detection', () => {
      const items = [
        { id: '1', percent: 89 },
        { id: '2', percent: 90 },
        { id: '3', percent: 91 }
      ];
      const filtered = QueueService.filterByWatched(items);
      expect(filtered.map(i => i.id)).toEqual(['1']);
    });

    test('should keep items without percent field', () => {
      const items = [
        { id: '1', title: 'No Percent' }
      ];
      const filtered = QueueService.filterByWatched(items);
      expect(filtered.length).toBe(1);
    });
  });
});
