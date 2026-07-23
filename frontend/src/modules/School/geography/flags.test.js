import { describe, it, expect } from 'vitest';
import { flagFor } from './flags.js';

describe('flagFor', () => {
  it('resolves a known iso (case-insensitive) to a url', () => {
    expect(flagFor('FR')).toBeTruthy();
    expect(flagFor('fr')).toBe(flagFor('FR'));
  });
  it('returns null for an unknown iso', () => {
    expect(flagFor('ZZ')).toBeNull();
  });
});
