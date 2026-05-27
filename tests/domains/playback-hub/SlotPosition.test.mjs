import { describe, it, expect } from 'vitest';
import { SlotPosition } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotPosition.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';

describe('SlotPosition', () => {
  it('accepts positive integers', () => {
    const p = new SlotPosition(3);
    expect(p.value).toBe(3);
  });

  it('rejects zero', () => {
    expect(() => new SlotPosition(0)).toThrow(ValidationError);
  });

  it('rejects negatives', () => {
    expect(() => new SlotPosition(-1)).toThrow(ValidationError);
    expect(() => new SlotPosition(-100)).toThrow(ValidationError);
  });

  it('rejects non-integers (floats)', () => {
    expect(() => new SlotPosition(1.5)).toThrow(ValidationError);
    expect(() => new SlotPosition(2.0001)).toThrow(ValidationError);
  });

  it('rejects strings even if numeric-looking', () => {
    expect(() => new SlotPosition('1')).toThrow(ValidationError);
    expect(() => new SlotPosition('3')).toThrow(ValidationError);
  });

  it('rejects null/undefined/NaN/Infinity', () => {
    expect(() => new SlotPosition(null)).toThrow(ValidationError);
    expect(() => new SlotPosition(undefined)).toThrow(ValidationError);
    expect(() => new SlotPosition(NaN)).toThrow(ValidationError);
    expect(() => new SlotPosition(Infinity)).toThrow(ValidationError);
  });

  it('equals by value', () => {
    expect(new SlotPosition(2).equals(new SlotPosition(2))).toBe(true);
    expect(new SlotPosition(2).equals(new SlotPosition(3))).toBe(false);
  });

  it('equals returns false for non-SlotPosition', () => {
    expect(new SlotPosition(2).equals(2)).toBe(false);
    expect(new SlotPosition(2).equals(null)).toBe(false);
    expect(new SlotPosition(2).equals('2')).toBe(false);
  });

  it('is frozen', () => {
    const p = new SlotPosition(1);
    expect(Object.isFrozen(p)).toBe(true);
  });
});
