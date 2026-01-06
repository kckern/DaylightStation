import { describe, it, expect } from '@jest/globals';
import { SessionSerializerV3 } from '../../../frontend/src/hooks/fitness/SessionSerializerV3.js';

describe('SessionSerializerV3', () => {
  describe('serializeSession', () => {
    it('creates session block with required fields', () => {
      const input = {
        sessionId: '20260106114853',
        startTime: 1767728933431,
        endTime: 1767732533431,
        timezone: 'America/Los_Angeles'
      };

      const result = SessionSerializerV3.serialize(input);

      expect(result.version).toBe(3);
      expect(result.session.id).toBe('20260106114853');
      expect(result.session.date).toBe('2026-01-06');
      expect(result.session.start).toMatch(/^2026-01-06 \d{1,2}:\d{2}:\d{2}$/);
      expect(result.session.end).toMatch(/^2026-01-06 \d{1,2}:\d{2}:\d{2}$/);
      expect(result.session.duration_seconds).toBe(3600);
      expect(result.session.timezone).toBe('America/Los_Angeles');
    });
  });
});
