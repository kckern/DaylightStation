import { describe, it, expect } from 'vitest';
import { practiceKeyOf, bucketOf } from './practiceKey.js';

describe('practiceKeyOf', () => {
  it('slugs a content id to a dot-free lowercase key', () => {
    expect(practiceKeyOf('files:docs/sheet-music/Fur-Elise.musicxml'))
      .toBe('files-docs-sheet-music-fur-elise-musicxml');
  });
  it('trims and caps at 120', () => {
    expect(practiceKeyOf(':x:')).toBe('x');
    expect(practiceKeyOf('a'.repeat(200)).length).toBe(120);
  });
});

describe('bucketOf', () => {
  it('grand staff maps hands to buckets', () => {
    expect(bucketOf(true, { 0: true, 1: true })).toBe('both');
    expect(bucketOf(true, { 0: true, 1: false })).toBe('rh');
    expect(bucketOf(true, { 0: false, 1: true })).toBe('lh');
  });
  it('non-grand-staff collapses to both', () => {
    expect(bucketOf(false, { 0: true, 1: false, 2: true })).toBe('both');
  });
});
