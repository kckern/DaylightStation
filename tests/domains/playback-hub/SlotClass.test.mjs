import { describe, it, expect } from 'vitest';
import { SlotClass } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotClass.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';

describe('SlotClass', () => {
  it('accepts "private"', () => {
    const c = new SlotClass('private');
    expect(c.value).toBe('private');
  });

  it('accepts "public"', () => {
    const c = new SlotClass('public');
    expect(c.value).toBe('public');
  });

  it('rejects unknown values', () => {
    expect(() => new SlotClass('hybrid')).toThrow(ValidationError);
    expect(() => new SlotClass('shared')).toThrow(ValidationError);
    expect(() => new SlotClass('')).toThrow(ValidationError);
  });

  it('rejects mixed-case', () => {
    expect(() => new SlotClass('Private')).toThrow(ValidationError);
    expect(() => new SlotClass('PUBLIC')).toThrow(ValidationError);
  });

  it('rejects non-strings', () => {
    expect(() => new SlotClass(null)).toThrow(ValidationError);
    expect(() => new SlotClass(undefined)).toThrow(ValidationError);
    expect(() => new SlotClass(0)).toThrow(ValidationError);
  });

  it('isPrivate getter', () => {
    expect(new SlotClass('private').isPrivate).toBe(true);
    expect(new SlotClass('public').isPrivate).toBe(false);
  });

  it('isPublic getter', () => {
    expect(new SlotClass('public').isPublic).toBe(true);
    expect(new SlotClass('private').isPublic).toBe(false);
  });

  it('equals by value', () => {
    expect(new SlotClass('private').equals(new SlotClass('private'))).toBe(true);
    expect(new SlotClass('private').equals(new SlotClass('public'))).toBe(false);
    expect(new SlotClass('private').equals('private')).toBe(false);
    expect(new SlotClass('private').equals(null)).toBe(false);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new SlotClass('private'))).toBe(true);
  });
});
