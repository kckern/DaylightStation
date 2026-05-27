import { describe, it, expect } from 'vitest';
import { VolumeBounds } from '../../../backend/src/2_domains/playback-hub/value-objects/VolumeBounds.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';
import { DomainInvariantError } from '../../../backend/src/2_domains/core/errors/DomainInvariantError.mjs';

describe('VolumeBounds', () => {
  describe('defaults', () => {
    it('empty input fills defaults default=60, min=0, max=100', () => {
      const v = new VolumeBounds({});
      expect(v.default).toBe(60);
      expect(v.min).toBe(0);
      expect(v.max).toBe(100);
    });

    it('omitted constructor arg also defaults', () => {
      const v = new VolumeBounds();
      expect(v.default).toBe(60);
      expect(v.min).toBe(0);
      expect(v.max).toBe(100);
    });

    it('partial input fills missing defaults', () => {
      const v = new VolumeBounds({ default: 40, max: 70 });
      expect(v.default).toBe(40);
      expect(v.min).toBe(0);
      expect(v.max).toBe(70);
    });
  });

  describe('invariant: 0 <= min <= default <= max <= 100', () => {
    it('rejects min > default (DomainInvariantError)', () => {
      expect(() => new VolumeBounds({ min: 80, default: 50, max: 90 })).toThrow(DomainInvariantError);
    });
    it('rejects default > max (DomainInvariantError)', () => {
      expect(() => new VolumeBounds({ default: 90, max: 50 })).toThrow(DomainInvariantError);
    });
    it('rejects min > max (DomainInvariantError)', () => {
      expect(() => new VolumeBounds({ min: 80, max: 40 })).toThrow(DomainInvariantError);
    });
    it('rejects out-of-range values (ValidationError)', () => {
      expect(() => new VolumeBounds({ min: -1 })).toThrow(ValidationError);
      expect(() => new VolumeBounds({ max: 101 })).toThrow(ValidationError);
      expect(() => new VolumeBounds({ default: -5 })).toThrow(ValidationError);
    });
    it('rejects non-number values (ValidationError)', () => {
      expect(() => new VolumeBounds({ default: '60' })).toThrow(ValidationError);
      expect(() => new VolumeBounds({ min: null })).not.toThrow(); // null → default 0
      expect(() => new VolumeBounds({ max: true })).toThrow(ValidationError);
    });
    it('accepts edge bounds (0 and 100)', () => {
      const v = new VolumeBounds({ min: 0, default: 0, max: 100 });
      expect(v.default).toBe(0);
      const v2 = new VolumeBounds({ min: 100, default: 100, max: 100 });
      expect(v2.default).toBe(100);
    });
    it('rejects non-object input', () => {
      expect(() => new VolumeBounds(null)).toThrow(ValidationError);
      expect(() => new VolumeBounds('40')).toThrow(ValidationError);
      expect(() => new VolumeBounds([])).toThrow(ValidationError);
    });
  });

  describe('clamp', () => {
    it('clamps value above max to max', () => {
      const v = new VolumeBounds({ max: 70 });
      expect(v.clamp(200)).toBe(70);
      expect(v.clamp(71)).toBe(70);
    });
    it('clamps value below min to min', () => {
      const v = new VolumeBounds({ min: 10 });
      expect(v.clamp(-5)).toBe(10);
      expect(v.clamp(9)).toBe(10);
    });
    it('passes through in-range value', () => {
      const v = new VolumeBounds({ min: 10, max: 70 });
      expect(v.clamp(50)).toBe(50);
      expect(v.clamp(10)).toBe(10);
      expect(v.clamp(70)).toBe(70);
    });
  });

  describe('toYaml (sparse-preserving)', () => {
    it('empty input → empty toYaml output', () => {
      expect(new VolumeBounds({}).toYaml()).toEqual({});
    });
    it('partial input → only user-set keys in toYaml output', () => {
      expect(new VolumeBounds({ default: 40, max: 70 }).toYaml())
        .toEqual({ default: 40, max: 70 });
    });
    it('only-default input → only default in toYaml', () => {
      expect(new VolumeBounds({ default: 40 }).toYaml()).toEqual({ default: 40 });
    });
    it('all three keys provided → all three in toYaml', () => {
      expect(new VolumeBounds({ default: 50, min: 10, max: 90 }).toYaml())
        .toEqual({ default: 50, min: 10, max: 90 });
    });
    it('ignores keys outside default/min/max', () => {
      expect(new VolumeBounds({ default: 40, foo: 'bar' }).toYaml())
        .toEqual({ default: 40 });
    });
  });

  describe('equals', () => {
    it('equals by all three resolved values', () => {
      expect(new VolumeBounds({ default: 40, max: 70 }).equals(new VolumeBounds({ default: 40, max: 70 }))).toBe(true);
    });
    it('two sparse forms that resolve to the same values are equal', () => {
      // both resolve to default=60, min=0, max=100
      expect(new VolumeBounds({}).equals(new VolumeBounds({ default: 60 }))).toBe(true);
    });
    it('different default → not equal', () => {
      expect(new VolumeBounds({ default: 40 }).equals(new VolumeBounds({ default: 50 }))).toBe(false);
    });
    it('returns false for non-VolumeBounds', () => {
      expect(new VolumeBounds({}).equals(null)).toBe(false);
      expect(new VolumeBounds({}).equals({ default: 60, min: 0, max: 100 })).toBe(false);
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new VolumeBounds({}))).toBe(true);
  });
});
