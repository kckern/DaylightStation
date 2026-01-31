import { describe, it, expect } from '@jest/globals';

import { ReadableItem } from '#domains/content/capabilities/Readable.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('ReadableItem', () => {
  describe('constructor', () => {
    it('creates paged content (comics) with required fields', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Amazing Spider-Man #1',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24
      });

      expect(item.id).toBe('komga:abc-123');
      expect(item.source).toBe('komga');
      expect(item.title).toBe('Amazing Spider-Man #1');
      expect(item.contentType).toBe('paged');
      expect(item.format).toBe('cbz');
      expect(item.totalPages).toBe(24);
    });

    it('creates flow content (ebooks) with required fields', () => {
      const item = new ReadableItem({
        id: 'audiobookshelf:book-456',
        source: 'audiobookshelf',
        title: 'The Great Gatsby',
        contentType: 'flow',
        format: 'epub',
        contentUrl: '/api/ebook/book-456/content'
      });

      expect(item.id).toBe('audiobookshelf:book-456');
      expect(item.source).toBe('audiobookshelf');
      expect(item.title).toBe('The Great Gatsby');
      expect(item.contentType).toBe('flow');
      expect(item.format).toBe('epub');
      expect(item.contentUrl).toBe('/api/ebook/book-456/content');
    });

    it('throws ValidationError when contentType missing', () => {
      expect(() => new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        format: 'cbz',
        totalPages: 24
      })).toThrow(ValidationError);

      try {
        new ReadableItem({
          id: 'komga:abc-123',
          source: 'komga',
          title: 'Test Comic',
          format: 'cbz',
          totalPages: 24
        });
      } catch (e) {
        expect(e.code).toBe('MISSING_CONTENT_TYPE');
        expect(e.field).toBe('contentType');
      }
    });

    it('throws ValidationError when format missing', () => {
      expect(() => new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        totalPages: 24
      })).toThrow(ValidationError);

      try {
        new ReadableItem({
          id: 'komga:abc-123',
          source: 'komga',
          title: 'Test Comic',
          contentType: 'paged',
          totalPages: 24
        });
      } catch (e) {
        expect(e.code).toBe('MISSING_FORMAT');
        expect(e.field).toBe('format');
      }
    });

    it('throws ValidationError for paged content without totalPages', () => {
      expect(() => new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz'
      })).toThrow(ValidationError);

      try {
        new ReadableItem({
          id: 'komga:abc-123',
          source: 'komga',
          title: 'Test Comic',
          contentType: 'paged',
          format: 'cbz'
        });
      } catch (e) {
        expect(e.code).toBe('MISSING_TOTAL_PAGES');
        expect(e.field).toBe('totalPages');
      }
    });

    it('throws ValidationError for flow content without contentUrl', () => {
      expect(() => new ReadableItem({
        id: 'audiobookshelf:book-456',
        source: 'audiobookshelf',
        title: 'Test Ebook',
        contentType: 'flow',
        format: 'epub'
      })).toThrow(ValidationError);

      try {
        new ReadableItem({
          id: 'audiobookshelf:book-456',
          source: 'audiobookshelf',
          title: 'Test Ebook',
          contentType: 'flow',
          format: 'epub'
        });
      } catch (e) {
        expect(e.code).toBe('MISSING_CONTENT_URL');
        expect(e.field).toBe('contentUrl');
      }
    });

    it('sets default values for optional properties', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24
      });

      expect(item.pageLayout).toBe('single');
      expect(item.readingDirection).toBe('ltr');
      expect(item.resumable).toBe(true);
    });

    it('accepts optional properties', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Manga Volume 1',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 200,
        pageLayout: 'double',
        readingDirection: 'rtl',
        resumable: true,
        resumePosition: 45,
        manifestUrl: '/api/komga/abc-123/manifest'
      });

      expect(item.pageLayout).toBe('double');
      expect(item.readingDirection).toBe('rtl');
      expect(item.resumable).toBe(true);
      expect(item.resumePosition).toBe(45);
      expect(item.manifestUrl).toBe('/api/komga/abc-123/manifest');
    });

    it('accepts audioItemId for read-along ebooks', () => {
      const item = new ReadableItem({
        id: 'audiobookshelf:book-456',
        source: 'audiobookshelf',
        title: 'Harry Potter',
        contentType: 'flow',
        format: 'epub',
        contentUrl: '/api/ebook/book-456/content',
        audioItemId: 'audiobookshelf:audio-789'
      });

      expect(item.audioItemId).toBe('audiobookshelf:audio-789');
    });
  });

  describe('getPageUrl()', () => {
    it('returns URL for paged content when _getPageUrl function provided', () => {
      const getPageUrl = (page) => `/api/komga/abc-123/pages/${page}`;
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24,
        _getPageUrl: getPageUrl
      });

      expect(item.getPageUrl(5)).toBe('/api/komga/abc-123/pages/5');
      expect(item.getPageUrl(0)).toBe('/api/komga/abc-123/pages/0');
      expect(item.getPageUrl(23)).toBe('/api/komga/abc-123/pages/23');
    });

    it('returns null for flow content', () => {
      const item = new ReadableItem({
        id: 'audiobookshelf:book-456',
        source: 'audiobookshelf',
        title: 'Test Ebook',
        contentType: 'flow',
        format: 'epub',
        contentUrl: '/api/ebook/book-456/content'
      });

      expect(item.getPageUrl(5)).toBeNull();
    });

    it('returns null when _getPageUrl not provided', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24
      });

      expect(item.getPageUrl(5)).toBeNull();
    });
  });

  describe('getProgress()', () => {
    it('calculates progress from page position for paged content', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 100,
        resumePosition: 50
      });

      expect(item.getProgress()).toBe(50);
    });

    it('returns resumePosition directly for flow content (percent-based)', () => {
      const item = new ReadableItem({
        id: 'audiobookshelf:book-456',
        source: 'audiobookshelf',
        title: 'Test Ebook',
        contentType: 'flow',
        format: 'epub',
        contentUrl: '/api/ebook/book-456/content',
        resumePosition: 75.5
      });

      expect(item.getProgress()).toBe(75.5);
    });

    it('returns null when no resume position', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24
      });

      expect(item.getProgress()).toBeNull();
    });

    it('returns 0 for page 0 of paged content', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 100,
        resumePosition: 0
      });

      expect(item.getProgress()).toBe(0);
    });
  });

  describe('isReadable()', () => {
    it('returns true for paged content', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24
      });

      expect(item.isReadable()).toBe(true);
    });

    it('returns true for flow content', () => {
      const item = new ReadableItem({
        id: 'audiobookshelf:book-456',
        source: 'audiobookshelf',
        title: 'Test Ebook',
        contentType: 'flow',
        format: 'epub',
        contentUrl: '/api/ebook/book-456/content'
      });

      expect(item.isReadable()).toBe(true);
    });
  });

  describe('isComplete()', () => {
    it('returns true when paged content progress >= 90%', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 100,
        resumePosition: 90
      });

      expect(item.isComplete()).toBe(true);
    });

    it('returns true when flow content progress >= 90%', () => {
      const item = new ReadableItem({
        id: 'audiobookshelf:book-456',
        source: 'audiobookshelf',
        title: 'Test Ebook',
        contentType: 'flow',
        format: 'epub',
        contentUrl: '/api/ebook/book-456/content',
        resumePosition: 95
      });

      expect(item.isComplete()).toBe(true);
    });

    it('returns false when progress < 90%', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 100,
        resumePosition: 50
      });

      expect(item.isComplete()).toBe(false);
    });

    it('returns false when no progress', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24
      });

      expect(item.isComplete()).toBe(false);
    });
  });

  describe('isInProgress()', () => {
    it('returns true when progress > 0 and < 90%', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 100,
        resumePosition: 50
      });

      expect(item.isInProgress()).toBe(true);
    });

    it('returns false when no progress', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 24
      });

      expect(item.isInProgress()).toBe(false);
    });

    it('returns false when complete', () => {
      const item = new ReadableItem({
        id: 'komga:abc-123',
        source: 'komga',
        title: 'Test Comic',
        contentType: 'paged',
        format: 'cbz',
        totalPages: 100,
        resumePosition: 95
      });

      expect(item.isInProgress()).toBe(false);
    });
  });
});
