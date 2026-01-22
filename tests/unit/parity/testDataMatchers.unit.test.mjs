// tests/unit/parity/testDataMatchers.unit.test.mjs
import { describe, it, expect } from '@jest/globals';
import { parseMatcher, checkMatcher, validateExpectations } from '../../lib/testDataMatchers.mjs';

describe('testDataMatchers', () => {
  describe('parseMatcher', () => {
    describe('exact string matching', () => {
      it('parses plain string as exact match', () => {
        const matcher = parseMatcher('hello');
        expect(matcher).toEqual({ type: 'exact', value: 'hello' });
      });

      it('parses string with spaces as exact match', () => {
        const matcher = parseMatcher('hello world');
        expect(matcher).toEqual({ type: 'exact', value: 'hello world' });
      });
    });

    describe('regex matching', () => {
      it('parses /pattern/ as regex', () => {
        const matcher = parseMatcher('/^foo/');
        expect(matcher.type).toBe('regex');
        expect(matcher.pattern).toBeInstanceOf(RegExp);
        expect(matcher.pattern.source).toBe('^foo');
      });

      it('parses /pattern/i as case-insensitive regex', () => {
        const matcher = parseMatcher('/hello/i');
        expect(matcher.type).toBe('regex');
        expect(matcher.pattern.flags).toContain('i');
      });

      it('parses /pattern/g as global regex', () => {
        const matcher = parseMatcher('/test/g');
        expect(matcher.type).toBe('regex');
        expect(matcher.pattern.flags).toContain('g');
      });

      it('parses /pattern/gi as multi-flag regex', () => {
        const matcher = parseMatcher('/test/gi');
        expect(matcher.type).toBe('regex');
        expect(matcher.pattern.flags).toContain('g');
        expect(matcher.pattern.flags).toContain('i');
      });

      it('returns error for invalid regex pattern', () => {
        const matcher = parseMatcher('/[invalid/');
        expect(matcher.type).toBe('error');
        expect(matcher.message).toContain('Invalid regex');
      });
    });

    describe('exists matcher', () => {
      it('parses "exists" matcher', () => {
        const matcher = parseMatcher('exists');
        expect(matcher).toEqual({ type: 'exists' });
      });
    });

    describe('type matchers', () => {
      it('parses "string" type matcher', () => {
        const matcher = parseMatcher('string');
        expect(matcher).toEqual({ type: 'type', expectedType: 'string' });
      });

      it('parses "number" type matcher', () => {
        const matcher = parseMatcher('number');
        expect(matcher).toEqual({ type: 'type', expectedType: 'number' });
      });

      it('parses "boolean" type matcher', () => {
        const matcher = parseMatcher('boolean');
        expect(matcher).toEqual({ type: 'type', expectedType: 'boolean' });
      });

      it('parses "array" type matcher', () => {
        const matcher = parseMatcher('array');
        expect(matcher).toEqual({ type: 'type', expectedType: 'array' });
      });

      it('parses "object" type matcher', () => {
        const matcher = parseMatcher('object');
        expect(matcher).toEqual({ type: 'type', expectedType: 'object' });
      });
    });

    describe('numeric comparisons', () => {
      it('parses >10 as greater than', () => {
        const matcher = parseMatcher('>10');
        expect(matcher).toEqual({ type: 'comparison', operator: '>', value: 10 });
      });

      it('parses >=5 as greater than or equal', () => {
        const matcher = parseMatcher('>=5');
        expect(matcher).toEqual({ type: 'comparison', operator: '>=', value: 5 });
      });

      it('parses <100 as less than', () => {
        const matcher = parseMatcher('<100');
        expect(matcher).toEqual({ type: 'comparison', operator: '<', value: 100 });
      });

      it('parses <=50 as less than or equal', () => {
        const matcher = parseMatcher('<=50');
        expect(matcher).toEqual({ type: 'comparison', operator: '<=', value: 50 });
      });

      it('handles decimal numbers', () => {
        const matcher = parseMatcher('>3.14');
        expect(matcher).toEqual({ type: 'comparison', operator: '>', value: 3.14 });
      });

      it('handles negative numbers', () => {
        const matcher = parseMatcher('>-10');
        expect(matcher).toEqual({ type: 'comparison', operator: '>', value: -10 });
      });
    });

    describe('range matcher', () => {
      it('parses 10-100 as range', () => {
        const matcher = parseMatcher('10-100');
        expect(matcher).toEqual({ type: 'range', min: 10, max: 100 });
      });

      it('parses 0-1 as range', () => {
        const matcher = parseMatcher('0-1');
        expect(matcher).toEqual({ type: 'range', min: 0, max: 1 });
      });

      it('parses range with decimal values', () => {
        const matcher = parseMatcher('0.5-1.5');
        expect(matcher).toEqual({ type: 'range', min: 0.5, max: 1.5 });
      });

      it('returns error when min > max', () => {
        const matcher = parseMatcher('100-10');
        expect(matcher.type).toBe('error');
        expect(matcher.message).toContain('Invalid range: 100 > 10');
      });
    });

    describe('enum matcher', () => {
      it('parses movie|episode|track as enum', () => {
        const matcher = parseMatcher('movie|episode|track');
        expect(matcher).toEqual({ type: 'enum', values: ['movie', 'episode', 'track'] });
      });

      it('parses two-value enum', () => {
        const matcher = parseMatcher('yes|no');
        expect(matcher).toEqual({ type: 'enum', values: ['yes', 'no'] });
      });

      it('trims whitespace from enum values', () => {
        const matcher = parseMatcher('a | b | c');
        expect(matcher).toEqual({ type: 'enum', values: ['a', 'b', 'c'] });
      });

      it('filters out empty values from enum', () => {
        const matcher = parseMatcher('a||b');
        expect(matcher).toEqual({ type: 'enum', values: ['a', 'b'] });
      });

      it('filters out empty values with leading pipe', () => {
        const matcher = parseMatcher('|a|b');
        expect(matcher).toEqual({ type: 'enum', values: ['a', 'b'] });
      });

      it('filters out empty values with trailing pipe', () => {
        const matcher = parseMatcher('a|b|');
        expect(matcher).toEqual({ type: 'enum', values: ['a', 'b'] });
      });
    });

    describe('contains matcher', () => {
      it('parses contains:foo', () => {
        const matcher = parseMatcher('contains:foo');
        expect(matcher).toEqual({ type: 'contains', value: 'foo' });
      });

      it('parses contains with spaces in value', () => {
        const matcher = parseMatcher('contains:hello world');
        expect(matcher).toEqual({ type: 'contains', value: 'hello world' });
      });
    });

    describe('length matcher', () => {
      it('parses length:>0', () => {
        const matcher = parseMatcher('length:>0');
        expect(matcher).toEqual({
          type: 'length',
          comparison: { type: 'comparison', operator: '>', value: 0 }
        });
      });

      it('parses length:>=5', () => {
        const matcher = parseMatcher('length:>=5');
        expect(matcher).toEqual({
          type: 'length',
          comparison: { type: 'comparison', operator: '>=', value: 5 }
        });
      });

      it('parses length:<10', () => {
        const matcher = parseMatcher('length:<10');
        expect(matcher).toEqual({
          type: 'length',
          comparison: { type: 'comparison', operator: '<', value: 10 }
        });
      });

      it('parses length with exact number', () => {
        const matcher = parseMatcher('length:5');
        expect(matcher).toEqual({
          type: 'length',
          comparison: { type: 'exact', value: 5 }
        });
      });

      it('parses length:5-10 as range', () => {
        const matcher = parseMatcher('length:5-10');
        expect(matcher).toEqual({
          type: 'length',
          comparison: { type: 'range', min: 5, max: 10 }
        });
      });
    });
  });

  describe('checkMatcher', () => {
    describe('error matcher', () => {
      it('returns invalid with error message for error type', () => {
        const matcher = { type: 'error', message: 'Invalid regex: some error' };
        const result = checkMatcher('anything', matcher, 'field');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('field: Invalid regex: some error');
      });
    });

    describe('exact string matching', () => {
      it('validates exact match', () => {
        const matcher = { type: 'exact', value: 'hello' };
        expect(checkMatcher('hello', matcher, 'field').valid).toBe(true);
      });

      it('rejects non-matching string', () => {
        const matcher = { type: 'exact', value: 'hello' };
        const result = checkMatcher('world', matcher, 'field');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('field');
      });
    });

    describe('regex matching', () => {
      it('validates regex match', () => {
        const matcher = { type: 'regex', pattern: /^foo/ };
        expect(checkMatcher('foobar', matcher, 'field').valid).toBe(true);
      });

      it('rejects non-matching regex', () => {
        const matcher = { type: 'regex', pattern: /^foo/ };
        const result = checkMatcher('barfoo', matcher, 'field');
        expect(result.valid).toBe(false);
      });

      it('validates case-insensitive regex', () => {
        const matcher = { type: 'regex', pattern: /hello/i };
        expect(checkMatcher('HELLO', matcher, 'field').valid).toBe(true);
      });
    });

    describe('exists matcher', () => {
      it('validates existing value', () => {
        const matcher = { type: 'exists' };
        expect(checkMatcher('anything', matcher, 'field').valid).toBe(true);
      });

      it('validates 0 as existing', () => {
        const matcher = { type: 'exists' };
        expect(checkMatcher(0, matcher, 'field').valid).toBe(true);
      });

      it('validates false as existing', () => {
        const matcher = { type: 'exists' };
        expect(checkMatcher(false, matcher, 'field').valid).toBe(true);
      });

      it('validates empty string as existing', () => {
        const matcher = { type: 'exists' };
        expect(checkMatcher('', matcher, 'field').valid).toBe(true);
      });

      it('rejects null', () => {
        const matcher = { type: 'exists' };
        expect(checkMatcher(null, matcher, 'field').valid).toBe(false);
      });

      it('rejects undefined', () => {
        const matcher = { type: 'exists' };
        expect(checkMatcher(undefined, matcher, 'field').valid).toBe(false);
      });
    });

    describe('type matchers', () => {
      it('validates string type', () => {
        const matcher = { type: 'type', expectedType: 'string' };
        expect(checkMatcher('hello', matcher, 'field').valid).toBe(true);
      });

      it('rejects number for string type', () => {
        const matcher = { type: 'type', expectedType: 'string' };
        expect(checkMatcher(123, matcher, 'field').valid).toBe(false);
      });

      it('validates number type', () => {
        const matcher = { type: 'type', expectedType: 'number' };
        expect(checkMatcher(42, matcher, 'field').valid).toBe(true);
      });

      it('validates boolean type', () => {
        const matcher = { type: 'type', expectedType: 'boolean' };
        expect(checkMatcher(true, matcher, 'field').valid).toBe(true);
      });

      it('validates array type', () => {
        const matcher = { type: 'type', expectedType: 'array' };
        expect(checkMatcher([1, 2, 3], matcher, 'field').valid).toBe(true);
      });

      it('rejects object for array type', () => {
        const matcher = { type: 'type', expectedType: 'array' };
        expect(checkMatcher({ a: 1 }, matcher, 'field').valid).toBe(false);
      });

      it('validates object type', () => {
        const matcher = { type: 'type', expectedType: 'object' };
        expect(checkMatcher({ a: 1 }, matcher, 'field').valid).toBe(true);
      });

      it('rejects array for object type', () => {
        const matcher = { type: 'type', expectedType: 'object' };
        expect(checkMatcher([1, 2], matcher, 'field').valid).toBe(false);
      });
    });

    describe('numeric comparisons', () => {
      it('validates > comparison', () => {
        const matcher = { type: 'comparison', operator: '>', value: 10 };
        expect(checkMatcher(15, matcher, 'field').valid).toBe(true);
        expect(checkMatcher(10, matcher, 'field').valid).toBe(false);
        expect(checkMatcher(5, matcher, 'field').valid).toBe(false);
      });

      it('validates >= comparison', () => {
        const matcher = { type: 'comparison', operator: '>=', value: 10 };
        expect(checkMatcher(15, matcher, 'field').valid).toBe(true);
        expect(checkMatcher(10, matcher, 'field').valid).toBe(true);
        expect(checkMatcher(5, matcher, 'field').valid).toBe(false);
      });

      it('validates < comparison', () => {
        const matcher = { type: 'comparison', operator: '<', value: 10 };
        expect(checkMatcher(5, matcher, 'field').valid).toBe(true);
        expect(checkMatcher(10, matcher, 'field').valid).toBe(false);
        expect(checkMatcher(15, matcher, 'field').valid).toBe(false);
      });

      it('validates <= comparison', () => {
        const matcher = { type: 'comparison', operator: '<=', value: 10 };
        expect(checkMatcher(5, matcher, 'field').valid).toBe(true);
        expect(checkMatcher(10, matcher, 'field').valid).toBe(true);
        expect(checkMatcher(15, matcher, 'field').valid).toBe(false);
      });

      it('rejects non-numeric values', () => {
        const matcher = { type: 'comparison', operator: '>', value: 10 };
        expect(checkMatcher('hello', matcher, 'field').valid).toBe(false);
      });
    });

    describe('range matcher', () => {
      it('validates value within range', () => {
        const matcher = { type: 'range', min: 10, max: 100 };
        expect(checkMatcher(50, matcher, 'field').valid).toBe(true);
      });

      it('validates value at range boundaries', () => {
        const matcher = { type: 'range', min: 10, max: 100 };
        expect(checkMatcher(10, matcher, 'field').valid).toBe(true);
        expect(checkMatcher(100, matcher, 'field').valid).toBe(true);
      });

      it('rejects value below range', () => {
        const matcher = { type: 'range', min: 10, max: 100 };
        expect(checkMatcher(5, matcher, 'field').valid).toBe(false);
      });

      it('rejects value above range', () => {
        const matcher = { type: 'range', min: 10, max: 100 };
        expect(checkMatcher(150, matcher, 'field').valid).toBe(false);
      });
    });

    describe('enum matcher', () => {
      it('validates value in enum', () => {
        const matcher = { type: 'enum', values: ['movie', 'episode', 'track'] };
        expect(checkMatcher('movie', matcher, 'field').valid).toBe(true);
        expect(checkMatcher('episode', matcher, 'field').valid).toBe(true);
      });

      it('rejects value not in enum', () => {
        const matcher = { type: 'enum', values: ['movie', 'episode', 'track'] };
        const result = checkMatcher('album', matcher, 'field');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('movie|episode|track');
      });
    });

    describe('contains matcher', () => {
      it('validates string containing substring', () => {
        const matcher = { type: 'contains', value: 'foo' };
        expect(checkMatcher('foobar', matcher, 'field').valid).toBe(true);
        expect(checkMatcher('barfoo', matcher, 'field').valid).toBe(true);
      });

      it('rejects string not containing substring', () => {
        const matcher = { type: 'contains', value: 'foo' };
        expect(checkMatcher('bar', matcher, 'field').valid).toBe(false);
      });

      it('validates array containing element', () => {
        const matcher = { type: 'contains', value: 'foo' };
        expect(checkMatcher(['foo', 'bar'], matcher, 'field').valid).toBe(true);
      });

      it('rejects array not containing element', () => {
        const matcher = { type: 'contains', value: 'foo' };
        expect(checkMatcher(['bar', 'baz'], matcher, 'field').valid).toBe(false);
      });
    });

    describe('length matcher', () => {
      it('validates array length with comparison', () => {
        const matcher = { type: 'length', comparison: { type: 'comparison', operator: '>', value: 0 } };
        expect(checkMatcher([1, 2, 3], matcher, 'field').valid).toBe(true);
        expect(checkMatcher([], matcher, 'field').valid).toBe(false);
      });

      it('validates string length with comparison', () => {
        const matcher = { type: 'length', comparison: { type: 'comparison', operator: '>=', value: 5 } };
        expect(checkMatcher('hello', matcher, 'field').valid).toBe(true);
        expect(checkMatcher('hi', matcher, 'field').valid).toBe(false);
      });

      it('validates exact length', () => {
        const matcher = { type: 'length', comparison: { type: 'exact', value: 3 } };
        expect(checkMatcher([1, 2, 3], matcher, 'field').valid).toBe(true);
        expect(checkMatcher([1, 2], matcher, 'field').valid).toBe(false);
      });

      it('validates length range for arrays', () => {
        const matcher = { type: 'length', comparison: { type: 'range', min: 2, max: 5 } };
        expect(checkMatcher([1, 2, 3], matcher, 'field').valid).toBe(true);
        expect(checkMatcher([1], matcher, 'field').valid).toBe(false);
        expect(checkMatcher([1, 2, 3, 4, 5, 6], matcher, 'field').valid).toBe(false);
      });

      it('validates length range for strings', () => {
        const matcher = { type: 'length', comparison: { type: 'range', min: 5, max: 10 } };
        expect(checkMatcher('hello', matcher, 'field').valid).toBe(true);
        expect(checkMatcher('hi', matcher, 'field').valid).toBe(false);
        expect(checkMatcher('this is a very long string', matcher, 'field').valid).toBe(false);
      });

      it('validates length range boundaries', () => {
        const matcher = { type: 'length', comparison: { type: 'range', min: 5, max: 10 } };
        expect(checkMatcher('hello', matcher, 'field').valid).toBe(true);
        expect(checkMatcher('helloworld', matcher, 'field').valid).toBe(true);
      });
    });
  });

  describe('validateExpectations', () => {
    it('validates object against expectation map', () => {
      const actual = {
        id: '123',
        name: 'Test',
        count: 42
      };

      const expectations = {
        id: 'string',
        name: 'exists',
        count: '>0'
      };

      const result = validateExpectations(actual, expectations);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns errors for failed expectations', () => {
      const actual = {
        id: '123',
        count: -5
      };

      const expectations = {
        id: 'string',
        name: 'exists',
        count: '>0'
      };

      const result = validateExpectations(actual, expectations);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.field === 'name')).toBe(true);
      expect(result.errors.some(e => e.field === 'count')).toBe(true);
    });

    it('handles nested field paths with dot notation', () => {
      const actual = {
        data: {
          items: [1, 2, 3]
        }
      };

      const expectations = {
        'data.items': 'array'
      };

      const result = validateExpectations(actual, expectations);
      expect(result.valid).toBe(true);
    });

    it('handles missing nested fields', () => {
      const actual = {
        data: {}
      };

      const expectations = {
        'data.items': 'exists'
      };

      const result = validateExpectations(actual, expectations);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('data.items');
    });

    it('validates array element expectations with [0] notation', () => {
      const actual = {
        items: [
          { id: '123', type: 'movie' }
        ]
      };

      const expectations = {
        'items[0].id': 'string',
        'items[0].type': 'movie|episode'
      };

      const result = validateExpectations(actual, expectations);
      expect(result.valid).toBe(true);
    });

    it('handles empty actual object', () => {
      const actual = {};
      const expectations = {
        id: 'exists'
      };

      const result = validateExpectations(actual, expectations);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('id');
    });
  });
});
