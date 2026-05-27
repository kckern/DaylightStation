import { describe, it, expect } from 'vitest';
import { SlotColor } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotColor.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';

describe('SlotColor', () => {
  it('accepts non-empty lowercase strings', () => {
    expect(new SlotColor('red').value).toBe('red');
    expect(new SlotColor('white').value).toBe('white');
    expect(new SlotColor('yellow').value).toBe('yellow');
  });

  it('rejects empty string', () => {
    expect(() => new SlotColor('')).toThrow(ValidationError);
  });

  it('rejects non-string types', () => {
    expect(() => new SlotColor(42)).toThrow(ValidationError);
    expect(() => new SlotColor(null)).toThrow(ValidationError);
    expect(() => new SlotColor(undefined)).toThrow(ValidationError);
    expect(() => new SlotColor({})).toThrow(ValidationError);
    expect(() => new SlotColor([])).toThrow(ValidationError);
  });

  it('rejects mixed-case (forces lowercase canonical form)', () => {
    expect(() => new SlotColor('Red')).toThrow(ValidationError);
    expect(() => new SlotColor('RED')).toThrow(ValidationError);
    expect(() => new SlotColor('rEd')).toThrow(ValidationError);
  });

  it('equals by value', () => {
    expect(new SlotColor('red').equals(new SlotColor('red'))).toBe(true);
    expect(new SlotColor('red').equals(new SlotColor('blue'))).toBe(false);
  });

  it('equals returns false for non-SlotColor', () => {
    expect(new SlotColor('red').equals('red')).toBe(false);
    expect(new SlotColor('red').equals(null)).toBe(false);
  });

  it('toString returns underlying string', () => {
    expect(new SlotColor('red').toString()).toBe('red');
    expect(`${new SlotColor('blue')}`).toBe('blue');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new SlotColor('red'))).toBe(true);
  });
});
