import { describe, it, expect } from 'vitest';
import { cropFocus } from './artModes.js';

describe('cropFocus — per-item crop_anchor sanitizer (object-position)', () => {
  it('accepts 1–2 keywords', () => {
    expect(cropFocus('top')).toBe('top');
    expect(cropFocus('TOP left')).toBe('top left');
    expect(cropFocus('  center  ')).toBe('center');
  });

  it('accepts percentages', () => {
    expect(cropFocus('50% 20%')).toBe('50% 20%');
    expect(cropFocus('left 0%')).toBe('left 0%');
  });

  it('rejects anything else (no arbitrary CSS leaks through)', () => {
    expect(cropFocus('url(x)')).toBeNull();
    expect(cropFocus('top; color:red')).toBeNull();
    expect(cropFocus('')).toBeNull();
    expect(cropFocus(undefined)).toBeNull();
    expect(cropFocus(12)).toBeNull();
  });

  it('caps at two tokens', () => {
    expect(cropFocus('top left right')).toBe('top left');
  });
});
