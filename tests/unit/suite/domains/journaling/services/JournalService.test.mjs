// tests/unit/domains/journaling/services/JournalService.test.mjs
import { jest } from '@jest/globals';
import { JournalService } from '#domains/journaling/services/JournalService.mjs';

describe('JournalService', () => {
  let service;
  let mockStore;

  beforeEach(() => {
    mockStore = {
      save: jest.fn(),
      findById: jest.fn(),
      findByUserAndDate: jest.fn(),
      findByUserInRange: jest.fn(),
      findByUserAndTag: jest.fn(),
      delete: jest.fn()
    };

    service = new JournalService({ journalStore: mockStore });
  });

  describe('createEntry', () => {
    test('creates and saves entry', async () => {
      const entry = await service.createEntry({
        userId: 'user-1',
        date: '2026-01-11',
        content: 'Today was great'
      });

      expect(entry.id).toMatch(/^journal-/);
      expect(entry.userId).toBe('user-1');
      expect(entry.content).toBe('Today was great');
      expect(mockStore.save).toHaveBeenCalled();
    });

    test('uses provided id', async () => {
      const entry = await service.createEntry({
        id: 'custom-id',
        userId: 'user-1',
        date: '2026-01-11'
      });

      expect(entry.id).toBe('custom-id');
    });
  });

  describe('getEntry', () => {
    test('returns entry by ID', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        content: 'Test',
        createdAt: '2026-01-11T12:00:00.000Z'
      });

      const entry = await service.getEntry('entry-123');

      expect(entry.id).toBe('entry-123');
    });

    test('returns null for nonexistent entry', async () => {
      mockStore.findById.mockResolvedValue(null);

      const entry = await service.getEntry('nonexistent');

      expect(entry).toBeNull();
    });
  });

  describe('getEntryByDate', () => {
    test('returns entry for date', async () => {
      mockStore.findByUserAndDate.mockResolvedValue({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        content: 'Test',
        createdAt: '2026-01-11T12:00:00.000Z'
      });

      const entry = await service.getEntryByDate('user-1', '2026-01-11');

      expect(entry.date).toBe('2026-01-11');
    });
  });

  describe('updateEntry', () => {
    test('updates entry content', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        content: 'Original',
        createdAt: '2026-01-11T12:00:00.000Z'
      });

      const entry = await service.updateEntry('entry-123', {
        content: 'Updated'
      });

      expect(entry.content).toBe('Updated');
      expect(mockStore.save).toHaveBeenCalled();
    });

    test('updates entry mood', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        content: 'Test',
        mood: null,
        createdAt: '2026-01-11T12:00:00.000Z'
      });

      const entry = await service.updateEntry('entry-123', {
        mood: 'great'
      });

      expect(entry.mood).toBe('great');
    });

    test('throws for nonexistent entry', async () => {
      mockStore.findById.mockResolvedValue(null);

      await expect(
        service.updateEntry('nonexistent', { content: 'test' })
      ).rejects.toThrow('Entry not found');
    });
  });

  describe('deleteEntry', () => {
    test('deletes entry', async () => {
      await service.deleteEntry('entry-123');

      expect(mockStore.delete).toHaveBeenCalledWith('entry-123');
    });
  });

  describe('getEntriesInRange', () => {
    test('returns entries in date range', async () => {
      mockStore.findByUserInRange.mockResolvedValue([
        { id: 'entry-1', date: '2026-01-10', createdAt: '2026-01-10T12:00:00.000Z' },
        { id: 'entry-2', date: '2026-01-11', createdAt: '2026-01-11T12:00:00.000Z' }
      ]);

      const entries = await service.getEntriesInRange('user-1', '2026-01-10', '2026-01-11');

      expect(entries).toHaveLength(2);
    });
  });

  describe('getEntriesByTag', () => {
    test('returns entries with tag', async () => {
      mockStore.findByUserAndTag.mockResolvedValue([
        { id: 'entry-1', tags: ['work'], createdAt: '2026-01-10T12:00:00.000Z' },
        { id: 'entry-2', tags: ['work', 'important'], createdAt: '2026-01-11T12:00:00.000Z' }
      ]);

      const entries = await service.getEntriesByTag('user-1', 'work');

      expect(entries).toHaveLength(2);
    });
  });

  describe('getMoodSummary', () => {
    test('returns mood summary', async () => {
      mockStore.findByUserInRange.mockResolvedValue([
        { id: 'entry-1', mood: 'great', createdAt: '2026-01-10T12:00:00.000Z' },
        { id: 'entry-2', mood: 'good', createdAt: '2026-01-11T12:00:00.000Z' },
        { id: 'entry-3', mood: 'great', createdAt: '2026-01-12T12:00:00.000Z' },
        { id: 'entry-4', mood: null, createdAt: '2026-01-13T12:00:00.000Z' }
      ]);

      const summary = await service.getMoodSummary('user-1', '2026-01-10', '2026-01-13');

      expect(summary.totalEntries).toBe(4);
      expect(summary.entriesWithMood).toBe(3);
      expect(summary.moodCounts.great).toBe(2);
      expect(summary.moodCounts.good).toBe(1);
    });
  });

  describe('generateId', () => {
    test('generates unique IDs', () => {
      const id1 = service.generateId();
      const id2 = service.generateId();

      expect(id1).toMatch(/^journal-/);
      expect(id1).not.toBe(id2);
    });
  });
});
