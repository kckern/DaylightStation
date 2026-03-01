import { describe, it, expect } from 'vitest';
import { normalizeDuration } from '#frontend/modules/Player/utils/mediaIdentity.js';

describe('normalizeDuration', () => {

  // ── Basic conversion ──────────────────────────────────────────────
  describe('basic conversion', () => {
    it('returns a numeric value in seconds as-is (rounded)', () => {
      expect(normalizeDuration(30)).toBe(30);
      expect(normalizeDuration(120)).toBe(120);
    });

    it('rounds fractional seconds', () => {
      expect(normalizeDuration(30.4)).toBe(30);
      expect(normalizeDuration(30.6)).toBe(31);
      expect(normalizeDuration(59.5)).toBe(60);
    });

    it('converts milliseconds (>1000) to seconds', () => {
      expect(normalizeDuration(60000)).toBe(60);
      expect(normalizeDuration(1800000)).toBe(1800);
    });

    it('rounds millisecond-to-second conversion', () => {
      expect(normalizeDuration(60499)).toBe(60);
      expect(normalizeDuration(60500)).toBe(61);
    });

    it('parses string values', () => {
      expect(normalizeDuration('30')).toBe(30);
      expect(normalizeDuration('1800000')).toBe(1800);
      expect(normalizeDuration('45.7')).toBe(46);
    });

    it('returns null for null and undefined', () => {
      expect(normalizeDuration(null)).toBe(null);
      expect(normalizeDuration(undefined)).toBe(null);
    });

    it('returns null when called with no arguments', () => {
      expect(normalizeDuration()).toBe(null);
    });

    it('returns null for NaN', () => {
      expect(normalizeDuration(NaN)).toBe(null);
    });

    it('returns null for Infinity and -Infinity', () => {
      expect(normalizeDuration(Infinity)).toBe(null);
      expect(normalizeDuration(-Infinity)).toBe(null);
    });

    it('returns null for zero', () => {
      expect(normalizeDuration(0)).toBe(null);
    });

    it('returns null for negative values', () => {
      expect(normalizeDuration(-5)).toBe(null);
      expect(normalizeDuration(-1000)).toBe(null);
    });

    it('returns null for non-numeric strings', () => {
      expect(normalizeDuration('abc')).toBe(null);
      expect(normalizeDuration('')).toBe(null);
    });
  });

  // ── Two-pass threshold (Bug A fix) ────────────────────────────────
  describe('two-pass threshold logic', () => {
    it('prefers a candidate >= 10s over a small placeholder that comes first', () => {
      // Plex placeholder "2" (season number) comes first, real duration in ms comes second
      expect(normalizeDuration(2, 1800000)).toBe(1800);
      // Second candidate is in seconds and >= 10
      expect(normalizeDuration(5, 120)).toBe(120);
    });

    it('prefers candidate >= 10s even when small value is first of several', () => {
      expect(normalizeDuration(5, 3, 120)).toBe(120);
    });

    it('falls back to small value when no candidate >= 10s exists', () => {
      expect(normalizeDuration(2)).toBe(2);
      expect(normalizeDuration(5)).toBe(5);
      expect(normalizeDuration(1)).toBe(1);
    });

    it('falls back to the first small value when multiple small candidates exist', () => {
      expect(normalizeDuration(3, 7)).toBe(3);
    });

    it('accepts exactly 10s on the first pass (boundary)', () => {
      expect(normalizeDuration(10)).toBe(10);
      expect(normalizeDuration(5, 10)).toBe(10);
    });

    it('rejects 9s on the first pass but accepts on fallback', () => {
      expect(normalizeDuration(9, 15)).toBe(15);
      expect(normalizeDuration(9)).toBe(9);
    });

    it('handles real-world Plex placeholder values', () => {
      // Season number "2" as placeholder, real duration 1710s (~28.5min workout)
      expect(normalizeDuration(2, 1710000)).toBe(1710);

      // Season "10" looks plausible at 10s but real duration is larger
      expect(normalizeDuration(10, 1500000)).toBe(10);

      // Season "15" and "17" are >= threshold, accepted on first pass
      expect(normalizeDuration(15, 1800000)).toBe(15);
      expect(normalizeDuration(17, 1800000)).toBe(17);
    });

    it('skips null candidates when searching for >= 10s match', () => {
      expect(normalizeDuration(null, undefined, 30)).toBe(30);
    });

    it('skips invalid candidates in both passes', () => {
      expect(normalizeDuration(null, 'abc', -5, 25)).toBe(25);
      expect(normalizeDuration(null, 'abc', -5, 3)).toBe(3);
    });
  });

  // ── Millisecond detection (>1000 heuristic) ───────────────────────
  describe('millisecond detection boundary', () => {
    it('treats 1000 as seconds (not milliseconds)', () => {
      // 1000 is NOT > 1000, so treated as seconds
      expect(normalizeDuration(1000)).toBe(1000);
    });

    it('treats 1001 as milliseconds', () => {
      // 1001 > 1000, so divided by 1000 and rounded
      expect(normalizeDuration(1001)).toBe(1);
    });

    it('treats 999 as seconds', () => {
      expect(normalizeDuration(999)).toBe(999);
    });

    it('converts typical millisecond durations correctly', () => {
      expect(normalizeDuration(30000)).toBe(30);
      expect(normalizeDuration(5400000)).toBe(5400); // 90 minutes
    });

    it('treats ambiguous values (1001-9999) as milliseconds, yielding small seconds', () => {
      // 1800 is > 1000 so treated as 1800ms -> 2s, NOT as 1800 seconds
      expect(normalizeDuration(1800)).toBe(2);
      // 5000 -> 5s
      expect(normalizeDuration(5000)).toBe(5);
    });
  });

  // ── Candidate priority ────────────────────────────────────────────
  describe('candidate priority', () => {
    it('returns the first valid candidate >= 10s', () => {
      expect(normalizeDuration(30, 60, 90)).toBe(30);
    });

    it('skips null/undefined to find the first valid candidate', () => {
      expect(normalizeDuration(null, undefined, 45)).toBe(45);
    });

    it('skips invalid strings to find valid candidate', () => {
      expect(normalizeDuration('not-a-number', 120)).toBe(120);
    });

    it('skips zero and negative to find valid candidate', () => {
      expect(normalizeDuration(0, -10, 60)).toBe(60);
    });

    it('respects candidate order in fallback pass too', () => {
      // All below threshold; fallback picks the first valid one
      expect(normalizeDuration(3, 7, 2)).toBe(3);
    });

    it('handles mix of types across candidates', () => {
      // '1800' is > 1000 so treated as ms -> 2s (below threshold); 30 is >= 10
      expect(normalizeDuration(null, '1800', 30)).toBe(30);
      // '1800000' is ms -> 1800s; picked first since >= 10
      expect(normalizeDuration(null, '1800000', 30)).toBe(1800);
    });
  });
});
