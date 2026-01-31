// tests/isolated/domain/media/IMediaSearchable.test.mjs
import { isMediaSearchable, validateSearchQuery } from '#domains/media/IMediaSearchable.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('IMediaSearchable', () => {
  describe('isMediaSearchable', () => {
    test('returns true for object with search method', () => {
      const adapter = {
        search: async () => ({ items: [], total: 0 }),
        getSearchCapabilities: () => ['text']
      };
      expect(isMediaSearchable(adapter)).toBe(true);
    });

    test('returns false for object without search method', () => {
      const adapter = {
        getList: async () => []
      };
      expect(isMediaSearchable(adapter)).toBe(false);
    });

    test('returns false for null', () => {
      expect(isMediaSearchable(null)).toBe(false);
    });

    test('returns false for undefined', () => {
      expect(isMediaSearchable(undefined)).toBe(false);
    });

    test('returns false for object with search but missing getSearchCapabilities', () => {
      const adapter = {
        search: async () => ({ items: [], total: 0 })
      };
      expect(isMediaSearchable(adapter)).toBe(false);
    });
  });

  describe('validateSearchQuery', () => {
    test('accepts valid query with text', () => {
      const query = { text: 'beach vacation' };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });

    test('accepts valid query with date range', () => {
      const query = { dateFrom: '2025-01-01', dateTo: '2025-12-31' };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });

    test('accepts valid query with people', () => {
      const query = { people: ['Felix', 'Milo'] };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });

    test('accepts valid query with mediaType image', () => {
      const query = { mediaType: 'image' };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });

    test('accepts valid query with mediaType video', () => {
      const query = { mediaType: 'video' };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });

    test('accepts valid query with mediaType audio', () => {
      const query = { mediaType: 'audio' };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });

    test('rejects invalid mediaType', () => {
      const query = { mediaType: 'invalid' };
      expect(() => validateSearchQuery(query)).toThrow(ValidationError);
      try {
        validateSearchQuery(query);
      } catch (e) {
        expect(e.code).toBe('INVALID_MEDIA_TYPE');
        expect(e.field).toBe('mediaType');
        expect(e.value).toBe('invalid');
      }
    });

    test('accepts empty query', () => {
      expect(() => validateSearchQuery({})).not.toThrow();
    });

    test('accepts query with pagination', () => {
      const query = { take: 50, skip: 100 };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });

    test('rejects negative take', () => {
      const query = { take: -1 };
      expect(() => validateSearchQuery(query)).toThrow(ValidationError);
      try {
        validateSearchQuery(query);
      } catch (e) {
        expect(e.code).toBe('INVALID_TAKE');
        expect(e.field).toBe('take');
        expect(e.value).toBe(-1);
      }
    });

    test('rejects negative skip', () => {
      const query = { skip: -1 };
      expect(() => validateSearchQuery(query)).toThrow(ValidationError);
      try {
        validateSearchQuery(query);
      } catch (e) {
        expect(e.code).toBe('INVALID_SKIP');
        expect(e.field).toBe('skip');
        expect(e.value).toBe(-1);
      }
    });

    test('accepts valid sort options', () => {
      expect(() => validateSearchQuery({ sort: 'date' })).not.toThrow();
      expect(() => validateSearchQuery({ sort: 'title' })).not.toThrow();
      expect(() => validateSearchQuery({ sort: 'random' })).not.toThrow();
    });

    test('rejects invalid sort option', () => {
      const query = { sort: 'invalid' };
      expect(() => validateSearchQuery(query)).toThrow(ValidationError);
      try {
        validateSearchQuery(query);
      } catch (e) {
        expect(e.code).toBe('INVALID_SORT');
        expect(e.field).toBe('sort');
        expect(e.value).toBe('invalid');
      }
    });

    test('accepts valid ratingMin values', () => {
      expect(() => validateSearchQuery({ ratingMin: 1 })).not.toThrow();
      expect(() => validateSearchQuery({ ratingMin: 3 })).not.toThrow();
      expect(() => validateSearchQuery({ ratingMin: 5 })).not.toThrow();
    });

    test('rejects ratingMin below 1', () => {
      const query = { ratingMin: 0 };
      expect(() => validateSearchQuery(query)).toThrow(ValidationError);
      try {
        validateSearchQuery(query);
      } catch (e) {
        expect(e.code).toBe('INVALID_RATING');
        expect(e.field).toBe('ratingMin');
        expect(e.value).toBe(0);
      }
    });

    test('rejects ratingMin above 5', () => {
      const query = { ratingMin: 6 };
      expect(() => validateSearchQuery(query)).toThrow(ValidationError);
      try {
        validateSearchQuery(query);
      } catch (e) {
        expect(e.code).toBe('INVALID_RATING');
        expect(e.field).toBe('ratingMin');
        expect(e.value).toBe(6);
      }
    });

    test('accepts complex query with multiple fields', () => {
      const query = {
        text: 'vacation',
        people: ['Felix'],
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
        mediaType: 'image',
        favorites: true,
        take: 100,
        skip: 0,
        sort: 'date'
      };
      expect(() => validateSearchQuery(query)).not.toThrow();
    });
  });
});
