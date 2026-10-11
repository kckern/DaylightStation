import { describe, expect, it } from 'vitest';
import {
  normalizePlaybackUnlockRules,
  classifyPlaybackUnlock,
  playbackUnlockScope,
  needsLibraryLookup,
} from './playbackUnlock.js';

const RULES = normalizePlaybackUnlockRules({ labels: ['KidsFun'], libraries: ['TV Shows'] });

describe('playbackUnlock policy', () => {
  it('reads the lock name and scope from config, not code', () => {
    const r = normalizePlaybackUnlockRules({ lock: 'kids_playback', scope: 'item' });
    expect(r.lock).toBe('kids_playback');
    expect(r.scope).toBe('item');
    expect(normalizePlaybackUnlockRules({}).lock).toBeNull();
    expect(normalizePlaybackUnlockRules({}).scope).toBe('show');
  });

  it('requires an unlock for a KidsFun item regardless of label case', () => {
    expect(classifyPlaybackUnlock({ labels: ['kidsfun'] }, RULES))
      .toEqual({ required: true, reason: 'label:kidsfun' });
  });

  it('requires an unlock for anything from the TV Shows library', () => {
    expect(classifyPlaybackUnlock({ labels: [], librarySectionTitle: 'TV Shows' }, RULES))
      .toEqual({ required: true, reason: 'library:tv shows' });
  });

  it('leaves adult workout content alone', () => {
    expect(classifyPlaybackUnlock({ labels: ['Resumable'], librarySectionTitle: 'Fitness' }, RULES))
      .toEqual({ required: false, reason: null });
  });

  it('is off when no rules are configured', () => {
    const none = normalizePlaybackUnlockRules(null);
    expect(classifyPlaybackUnlock({ labels: ['KidsFun'], librarySectionTitle: 'TV Shows' }, none).required).toBe(false);
  });

  it('only needs a library lookup when the labels did not already decide it', () => {
    expect(needsLibraryLookup({ labels: ['KidsFun'] }, RULES)).toBe(false);
    expect(needsLibraryLookup({ labels: [] }, RULES)).toBe(true);
    expect(needsLibraryLookup({ labels: [], librarySectionTitle: 'Fitness' }, RULES)).toBe(false);
    expect(needsLibraryLookup({ labels: [] }, normalizePlaybackUnlockRules({ labels: ['KidsFun'] }))).toBe(false);
  });

  it('scopes one unlock to the show, so the next episode does not re-prompt', () => {
    const ep1 = { id: '1', contentId: 'plex:1', grandparentId: '663508' };
    const ep2 = { id: '2', contentId: 'plex:2', grandparentId: '663508' };
    expect(playbackUnlockScope(ep1)).toBe(playbackUnlockScope(ep2));
    expect(playbackUnlockScope({ id: 'movie-9', contentId: 'plex:9' })).toBe('plex:9');
    expect(playbackUnlockScope(ep1, 'item')).not.toBe(playbackUnlockScope(ep2, 'item'));
  });
});
