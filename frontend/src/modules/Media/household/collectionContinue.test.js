import { describe, it, expect } from 'vitest';
import { buildContinueIndex, continueLabel } from './collectionContinue.js';

const episode = (over = {}) => ({
  contentId: 'plex:507', title: 'Bingo', type: 'episode', parentId: '20', grandparentId: '100',
  parentTitle: 'Season 2', itemIndex: 7, ...over,
});

describe('collectionContinue (FIND.8b/AC2)', () => {
  it('labels an episode by season and episode number', () => {
    expect(continueLabel(episode())).toBe('Continue S2E7');
    expect(continueLabel(episode({ parentIndex: 3, parentTitle: 'Specials' }))).toBe('Continue S3E7');
  });
  it('falls back to plain Continue without numbers, and for non-episodes', () => {
    expect(continueLabel(episode({ itemIndex: null }))).toBe('Continue');
    expect(continueLabel({ type: 'track', title: 'x' })).toBe('Continue');
  });
  it('indexes the show and the season, the newest entry first', () => {
    const index = buildContinueIndex([episode(), episode({ contentId: 'plex:900', itemIndex: 1 })]);
    expect(index.get('plex:100')).toMatchObject({ contentId: 'plex:507', label: 'Continue S2E7' });
    expect(index.get('plex:20')).toMatchObject({ contentId: 'plex:507' });
    expect(index.get('plex:999')).toBeUndefined();
  });
  it('ignores entries that are not episodes of a collection', () => {
    expect(buildContinueIndex([{ contentId: 'plex:1', type: 'movie' }, null]).size).toBe(0);
  });
});
