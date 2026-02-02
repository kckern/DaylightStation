// tests/unit/content/services/QueueService.test.mjs
import { describe, it, test, expect, beforeEach, vi } from 'vitest';
import { QueueService } from '#domains/content/services/QueueService.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';

// Create a mock WatchState class for testing
class WatchState {
  constructor({ itemId, playhead = 0, duration = 0, playCount = 0, lastPlayed = null }) {
    this.itemId = itemId;
    this.playhead = playhead;
    this.duration = duration;
    this.playCount = playCount;
    this.lastPlayed = lastPlayed;
  }
  get percent() {
    return this.duration ? Math.round((this.playhead / this.duration) * 100) : 0;
  }
  isWatched() {
    return this.percent >= 90;
  }
  isInProgress() {
    return this.playhead > 0 && !this.isWatched();
  }
}

describe('QueueService', () => {
  let service;
  let mockMediaProgressMemory;

  const createPlayable = (id, title) => new PlayableItem({
    id: `test:${id}`,
    localId: id,
    source: 'test',
    title,
    mediaType: 'video',
    mediaUrl: `/stream/${id}`,
    resumable: true
  });

  beforeEach(() => {
    mockMediaProgressMemory = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue([]),
      clear: vi.fn().mockResolvedValue(undefined)
    };
    service = new QueueService({ mediaProgressMemory: mockMediaProgressMemory });
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

      mockMediaProgressMemory.get.mockImplementation(async (id) => {
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

      mockMediaProgressMemory.get.mockImplementation(async (id) => {
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

      mockMediaProgressMemory.get.mockResolvedValue(
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

      mockMediaProgressMemory.get.mockResolvedValue(
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

  describe('skipAfter filtering', () => {
    test('should skip items past their skipAfter date', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Current', skipAfter: '2026-12-31' },
        { id: '2', title: 'Expired', skipAfter: '2025-01-01' },
        { id: '3', title: 'No Deadline', skipAfter: null }
      ];
      const filtered = QueueService.filterBySkipAfter(items, now);
      expect(filtered.map(i => i.id)).toEqual(['1', '3']);
    });

    test('should mark items as urgent if skipAfter within 8 days', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Urgent', skipAfter: '2026-01-20', priority: 'medium' }, // 7 days
        { id: '2', title: 'Not Urgent', skipAfter: '2026-01-25', priority: 'medium' } // 12 days
      ];
      const enriched = QueueService.applyUrgency(items, now);
      expect(enriched[0].priority).toBe('urgent');
      expect(enriched[1].priority).toBe('medium');
    });

    test('should not upgrade in_progress to urgent', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'In Progress', skipAfter: '2026-01-15', priority: 'in_progress' }
      ];
      const enriched = QueueService.applyUrgency(items, now);
      expect(enriched[0].priority).toBe('in_progress'); // stays in_progress
    });

    test('should handle items without skipAfter date', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'No Deadline', priority: 'medium' }
      ];
      const enriched = QueueService.applyUrgency(items, now);
      expect(enriched[0].priority).toBe('medium'); // unchanged
    });
  });

  describe('waitUntil filtering', () => {
    test('should skip items with waitUntil more than 2 days in future', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Available Now', waitUntil: '2026-01-12' },
        { id: '2', title: 'Soon Available', waitUntil: '2026-01-15' }, // 2 days
        { id: '3', title: 'Not Yet', waitUntil: '2026-01-20' }, // 7 days
        { id: '4', title: 'No Wait', waitUntil: null }
      ];
      const filtered = QueueService.filterByWaitUntil(items, now);
      expect(filtered.map(i => i.id)).toEqual(['1', '2', '4']);
    });

    test('should include items with waitUntil exactly 2 days ahead', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Boundary', waitUntil: '2026-01-15' } // exactly 2 days
      ];
      const filtered = QueueService.filterByWaitUntil(items, now);
      expect(filtered.length).toBe(1);
    });

    test('should include items with past waitUntil dates', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Past', waitUntil: '2026-01-01' }
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

  describe('day-of-week filtering', () => {
    test('should filter by specific weekday', () => {
      // Note: Jan 13 2026 is a Tuesday (day 2 in ISO)
      // Use (year, monthIndex, day) format for local date
      const tuesday = new Date(2026, 0, 13);
      const items = [
        { id: '1', title: 'Monday Only', days: [1] },
        { id: '2', title: 'Tuesday Only', days: [2] },
        { id: '3', title: 'Any Day', days: null }
      ];
      const filtered = QueueService.filterByDayOfWeek(items, tuesday);
      expect(filtered.map(i => i.id)).toEqual(['2', '3']);
    });

    test('should handle Weekdays preset', () => {
      const friday = new Date(2026, 0, 16); // Friday, day 5
      const saturday = new Date(2026, 0, 17); // Saturday, day 6
      const items = [
        { id: '1', title: 'Weekdays', days: 'Weekdays' }
      ];
      expect(QueueService.filterByDayOfWeek(items, friday).length).toBe(1);
      expect(QueueService.filterByDayOfWeek(items, saturday).length).toBe(0);
    });

    test('should handle Weekend preset', () => {
      const friday = new Date(2026, 0, 16);
      const saturday = new Date(2026, 0, 17);
      const items = [
        { id: '1', title: 'Weekend', days: 'Weekend' }
      ];
      expect(QueueService.filterByDayOfWeek(items, friday).length).toBe(0);
      expect(QueueService.filterByDayOfWeek(items, saturday).length).toBe(1);
    });

    test('should handle M•W•F preset', () => {
      const wed = new Date(2026, 0, 14); // Wednesday, day 3
      const items = [
        { id: '1', title: 'MWF', days: 'M•W•F' }
      ];
      expect(QueueService.filterByDayOfWeek(items, wed).length).toBe(1);
    });

    test('should keep items without days field', () => {
      const items = [
        { id: '1', title: 'No Days' }
      ];
      const filtered = QueueService.filterByDayOfWeek(items, new Date());
      expect(filtered.length).toBe(1);
    });
  });

  describe('filter pipeline', () => {
    it('should apply all filters in order', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Good', percent: 0, hold: false },
        { id: '2', title: 'On Hold', percent: 0, hold: true },
        { id: '3', title: 'Watched', percent: 95, hold: false },
        { id: '4', title: 'Expired', percent: 0, hold: false, skipAfter: '2020-01-01' },
        { id: '5', title: 'In Progress', percent: 50, hold: false }
      ];
      const filtered = QueueService.applyFilters(items, { now });
      expect(filtered.map(i => i.id)).toEqual(['1', '5']);
    });

    it('should support fallback cascade when empty', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Watched', percent: 95, hold: false }
      ];
      // First pass returns empty because item is watched, fallback ignores watched status
      const filtered = QueueService.applyFilters(items, { allowFallback: true, now });
      expect(filtered.map(i => i.id)).toEqual(['1']);
    });

    it('should apply urgency before sorting', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Normal', percent: 0, priority: 'medium' },
        { id: '2', title: 'Deadline Soon', percent: 0, priority: 'medium', skipAfter: '2026-01-18' }
      ];
      const result = QueueService.buildQueue(items, { now });
      expect(result[0].id).toBe('2'); // Urgent first
      expect(result[0].priority).toBe('urgent');
    });

    it('should return prioritized and filtered queue', () => {
      const now = new Date('2026-01-13');
      const items = [
        { id: '1', title: 'Low Priority', percent: 0, priority: 'low' },
        { id: '2', title: 'In Progress', percent: 50, priority: 'in_progress' },
        { id: '3', title: 'High Priority', percent: 0, priority: 'high' }
      ];
      const result = QueueService.buildQueue(items, { now });
      expect(result.map(i => i.id)).toEqual(['2', '3', '1']);
    });
  });
});
