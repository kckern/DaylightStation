import { describe, it, expect } from 'vitest';
import { staleClaims } from './staleClaims.js';

const MIN = 60 * 1000;
const NOW = 100 * MIN;

describe('staleClaims', () => {
  it('returns a bike active 31 minutes ago but not one active 29 minutes ago', () => {
    const bikes = [
      { id: 'old', rider: 'rider-a', lastActiveMs: NOW - 31 * MIN },
      { id: 'fresh', rider: 'rider-a', lastActiveMs: NOW - 29 * MIN },
    ];
    expect(staleClaims(bikes, NOW)).toEqual(['old']);
  });
  it('unknown activity is not stale', () => {
    expect(staleClaims([{ id: 'x', rider: 'rider-a' }, { id: 'y', rider: 'rider-a', lastActiveMs: null }], NOW)).toEqual([]);
  });
  it('a bike with no rider is never returned', () => {
    expect(staleClaims([{ id: 'x', rider: null, lastActiveMs: 0 }, { id: 'y', lastActiveMs: 0 }], NOW)).toEqual([]);
  });
  it('non-finite nowMs returns []', () => {
    const bikes = [{ id: 'x', rider: 'rider-a', lastActiveMs: 0 }];
    expect(staleClaims(bikes, NaN)).toEqual([]);
    expect(staleClaims(bikes, undefined)).toEqual([]);
    expect(staleClaims(bikes, Infinity)).toEqual([]);
  });
  it('honours a custom maxIdleMs', () => {
    const bikes = [{ id: 'x', rider: 'rider-a', lastActiveMs: NOW - 6 * MIN }];
    expect(staleClaims(bikes, NOW, 5 * MIN)).toEqual(['x']);
    expect(staleClaims(bikes, NOW, 10 * MIN)).toEqual([]);
  });
  it('tolerates missing or malformed input', () => {
    expect(staleClaims(undefined, NOW)).toEqual([]);
    expect(staleClaims([null, undefined], NOW)).toEqual([]);
  });
});
