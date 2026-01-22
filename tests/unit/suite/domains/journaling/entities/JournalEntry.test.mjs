// tests/unit/domains/journaling/entities/JournalEntry.test.mjs
import { JournalEntry } from '@backend/src/1_domains/journaling/entities/JournalEntry.mjs';

describe('JournalEntry', () => {
  describe('constructor', () => {
    test('creates entry with required fields', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        content: 'Today was a good day'
      });

      expect(entry.id).toBe('entry-123');
      expect(entry.userId).toBe('user-1');
      expect(entry.date).toBe('2026-01-11');
      expect(entry.content).toBe('Today was a good day');
    });

    test('defaults createdAt to now', () => {
      const before = new Date().toISOString();
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11'
      });
      const after = new Date().toISOString();

      expect(entry.createdAt >= before).toBe(true);
      expect(entry.createdAt <= after).toBe(true);
    });

    test('initializes empty arrays', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11'
      });

      expect(entry.tags).toEqual([]);
      expect(entry.gratitudeItems).toEqual([]);
    });
  });

  describe('updateContent', () => {
    test('updates content and timestamp', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        content: 'Original'
      });

      entry.updateContent('Updated content');

      expect(entry.content).toBe('Updated content');
      expect(entry.updatedAt).toBeDefined();
    });
  });

  describe('setMood', () => {
    test('sets mood', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11'
      });

      entry.setMood('great');

      expect(entry.mood).toBe('great');
      expect(entry.updatedAt).toBeDefined();
    });
  });

  describe('addGratitudeItem', () => {
    test('adds gratitude item', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11'
      });

      entry.addGratitudeItem('Family');
      entry.addGratitudeItem('Health');

      expect(entry.gratitudeItems).toEqual(['Family', 'Health']);
    });
  });

  describe('addTag', () => {
    test('adds tag', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11'
      });

      entry.addTag('work');

      expect(entry.tags).toContain('work');
    });

    test('does not add duplicate tag', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        tags: ['work']
      });

      entry.addTag('work');

      expect(entry.tags).toEqual(['work']);
    });
  });

  describe('removeTag', () => {
    test('removes tag', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        tags: ['work', 'personal']
      });

      entry.removeTag('work');

      expect(entry.tags).toEqual(['personal']);
    });
  });

  describe('getWordCount', () => {
    test('counts words correctly', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        content: 'This is a test entry with seven words'
      });

      expect(entry.getWordCount()).toBe(8);
    });

    test('handles empty content', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        content: ''
      });

      expect(entry.getWordCount()).toBe(0);
    });
  });

  describe('hasMood', () => {
    test('returns true when mood is set', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        mood: 'good'
      });

      expect(entry.hasMood()).toBe(true);
    });

    test('returns false when mood is null', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11'
      });

      expect(entry.hasMood()).toBe(false);
    });
  });

  describe('toJSON/fromJSON', () => {
    test('round-trips data correctly', () => {
      const original = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        title: 'My Day',
        content: 'It was great',
        mood: 'great',
        tags: ['personal', 'reflection'],
        gratitudeItems: ['Family', 'Health'],
        createdAt: '2026-01-11T12:00:00.000Z',
        metadata: { weather: 'sunny' }
      });

      const json = original.toJSON();
      const restored = JournalEntry.fromJSON(json);

      expect(restored.id).toBe(original.id);
      expect(restored.title).toBe(original.title);
      expect(restored.mood).toBe(original.mood);
      expect(restored.tags).toEqual(original.tags);
      expect(restored.gratitudeItems).toEqual(original.gratitudeItems);
    });
  });
});
