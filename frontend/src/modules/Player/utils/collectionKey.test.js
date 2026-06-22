import { describe, it, expect } from 'vitest';
import { resolveCollectionKey } from './collectionKey.js';

describe('resolveCollectionKey', () => {
  it('keys a TV/lecture series by grandparent/parent title', () => {
    expect(resolveCollectionKey({ grandparentTitle: 'Peterson Academy', parentTitle: 'Sermon on the Mount' }))
      .toBe('peterson academy/sermon on the mount');
  });
  it('keys music by artist/album', () => {
    expect(resolveCollectionKey({ artist: 'Bach', album: 'Cello Suites' }))
      .toBe('bach/cello suites');
  });
  it('falls back to whichever level exists', () => {
    expect(resolveCollectionKey({ grandparentTitle: 'The Office' })).toBe('the office');
    expect(resolveCollectionKey({ parentTitle: 'Season 2' })).toBe('season 2');
  });
  it('returns null when there is no collection metadata', () => {
    expect(resolveCollectionKey({ title: 'One-off clip' })).toBeNull();
    expect(resolveCollectionKey(null)).toBeNull();
    expect(resolveCollectionKey({ grandparentTitle: '  ' })).toBeNull();
  });
});
