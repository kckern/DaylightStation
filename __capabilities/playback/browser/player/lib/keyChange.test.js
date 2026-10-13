import { describe, it, expect } from 'vitest';
import { changedKeyComponent } from './keyChange.js';

describe('changedKeyComponent', () => {
  it('names the single input that moved', () => {
    expect(changedKeyComponent({ guid: 'plex:1', nonce: 0 }, { guid: 'plex:2', nonce: 0 })).toBe('guid');
    expect(changedKeyComponent({ guid: 'plex:1', nonce: 0 }, { guid: 'plex:1', nonce: 1 })).toBe('nonce');
  });

  it('names every input that moved, in the order the key declares them', () => {
    const previous = { mediaUrl: '/a.mpd', bitrate: 'unlimited', elementKey: 0 };
    const next = { mediaUrl: '/b.mpd', bitrate: 4000, elementKey: 0 };
    expect(changedKeyComponent(previous, next)).toBe('mediaUrl+bitrate');
  });

  it('returns null when nothing moved, so the caller can stay quiet', () => {
    expect(changedKeyComponent({ guid: 'plex:1', nonce: 3 }, { guid: 'plex:1', nonce: 3 })).toBeNull();
  });

  it('returns null when there is no baseline to compare against', () => {
    // The first key of a run is not a change, and calling it one would put a
    // fabricated `from` in the log — the exact class of field this work removes.
    expect(changedKeyComponent(null, { guid: 'plex:1', nonce: 0 })).toBeNull();
  });

  it('does not confuse a null identity with a missing one', () => {
    // `guid: null` is a measured absence (nothing is loaded); it must still read
    // as a move when real content arrives.
    expect(changedKeyComponent({ guid: null, nonce: 0 }, { guid: 'plex:1', nonce: 0 })).toBe('guid');
    expect(changedKeyComponent({ guid: null, nonce: 0 }, { guid: null, nonce: 0 })).toBeNull();
  });
});
