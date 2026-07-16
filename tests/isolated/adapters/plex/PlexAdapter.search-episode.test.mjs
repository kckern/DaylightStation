import { describe, it, expect } from 'vitest';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';

// Build an adapter whose PlexClient is stubbed to return one episode hub result
// and no playlists. Mirrors the real "Think! How Intelligent Are Animals?" case.
function adapterWithEpisodeHit() {
  const a = new PlexAdapter({ host: 'http://x', token: 't' }, { httpClient: { get: async () => ({}) } });
  a.client = {
    hubSearch: async () => ({
      results: [{
        ratingKey: '381439',
        type: 'episode',
        title: 'Think! How Intelligent Are Animals?',
        parent: 'Season 1',
        grandparent: 'Zoology: Understanding the Animal World',
        year: 2022,
        thumb: '/library/metadata/381439/thumb',
        librarySectionID: '3',
        librarySectionTitle: 'Science',
      }],
    }),
    // No playlists in this scenario.
    getContainer: async () => ({ MediaContainer: { Metadata: [] } }),
  };
  return a;
}

describe('PlexAdapter tier-1 search — episodes', () => {
  it('returns an exact-title episode as a playable leaf', async () => {
    const a = adapterWithEpisodeHit();
    const { items } = await a.search({ text: 'Think! How Intelligent Are Animals?' });
    const ep = items.find(i => i.id === 'plex:381439');
    expect(ep).toBeTruthy();
    expect(ep.title).toBe('Think! How Intelligent Are Animals?');
    expect(ep.metadata.type).toBe('episode');
    expect(ep.metadata.grandparentTitle).toBe('Zoology: Understanding the Animal World');
    expect(ep.mediaUrl).toBe('/api/v1/proxy/plex/stream/381439');
  });
});
