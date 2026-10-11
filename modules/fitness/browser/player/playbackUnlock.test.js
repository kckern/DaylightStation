import { describe, expect, it } from 'vitest';
import {
  normalizePlaybackUnlockRules,
  classifyPlaybackUnlock,
  playbackUnlockScope,
  needsLibraryLookup,
  classifySessionRecap,
} from './playbackUnlock.js';

const RULES = normalizePlaybackUnlockRules({ labels: ['KidsFun'], libraries: ['TV Shows'] });

describe('playbackUnlock policy', () => {
  it('reads the lock name and scope from config, not code', () => {
    const r = normalizePlaybackUnlockRules({ lock: 'kids_playback', scope: 'item' });
    expect(r.lock).toBe('kids_playback');
    expect(r.scope).toBe('item');
    expect(normalizePlaybackUnlockRules({}).lock).toBeNull();
    expect(normalizePlaybackUnlockRules({}).scope).toBe('show');
    expect(normalizePlaybackUnlockRules({ prompt_timeout_seconds: 60 }).promptTimeoutMs).toBe(60000);
    expect(normalizePlaybackUnlockRules({}).promptTimeoutMs).toBeNull();
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

  it('reads session_recaps from config', () => {
    expect(normalizePlaybackUnlockRules({ session_recaps: true }).sessionRecaps).toBe(true);
    expect(normalizePlaybackUnlockRules({}).sessionRecaps).toBe(false);
  });
});

describe('classifySessionRecap', () => {
  const fetchFitness = async () => ({ librarySectionTitle: 'Fitness' });

  it('locks a session if any video it played carries a gated label', async () => {
    const media = [{ contentId: 'plex:1', labels: [] }, { contentId: 'plex:2', labels: ['kidsfun'] }];
    expect(await classifySessionRecap(media, RULES, fetchFitness)).toEqual({ required: true, reason: 'label:kidsfun' });
  });

  it('locks a session that played something from the TV Shows library', async () => {
    const media = [{ contentId: 'plex:7', labels: [] }];
    const r = await classifySessionRecap(media, RULES, async () => ({ librarySectionTitle: 'TV Shows' }));
    expect(r).toEqual({ required: true, reason: 'library:tv shows' });
  });

  it('leaves an adult workout session open', async () => {
    const media = [{ contentId: 'plex:696316', labels: [] }];
    expect((await classifySessionRecap(media, RULES, fetchFitness)).required).toBe(false);
  });

  it('fails closed when a lookup errors', async () => {
    const media = [{ contentId: 'plex:9', labels: [] }];
    const r = await classifySessionRecap(media, RULES, async () => { throw new Error('offline'); });
    expect(r.required).toBe(true);
  });

  it('a session with no media is open', async () => {
    expect((await classifySessionRecap([], RULES, fetchFitness)).required).toBe(false);
  });
});
