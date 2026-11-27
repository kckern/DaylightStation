import { describe, expect, it, vi } from 'vitest';
import { PlexAdapter } from './PlexAdapter.mjs';

/**
 * A search row and the player must name the same artist. getItem shows a track's own
 * performer (originalTitle) before the album artist (grandparentTitle); the search hit
 * did the reverse, so a phone search row said "Audiomachine" and Now playing then said
 * "Paul Dinletir" for the same track.
 */
function plex() {
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const httpClient = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
  return new PlexAdapter({ host: 'http://plex.test:32400', token: 't', logger }, { httpClient, logger });
}

describe('search track artist', () => {
  it('names the track performer first, the album artist as albumArtist', () => {
    const item = plex()._hubResultToTrackItem({
      ratingKey: 171293, title: 'Akkadian Empire', type: 'track',
      parent: 'Chronicles', grandparent: 'Audiomachine', original: 'Paul Dinletir',
    });
    expect(item.metadata.artist).toBe('Paul Dinletir');
    expect(item.metadata.albumArtist).toBe('Audiomachine');
  });

  it('falls back to the album artist when the track has no performer of its own', () => {
    const item = plex()._hubResultToTrackItem({
      ratingKey: 1, title: 'Song', type: 'track', parent: 'Album', grandparent: 'Band', original: null,
    });
    expect(item.metadata.artist).toBe('Band');
  });
});
