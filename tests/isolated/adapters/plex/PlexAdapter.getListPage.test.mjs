import { describe, it, expect } from 'vitest';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';

// A 2810-title section costs Plex 7 s and 6.8 MB whole; one 50-title page with
// X-Plex-Container-Start/Size costs ~0.1 s and reports totalSize. getListPage
// pages path-style containers only; anything else returns null so the caller
// falls back to getList (and keeps whole-container semantics).
function adapterRecording(container) {
  const a = new PlexAdapter({ host: 'http://x', token: 't' }, { httpClient: { get: async () => ({}) } });
  const calls = [];
  a.client = {
    getContainer: async (path) => { calls.push(path); return { MediaContainer: container }; },
    getMetadata: async () => { throw new Error('getListPage must not probe numeric ids'); },
  };
  return { a, calls };
}

const movies = [
  { ratingKey: '55854', type: 'movie', title: 'Arrival', duration: 6983000 },
  { ratingKey: '55875', type: 'movie', title: 'Another', duration: 5400000 },
];

describe('PlexAdapter.getListPage', () => {
  it('asks Plex for one window of a section and returns its items with the true total', async () => {
    const { a, calls } = adapterRecording({ size: 2, totalSize: 2810, offset: 100, Metadata: movies });
    const page = await a.getListPage('plex:library/sections/6/all', { skip: 100, take: 50 });
    expect(calls).toEqual(['/library/sections/6/all?X-Plex-Container-Start=100&X-Plex-Container-Size=50']);
    expect(page.total).toBe(2810);
    expect(page.items.map(i => i.id)).toEqual(['plex:55854', 'plex:55875']);
    expect(page.items[0].title).toBe('Arrival');
  });

  it('keeps an existing query string on the path', async () => {
    const { a, calls } = adapterRecording({ size: 0, totalSize: 0, Metadata: [] });
    await a.getListPage('library/sections/6/all?label=kids', { skip: 0, take: 50 });
    expect(calls).toEqual(['/library/sections/6/all?label=kids&X-Plex-Container-Start=0&X-Plex-Container-Size=50']);
  });

  it('falls back to the page length when Plex omits totalSize', async () => {
    const { a } = adapterRecording({ size: 2, Metadata: movies });
    expect((await a.getListPage('library/sections/6/all', { skip: 0, take: 50 })).total).toBe(2);
  });

  it.each([
    ['numeric id (show/season/playlist/collection)', '603856'],
    ['section root', ''],
    ['section type alias', 'video'],
    ['playlists root', 'playlists'],
  ])('returns null for a %s so the caller keeps whole-container semantics', async (_label, id) => {
    const { a, calls } = adapterRecording({ Metadata: movies });
    expect(await a.getListPage(id, { skip: 0, take: 50 })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('getItem on a path container asks only for the header, not every title', async () => {
    // Every /list request also calls getItem for the container title. Fetching
    // the whole 2810-title section for that cost the same 7 s paging saved.
    const { a, calls } = adapterRecording({ size: 0, totalSize: 2791, title1: 'Movies', Metadata: [] });
    const item = await a.getItem('plex:library/sections/6/all');
    expect(calls).toEqual(['/library/sections/6/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0']);
    expect(item.title).toBe('Movies');
    expect(item.childCount).toBe(2791);
  });

  it('returns null when Plex fails, so the caller can fall back', async () => {
    const a = new PlexAdapter({ host: 'http://x', token: 't' }, { httpClient: { get: async () => ({}) } });
    a.client = { getContainer: async () => { throw new Error('boom'); } };
    expect(await a.getListPage('library/sections/6/all', { skip: 0, take: 50 })).toBeNull();
  });
});
