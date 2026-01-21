// tests/unit/parity/parity-runner.unit.test.mjs
import { describe, it, expect } from '@jest/globals';
import { normalizeResponse, compareResponses, loadBaseline } from '../../lib/parity-runner.mjs';

describe('parity-runner', () => {
  describe('normalizeResponse', () => {
    it('strips volatile fields', () => {
      const response = {
        id: '123',
        title: 'Test',
        timestamp: 1234567890,
        _cached: true,
        fetchedAt: '2026-01-21'
      };

      const normalized = normalizeResponse(response);

      expect(normalized.id).toBe('123');
      expect(normalized.title).toBe('Test');
      expect(normalized.timestamp).toBeUndefined();
      expect(normalized._cached).toBeUndefined();
      expect(normalized.fetchedAt).toBeUndefined();
    });

    it('handles nested objects', () => {
      const response = {
        data: {
          id: '123',
          _cached: true
        }
      };

      const normalized = normalizeResponse(response);

      expect(normalized.data.id).toBe('123');
      expect(normalized.data._cached).toBeUndefined();
    });
  });

  describe('compareResponses', () => {
    it('returns match for identical responses', () => {
      const baseline = { id: '123', title: 'Test' };
      const current = { id: '123', title: 'Test' };

      const result = compareResponses(baseline, current);

      expect(result.match).toBe(true);
      expect(result.differences).toHaveLength(0);
    });

    it('detects value differences', () => {
      const baseline = { id: '123', title: 'Test' };
      const current = { id: '123', title: 'Different' };

      const result = compareResponses(baseline, current);

      expect(result.match).toBe(false);
      expect(result.differences).toContainEqual(
        expect.objectContaining({ path: 'title' })
      );
    });

    it('respects type_checks option', () => {
      const baseline = { id: '123', duration: 100 };
      const current = { id: '123', duration: 200 };

      const result = compareResponses(baseline, current, {
        type_checks: ['duration']
      });

      // Type matches (both numbers), so should pass
      expect(result.match).toBe(true);
    });

    it('validates required_fields', () => {
      const baseline = { id: '123', title: 'Test' };
      const current = { id: '123' };  // missing title

      const result = compareResponses(baseline, current, {
        required_fields: ['id', 'title']
      });

      expect(result.match).toBe(false);
      expect(result.differences).toContainEqual(
        expect.objectContaining({ path: 'title', type: 'missing-in-current' })
      );
    });
  });
});
