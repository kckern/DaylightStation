import { describe, it, expect } from 'vitest';
import {
  CANONICAL_FIELDS,
  LEGACY_FIELDS,
  LEGACY_TO_CANONICAL,
  validateCanonicalSchema
} from '#adapters/persistence/yaml/mediaProgressSchema.mjs';

describe('mediaProgressSchema', () => {
  describe('CANONICAL_FIELDS', () => {
    it('should contain all canonical fields', () => {
      expect(CANONICAL_FIELDS).toContain('playhead');
      expect(CANONICAL_FIELDS).toContain('duration');
      expect(CANONICAL_FIELDS).toContain('percent');
      expect(CANONICAL_FIELDS).toContain('playCount');
      expect(CANONICAL_FIELDS).toContain('lastPlayed');
      expect(CANONICAL_FIELDS).toContain('watchTime');
    });

    it('should NOT contain legacy fields', () => {
      expect(CANONICAL_FIELDS).not.toContain('seconds');
      expect(CANONICAL_FIELDS).not.toContain('mediaDuration');
      expect(CANONICAL_FIELDS).not.toContain('time');
    });

    it('should be frozen (immutable)', () => {
      expect(Object.isFrozen(CANONICAL_FIELDS)).toBe(true);
    });
  });

  describe('LEGACY_FIELDS', () => {
    it('should contain deprecated fields', () => {
      expect(LEGACY_FIELDS).toContain('seconds');
      expect(LEGACY_FIELDS).toContain('mediaDuration');
      expect(LEGACY_FIELDS).toContain('time');
    });

    it('should contain metadata fields that do not belong', () => {
      expect(LEGACY_FIELDS).toContain('title');
      expect(LEGACY_FIELDS).toContain('parent');
      expect(LEGACY_FIELDS).toContain('grandparent');
    });

    it('should be frozen (immutable)', () => {
      expect(Object.isFrozen(LEGACY_FIELDS)).toBe(true);
    });
  });

  describe('LEGACY_TO_CANONICAL', () => {
    it('should map seconds to playhead', () => {
      expect(LEGACY_TO_CANONICAL.seconds).toBe('playhead');
    });

    it('should map mediaDuration to duration', () => {
      expect(LEGACY_TO_CANONICAL.mediaDuration).toBe('duration');
    });

    it('should map time to lastPlayed', () => {
      expect(LEGACY_TO_CANONICAL.time).toBe('lastPlayed');
    });

    it('should be frozen (immutable)', () => {
      expect(Object.isFrozen(LEGACY_TO_CANONICAL)).toBe(true);
    });
  });

  describe('validateCanonicalSchema()', () => {
    it('should return valid=true and legacyFields=[] for canonical data', () => {
      const canonicalData = {
        playhead: 120,
        duration: 3600,
        percent: 3.33,
        playCount: 1,
        lastPlayed: '2026-01-15T10:30:00Z',
        watchTime: 120
      };

      const result = validateCanonicalSchema(canonicalData);

      expect(result.valid).toBe(true);
      expect(result.legacyFields).toEqual([]);
    });

    it('should return valid=true for partial canonical data', () => {
      const partialData = {
        playhead: 60,
        percent: 50
      };

      const result = validateCanonicalSchema(partialData);

      expect(result.valid).toBe(true);
      expect(result.legacyFields).toEqual([]);
    });

    it('should detect seconds as a legacy field', () => {
      const dataWithSeconds = {
        seconds: 120,
        duration: 3600
      };

      const result = validateCanonicalSchema(dataWithSeconds);

      expect(result.valid).toBe(false);
      expect(result.legacyFields).toContain('seconds');
    });

    it('should detect mediaDuration as a legacy field', () => {
      const dataWithMediaDuration = {
        playhead: 120,
        mediaDuration: 3600
      };

      const result = validateCanonicalSchema(dataWithMediaDuration);

      expect(result.valid).toBe(false);
      expect(result.legacyFields).toContain('mediaDuration');
    });

    it('should detect time as a legacy field', () => {
      const dataWithTime = {
        playhead: 120,
        time: 1705312200
      };

      const result = validateCanonicalSchema(dataWithTime);

      expect(result.valid).toBe(false);
      expect(result.legacyFields).toContain('time');
    });

    it('should detect multiple legacy fields at once', () => {
      const dataWithMultipleLegacy = {
        seconds: 120,
        mediaDuration: 3600,
        time: 1705312200,
        percent: 3.33
      };

      const result = validateCanonicalSchema(dataWithMultipleLegacy);

      expect(result.valid).toBe(false);
      expect(result.legacyFields).toContain('seconds');
      expect(result.legacyFields).toContain('mediaDuration');
      expect(result.legacyFields).toContain('time');
      expect(result.legacyFields).toHaveLength(3);
    });

    it('should detect metadata fields like title that do not belong', () => {
      const dataWithMetadata = {
        playhead: 120,
        duration: 3600,
        title: 'Some Movie Title',
        parent: 'Season 1',
        grandparent: 'Show Name'
      };

      const result = validateCanonicalSchema(dataWithMetadata);

      expect(result.valid).toBe(false);
      expect(result.legacyFields).toContain('title');
      expect(result.legacyFields).toContain('parent');
      expect(result.legacyFields).toContain('grandparent');
    });

    it('should return valid=true for null input', () => {
      const result = validateCanonicalSchema(null);

      expect(result.valid).toBe(true);
      expect(result.legacyFields).toEqual([]);
    });

    it('should return valid=true for undefined input', () => {
      const result = validateCanonicalSchema(undefined);

      expect(result.valid).toBe(true);
      expect(result.legacyFields).toEqual([]);
    });

    it('should return valid=true for empty object', () => {
      const result = validateCanonicalSchema({});

      expect(result.valid).toBe(true);
      expect(result.legacyFields).toEqual([]);
    });
  });
});
