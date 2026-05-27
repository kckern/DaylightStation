import { describe, it, expect } from 'vitest';
import { CommandResult } from '../../../backend/src/2_domains/playback-hub/value-objects/CommandResult.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';

describe('CommandResult', () => {
  describe('constructor', () => {
    it('accepts empty applied + empty skipped', () => {
      const r = new CommandResult({ applied: [], skipped: [] });
      expect(r.applied).toEqual([]);
      expect(r.skipped).toEqual([]);
    });
    it('defaults applied + skipped to empty arrays', () => {
      const r = new CommandResult({});
      expect(r.applied).toEqual([]);
      expect(r.skipped).toEqual([]);
    });
    it('accepts applied list of color strings', () => {
      const r = new CommandResult({ applied: ['red', 'blue'], skipped: [] });
      expect(r.applied).toEqual(['red', 'blue']);
    });
    it('accepts skipped entries with allowed reasons', () => {
      for (const reason of ['not-found', 'unreachable', 'contention', 'volume-out-of-bounds', 'invalid-target']) {
        const r = new CommandResult({ applied: [], skipped: [{ color: 'red', reason }] });
        expect(r.skipped[0].reason).toBe(reason);
      }
    });
    it('rejects unknown reason', () => {
      expect(() => new CommandResult({ applied: [], skipped: [{ color: 'red', reason: 'unknown' }] }))
        .toThrow(ValidationError);
      expect(() => new CommandResult({ applied: [], skipped: [{ color: 'red', reason: '' }] }))
        .toThrow(ValidationError);
    });
    it('rejects skipped entry missing color', () => {
      expect(() => new CommandResult({ applied: [], skipped: [{ reason: 'not-found' }] }))
        .toThrow(ValidationError);
    });
    it('rejects skipped entry with non-string color', () => {
      expect(() => new CommandResult({ applied: [], skipped: [{ color: 42, reason: 'not-found' }] }))
        .toThrow(ValidationError);
    });
    it('rejects non-array applied/skipped', () => {
      expect(() => new CommandResult({ applied: 'red', skipped: [] })).toThrow(ValidationError);
      expect(() => new CommandResult({ applied: [], skipped: 'x' })).toThrow(ValidationError);
    });
  });

  describe('allApplied / allSkipped', () => {
    it('allApplied true when applied non-empty AND skipped empty', () => {
      const r = new CommandResult({ applied: ['red'], skipped: [] });
      expect(r.allApplied()).toBe(true);
      expect(r.allSkipped()).toBe(false);
    });
    it('allSkipped true when applied empty', () => {
      const r = new CommandResult({ applied: [], skipped: [{ color: 'red', reason: 'contention' }] });
      expect(r.allApplied()).toBe(false);
      expect(r.allSkipped()).toBe(true);
    });
    it('mixed result is neither all-applied nor all-skipped', () => {
      const r = new CommandResult({ applied: ['red'], skipped: [{ color: 'blue', reason: 'unreachable' }] });
      expect(r.allApplied()).toBe(false);
      expect(r.allSkipped()).toBe(false);
    });
    it('empty result: allApplied=false, allSkipped=true', () => {
      const r = new CommandResult({ applied: [], skipped: [] });
      expect(r.allApplied()).toBe(false);
      expect(r.allSkipped()).toBe(true);
    });
  });

  describe('REASONS static', () => {
    it('exposes the closed reason enum', () => {
      expect(CommandResult.REASONS).toEqual(
        ['not-found', 'unreachable', 'contention', 'volume-out-of-bounds', 'invalid-target']
      );
    });
    it('returns a copy (mutation does not leak)', () => {
      const reasons = CommandResult.REASONS;
      reasons.push('mutated');
      expect(CommandResult.REASONS).not.toContain('mutated');
    });
  });

  it('applied/skipped arrays are frozen (cannot be mutated externally)', () => {
    const r = new CommandResult({ applied: ['red'], skipped: [{ color: 'blue', reason: 'contention' }] });
    expect(() => r.applied.push('green')).toThrow();
    expect(() => r.skipped.push({ color: 'x', reason: 'contention' })).toThrow();
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new CommandResult({}))).toBe(true);
  });
});
