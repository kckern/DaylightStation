import { describe, it, expect } from 'vitest';
import { startingTargets } from './useStartingOn.js';

const rec = (over) => ({ kind: 'play', distance: 'far', status: 'running', targetId: 'tv', item: { contentId: 'plex:1' }, ...over });

describe('startingTargets (PLAY.1a/AC5)', () => {
  it('finds the screen an item is still starting on', () => {
    expect(startingTargets(new Map([['a', rec()]]), 'plex:1')).toEqual(['tv']);
  });
  it('also reads as starting once sent but not yet confirmed playing', () => {
    expect(startingTargets(new Map([['a', rec({ status: 'success' })]]), 'plex:1')).toEqual(['tv']);
  });
  it('stops once the screen confirmed, or failed, or for another item, an add, or a local play', () => {
    expect(startingTargets(new Map([['a', rec({ status: 'success', outcome: 'confirmed' })]]), 'plex:1')).toEqual([]);
    expect(startingTargets(new Map([['a', rec({ status: 'failed' })]]), 'plex:1')).toEqual([]);
    expect(startingTargets(new Map([['a', rec()]]), 'plex:2')).toEqual([]);
    expect(startingTargets(new Map([['a', rec({ kind: 'add', operation: 'add' })]]), 'plex:1')).toEqual([]);
    expect(startingTargets(new Map([['a', rec({ distance: 'here' })]]), 'plex:1')).toEqual([]);
  });
});
