// tests/isolated/domain/content/value-objects/ContentCategory.test.mjs
import { describe, it, expect } from 'vitest';
import {
  ContentCategory,
  ALL_CONTENT_CATEGORIES,
  isValidContentCategory,
  getCategoryScore
} from '#domains/content/value-objects/ContentCategory.mjs';

describe('ContentCategory', () => {
  describe('ContentCategory enum', () => {
    it('defines IDENTITY category', () => {
      expect(ContentCategory.IDENTITY).toBe('identity');
    });

    it('defines CURATED category', () => {
      expect(ContentCategory.CURATED).toBe('curated');
    });

    it('defines CREATOR category', () => {
      expect(ContentCategory.CREATOR).toBe('creator');
    });

    it('defines SERIES category', () => {
      expect(ContentCategory.SERIES).toBe('series');
    });

    it('defines WORK category', () => {
      expect(ContentCategory.WORK).toBe('work');
    });

    it('defines CONTAINER category', () => {
      expect(ContentCategory.CONTAINER).toBe('container');
    });

    it('defines EPISODE category', () => {
      expect(ContentCategory.EPISODE).toBe('episode');
    });

    it('defines TRACK category', () => {
      expect(ContentCategory.TRACK).toBe('track');
    });

    it('defines MEDIA category', () => {
      expect(ContentCategory.MEDIA).toBe('media');
    });

    it('is frozen (immutable)', () => {
      expect(Object.isFrozen(ContentCategory)).toBe(true);
    });
  });

  describe('ALL_CONTENT_CATEGORIES', () => {
    it('contains all category values', () => {
      expect(ALL_CONTENT_CATEGORIES).toContain('identity');
      expect(ALL_CONTENT_CATEGORIES).toContain('curated');
      expect(ALL_CONTENT_CATEGORIES).toContain('creator');
      expect(ALL_CONTENT_CATEGORIES).toHaveLength(9);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(ALL_CONTENT_CATEGORIES)).toBe(true);
    });
  });

  describe('isValidContentCategory', () => {
    it('returns true for valid categories', () => {
      expect(isValidContentCategory('identity')).toBe(true);
      expect(isValidContentCategory('curated')).toBe(true);
      expect(isValidContentCategory('media')).toBe(true);
    });

    it('returns false for invalid categories', () => {
      expect(isValidContentCategory('invalid')).toBe(false);
      expect(isValidContentCategory('')).toBe(false);
      expect(isValidContentCategory(null)).toBe(false);
      expect(isValidContentCategory(undefined)).toBe(false);
    });
  });

  describe('getCategoryScore', () => {
    it('returns 150 for IDENTITY', () => {
      expect(getCategoryScore(ContentCategory.IDENTITY)).toBe(150);
    });

    it('returns 148 for CURATED', () => {
      expect(getCategoryScore(ContentCategory.CURATED)).toBe(148);
    });

    it('returns 145 for CREATOR', () => {
      expect(getCategoryScore(ContentCategory.CREATOR)).toBe(145);
    });

    it('returns 140 for SERIES', () => {
      expect(getCategoryScore(ContentCategory.SERIES)).toBe(140);
    });

    it('returns 130 for WORK', () => {
      expect(getCategoryScore(ContentCategory.WORK)).toBe(130);
    });

    it('returns 125 for CONTAINER', () => {
      expect(getCategoryScore(ContentCategory.CONTAINER)).toBe(125);
    });

    it('returns 20 for EPISODE', () => {
      expect(getCategoryScore(ContentCategory.EPISODE)).toBe(20);
    });

    it('returns 15 for TRACK', () => {
      expect(getCategoryScore(ContentCategory.TRACK)).toBe(15);
    });

    it('returns 10 for MEDIA', () => {
      expect(getCategoryScore(ContentCategory.MEDIA)).toBe(10);
    });

    it('returns 5 for unknown category', () => {
      expect(getCategoryScore('unknown')).toBe(5);
      expect(getCategoryScore(null)).toBe(5);
    });
  });
});
