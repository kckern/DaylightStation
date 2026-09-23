import { describe, expect, it } from 'vitest';
import { hashString, seededShuffle } from './index.mjs';

describe('seeding helpers', () => {
  it('hashes deterministically to an unsigned 32-bit value', () => {
    expect(hashString('gawi|2026-09-22')).toBe(hashString('gawi|2026-09-22'));
    expect(hashString('gawi|2026-09-22')).not.toBe(hashString('gawi|2026-09-23'));
    const h = hashString('가위');
    expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
  });
  it('shuffles deterministically and never loses items', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(seededShuffle(items, 42)).toEqual(seededShuffle(items, 42));
    expect([...seededShuffle(items, 42)].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
