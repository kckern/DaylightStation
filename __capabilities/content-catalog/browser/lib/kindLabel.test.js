import { describe, it, expect } from 'vitest';
import { kindLabel } from './kindLabel.js';

// Owner report 2026-11-27: Plex audiobooks read "Track" everywhere
// ("Track • Boethius", "Track · 9 hr 5 min"). Label by library kind.
describe('kindLabel', () => {
  const inSection = (type, section) => ({ type, metadata: { type, librarySectionTitle: section } });
  it('a track in an audiobook library is an Audiobook; in music a Song', () => {
    expect(kindLabel(inSection('track', 'Audiobooks'))).toBe('Audiobook');
    expect(kindLabel(inSection('track', 'Music'))).toBe('Song');
    expect(kindLabel({ type: 'track' })).toBe('Song');
  });
  it('an audiobook album is a Book and its artist an Author', () => {
    expect(kindLabel(inSection('album', 'Audiobooks'))).toBe('Book');
    expect(kindLabel(inSection('artist', 'Audiobooks'))).toBe('Author');
    expect(kindLabel(inSection('album', 'Music'))).toBe('Album');
    expect(kindLabel(inSection('artist', 'Music'))).toBe('Artist');
  });
  it('films, episodes and shows by their kind', () => {
    expect(kindLabel({ type: 'movie' })).toBe('Film');
    expect(kindLabel({ type: 'episode' })).toBe('Episode');
    expect(kindLabel({ type: 'show' })).toBe('TV Show');
    expect(kindLabel({ metadata: { type: 'season' } })).toBe('Season');
  });
  it('anything else is its type, capitalised; nothing is null', () => {
    expect(kindLabel({ type: 'playlist' })).toBe('Playlist');
    expect(kindLabel({})).toBeNull();
    expect(kindLabel(null)).toBeNull();
  });
});
