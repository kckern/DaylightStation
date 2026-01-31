// tests/unit/domains/journaling/entities/JournalEntry.test.mjs
import { JournalEntry } from '#domains/journaling/entities/JournalEntry.mjs';

// Helper to generate timestamps for tests
const testTimestamp = () => new Date().toISOString();

describe('JournalEntry', () => {
  describe('constructor', () => {
    test('creates entry with required fields', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        content: 'Today was a good day',
        createdAt: '2026-01-11T12:00:00.000Z'
      });

      expect(entry.id).toBe('entry-123');
      expect(entry.userId).toBe('user-1');
      expect(entry.date).toBe('2026-01-11');
      expect(entry.content).toBe('Today was a good day');
    });

    test('uses provided createdAt timestamp', () => {
      const timestamp = '2026-01-11T15:30:00.000Z';
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        createdAt: timestamp
      });

      expect(entry.createdAt).toBe(timestamp);
    });

    test('initializes empty arrays', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        createdAt: testTimestamp()
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
        content: 'Original',
        createdAt: testTimestamp()
      });

      const updateTime = testTimestamp();
      entry.updateContent('Updated content', updateTime);

      expect(entry.content).toBe('Updated content');
      expect(entry.updatedAt).toBe(updateTime);
    });

    test('requires timestamp parameter', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        createdAt: testTimestamp()
      });

      expect(() => entry.updateContent('New content')).toThrow('timestamp is required');
    });
  });

  describe('setMood', () => {
    test('sets mood', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        createdAt: testTimestamp()
      });

      const updateTime = testTimestamp();
      entry.setMood('great', updateTime);

      expect(entry.mood).toBe('great');
      expect(entry.updatedAt).toBe(updateTime);
    });

    test('requires timestamp parameter', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        createdAt: testTimestamp()
      });

      expect(() => entry.setMood('great')).toThrow('timestamp is required');
    });
  });

  describe('addGratitudeItem', () => {
    test('adds gratitude item', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        createdAt: testTimestamp()
      });

      const ts = testTimestamp();
      entry.addGratitudeItem('Family', ts);
      entry.addGratitudeItem('Health', ts);

      expect(entry.gratitudeItems).toEqual(['Family', 'Health']);
    });

    test('requires timestamp parameter', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        createdAt: testTimestamp()
      });

      expect(() => entry.addGratitudeItem('Family')).toThrow('timestamp is required');
    });
  });

  describe('addTag', () => {
    test('adds tag', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        createdAt: testTimestamp()
      });

      entry.addTag('work', testTimestamp());

      expect(entry.tags).toContain('work');
    });

    test('does not add duplicate tag', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        tags: ['work'],
        createdAt: testTimestamp()
      });

      entry.addTag('work', testTimestamp());

      expect(entry.tags).toEqual(['work']);
    });

    test('requires timestamp parameter', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        createdAt: testTimestamp()
      });

      expect(() => entry.addTag('work')).toThrow('timestamp is required');
    });
  });

  describe('removeTag', () => {
    test('removes tag', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        tags: ['work', 'personal'],
        createdAt: testTimestamp()
      });

      entry.removeTag('work', testTimestamp());

      expect(entry.tags).toEqual(['personal']);
    });

    test('requires timestamp parameter', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        tags: ['work'],
        createdAt: testTimestamp()
      });

      expect(() => entry.removeTag('work')).toThrow('timestamp is required');
    });
  });

  describe('getWordCount', () => {
    test('counts words correctly', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        content: 'This is a test entry with seven words',
        createdAt: testTimestamp()
      });

      expect(entry.getWordCount()).toBe(8);
    });

    test('handles empty content', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        content: '',
        createdAt: testTimestamp()
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
        mood: 'good',
        createdAt: testTimestamp()
      });

      expect(entry.hasMood()).toBe(true);
    });

    test('returns false when mood is null', () => {
      const entry = new JournalEntry({
        id: 'entry-123',
        userId: 'user-1',
        date: '2026-01-11',
        createdAt: testTimestamp()
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
