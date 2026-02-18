import { jest } from '@jest/globals';
import { IFeedSourceAdapter, isFeedSourceAdapter, CONTENT_TYPES } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

describe('IFeedSourceAdapter', () => {
  describe('CONTENT_TYPES', () => {
    test('exports a frozen object with expected keys', () => {
      expect(Object.isFrozen(CONTENT_TYPES)).toBe(true);
      expect(CONTENT_TYPES.FEEDS).toBe('feeds');
      expect(CONTENT_TYPES.NEWS).toBe('news');
      expect(CONTENT_TYPES.SOCIAL).toBe('social');
      expect(CONTENT_TYPES.PHOTOS).toBe('photos');
      expect(CONTENT_TYPES.COMICS).toBe('comics');
      expect(CONTENT_TYPES.EBOOKS).toBe('ebooks');
      expect(CONTENT_TYPES.AUDIO).toBe('audio');
      expect(CONTENT_TYPES.VIDEO).toBe('video');
      expect(CONTENT_TYPES.JOURNAL).toBe('journal');
      expect(CONTENT_TYPES.BOOK_REVIEWS).toBe('book-reviews');
      expect(CONTENT_TYPES.TASKS).toBe('tasks');
      expect(CONTENT_TYPES.WEATHER).toBe('weather');
      expect(CONTENT_TYPES.HEALTH).toBe('health');
      expect(CONTENT_TYPES.FITNESS).toBe('fitness');
      expect(CONTENT_TYPES.GRATITUDE).toBe('gratitude');
      expect(CONTENT_TYPES.ENTROPY).toBe('entropy');
      expect(CONTENT_TYPES.SCRIPTURE).toBe('scripture');
    });
  });

  describe('provides getter', () => {
    test('base class returns empty array', () => {
      const adapter = new IFeedSourceAdapter();
      expect(adapter.provides).toEqual([]);
    });

    test('subclass can override provides', () => {
      class TestAdapter extends IFeedSourceAdapter {
        get sourceType() { return 'test'; }
        get provides() { return [CONTENT_TYPES.FEEDS]; }
      }
      const adapter = new TestAdapter();
      expect(adapter.provides).toEqual(['feeds']);
    });
  });
});
