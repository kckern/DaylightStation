import { describe, it, expect } from 'vitest';
import { CostCategory } from '../../../../../../src/1_domains/cost/value-objects/CostCategory.mjs';
import { ValidationError } from '../../../../../../src/1_domains/core/errors/index.mjs';

describe('CostCategory', () => {
  describe('constructor', () => {
    it('should create a CostCategory with a path array', () => {
      const cat = new CostCategory(['ai', 'openai', 'gpt-4o']);
      expect(cat.path).toEqual(['ai', 'openai', 'gpt-4o']);
    });

    it('should create a CostCategory with a single-element path', () => {
      const cat = new CostCategory(['utilities']);
      expect(cat.path).toEqual(['utilities']);
    });

    it('should throw ValidationError for empty array', () => {
      expect(() => new CostCategory([])).toThrow(ValidationError);
      expect(() => new CostCategory([])).toThrow('Path cannot be empty');
    });

    it('should include error code for empty array', () => {
      try {
        new CostCategory([]);
      } catch (error) {
        expect(error.code).toBe('EMPTY_PATH');
      }
    });
  });

  describe('immutability', () => {
    it('should be frozen (immutable)', () => {
      const cat = new CostCategory(['ai', 'openai']);
      expect(Object.isFrozen(cat)).toBe(true);
    });

    it('should freeze the path array', () => {
      const cat = new CostCategory(['ai', 'openai']);
      expect(Object.isFrozen(cat.path)).toBe(true);
    });

    it('should not allow modification of returned path', () => {
      const cat = new CostCategory(['ai', 'openai']);
      expect(() => {
        cat.path.push('gpt-4o');
      }).toThrow();
    });
  });

  describe('getters', () => {
    it('should return path via getter', () => {
      const cat = new CostCategory(['utilities', 'electricity']);
      expect(cat.path).toEqual(['utilities', 'electricity']);
    });
  });

  describe('getRoot', () => {
    it('should return the first segment', () => {
      const cat = new CostCategory(['ai', 'openai', 'gpt-4o']);
      expect(cat.getRoot()).toBe('ai');
    });

    it('should return the only segment for single-element path', () => {
      const cat = new CostCategory(['utilities']);
      expect(cat.getRoot()).toBe('utilities');
    });
  });

  describe('getParent', () => {
    it('should return parent CostCategory for multi-level path', () => {
      const cat = new CostCategory(['ai', 'openai', 'gpt-4o']);
      const parent = cat.getParent();
      expect(parent).toBeInstanceOf(CostCategory);
      expect(parent.path).toEqual(['ai', 'openai']);
    });

    it('should return grandparent CostCategory', () => {
      const cat = new CostCategory(['ai', 'openai', 'gpt-4o']);
      const grandparent = cat.getParent().getParent();
      expect(grandparent.path).toEqual(['ai']);
    });

    it('should return null for root category', () => {
      const cat = new CostCategory(['utilities']);
      expect(cat.getParent()).toBeNull();
    });
  });

  describe('includes', () => {
    it('should return true when this is ancestor of other', () => {
      const parent = new CostCategory(['ai', 'openai']);
      const child = new CostCategory(['ai', 'openai', 'gpt-4o']);
      expect(parent.includes(child)).toBe(true);
    });

    it('should return true for root including deeply nested', () => {
      const root = new CostCategory(['ai']);
      const deep = new CostCategory(['ai', 'openai', 'gpt-4o']);
      expect(root.includes(deep)).toBe(true);
    });

    it('should return false when other is ancestor of this', () => {
      const child = new CostCategory(['ai', 'openai', 'gpt-4o']);
      const parent = new CostCategory(['ai', 'openai']);
      expect(child.includes(parent)).toBe(false);
    });

    it('should return false for same category (not strict ancestor)', () => {
      const cat1 = new CostCategory(['ai', 'openai']);
      const cat2 = new CostCategory(['ai', 'openai']);
      expect(cat1.includes(cat2)).toBe(false);
    });

    it('should return false for unrelated categories', () => {
      const cat1 = new CostCategory(['ai', 'openai']);
      const cat2 = new CostCategory(['utilities', 'electricity']);
      expect(cat1.includes(cat2)).toBe(false);
    });

    it('should return false for partial prefix that is not ancestor', () => {
      const cat1 = new CostCategory(['ai', 'openai']);
      const cat2 = new CostCategory(['ai', 'anthropic']);
      expect(cat1.includes(cat2)).toBe(false);
    });
  });

  describe('matches', () => {
    it('should return true for exact match', () => {
      const cat1 = new CostCategory(['ai', 'openai']);
      const cat2 = new CostCategory(['ai', 'openai']);
      expect(cat1.matches(cat2)).toBe(true);
    });

    it('should return true when this includes other', () => {
      const parent = new CostCategory(['ai', 'openai']);
      const child = new CostCategory(['ai', 'openai', 'gpt-4o']);
      expect(parent.matches(child)).toBe(true);
    });

    it('should return false when other is ancestor of this', () => {
      const child = new CostCategory(['ai', 'openai', 'gpt-4o']);
      const parent = new CostCategory(['ai', 'openai']);
      expect(child.matches(parent)).toBe(false);
    });

    it('should return false for unrelated categories', () => {
      const cat1 = new CostCategory(['ai']);
      const cat2 = new CostCategory(['utilities']);
      expect(cat1.matches(cat2)).toBe(false);
    });
  });

  describe('equals', () => {
    it('should return true for equal categories', () => {
      const cat1 = new CostCategory(['ai', 'openai', 'gpt-4o']);
      const cat2 = new CostCategory(['ai', 'openai', 'gpt-4o']);
      expect(cat1.equals(cat2)).toBe(true);
    });

    it('should return false for different paths', () => {
      const cat1 = new CostCategory(['ai', 'openai']);
      const cat2 = new CostCategory(['ai', 'anthropic']);
      expect(cat1.equals(cat2)).toBe(false);
    });

    it('should return false for different lengths', () => {
      const cat1 = new CostCategory(['ai', 'openai']);
      const cat2 = new CostCategory(['ai', 'openai', 'gpt-4o']);
      expect(cat1.equals(cat2)).toBe(false);
    });

    it('should return false for null', () => {
      const cat = new CostCategory(['ai']);
      expect(cat.equals(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      const cat = new CostCategory(['ai']);
      expect(cat.equals(undefined)).toBe(false);
    });

    it('should return false for non-CostCategory', () => {
      const cat = new CostCategory(['ai']);
      expect(cat.equals({ path: ['ai'] })).toBe(false);
    });
  });

  describe('toString', () => {
    it('should return slash-separated path', () => {
      const cat = new CostCategory(['ai', 'openai', 'gpt-4o']);
      expect(cat.toString()).toBe('ai/openai/gpt-4o');
    });

    it('should return single segment for root', () => {
      const cat = new CostCategory(['utilities']);
      expect(cat.toString()).toBe('utilities');
    });
  });

  describe('toJSON', () => {
    it('should return string (same as toString)', () => {
      const cat = new CostCategory(['ai', 'openai', 'gpt-4o']);
      expect(cat.toJSON()).toBe('ai/openai/gpt-4o');
    });

    it('should serialize correctly with JSON.stringify', () => {
      const cat = new CostCategory(['ai', 'openai']);
      const json = JSON.stringify({ category: cat });
      expect(json).toBe('{"category":"ai/openai"}');
    });
  });

  describe('fromString', () => {
    it('should parse slash-separated path', () => {
      const cat = CostCategory.fromString('ai/openai/gpt-4o');
      expect(cat.path).toEqual(['ai', 'openai', 'gpt-4o']);
    });

    it('should parse single segment', () => {
      const cat = CostCategory.fromString('utilities');
      expect(cat.path).toEqual(['utilities']);
    });

    it('should throw ValidationError for empty string', () => {
      expect(() => CostCategory.fromString('')).toThrow(ValidationError);
    });

    it('should handle paths with leading/trailing slashes gracefully', () => {
      // Depending on design, this might filter empty strings
      const cat = CostCategory.fromString('ai/openai/');
      expect(cat.path).toEqual(['ai', 'openai']);
    });
  });

  describe('fromJSON', () => {
    it('should handle string input (same as fromString)', () => {
      const cat = CostCategory.fromJSON('ai/openai/gpt-4o');
      expect(cat.path).toEqual(['ai', 'openai', 'gpt-4o']);
    });

    it('should handle array input', () => {
      const cat = CostCategory.fromJSON(['ai', 'openai', 'gpt-4o']);
      expect(cat.path).toEqual(['ai', 'openai', 'gpt-4o']);
    });

    it('should throw ValidationError for null', () => {
      expect(() => CostCategory.fromJSON(null)).toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid type', () => {
      expect(() => CostCategory.fromJSON(123)).toThrow(ValidationError);
    });
  });

  describe('integration scenarios', () => {
    it('should work with full hierarchy traversal', () => {
      const cat = CostCategory.fromString('ai/openai/gpt-4o');
      expect(cat.getRoot()).toBe('ai');
      expect(cat.getParent().toString()).toBe('ai/openai');
      expect(cat.getParent().getParent().toString()).toBe('ai');
      expect(cat.getParent().getParent().getParent()).toBeNull();
    });

    it('should serialize and deserialize correctly', () => {
      const original = new CostCategory(['utilities', 'electricity', 'pge']);
      const serialized = original.toJSON();
      const deserialized = CostCategory.fromJSON(serialized);
      expect(deserialized.equals(original)).toBe(true);
    });
  });
});
