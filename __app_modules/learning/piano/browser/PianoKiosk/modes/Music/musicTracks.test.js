import { describe, it, expect } from 'vitest';
import { toMusicTracks, formatTime } from './musicTracks.js';

describe('toMusicTracks', () => {
  it('maps the Plex hierarchy and drops items without mediaUrl', () => {
    const out = toMusicTracks({ items: [
      { contentId: 'plex:1', title: 'A', mediaUrl: '/u1', grandparentTitle: 'Bach', parentTitle: 'Album', duration: 216, image: 'x' },
      { title: 'no-url' },
      { contentId: 'plex:2', title: 'B', mediaUrl: '/u2', grandparentTitle: 'Bach' },
    ] });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ contentId: 'plex:1', title: 'A', artist: 'Bach', album: 'Album', duration: 216, image: 'x', index: 1 });
    expect(out[1]).toMatchObject({ contentId: 'plex:2', title: 'B', artist: 'Bach', index: 2 });
  });
  it('is empty for a malformed response', () => {
    expect(toMusicTracks(null)).toEqual([]);
    expect(toMusicTracks({})).toEqual([]);
  });
});

describe('formatTime', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(84)).toBe('1:24');
    expect(formatTime(3725)).toBe('1:02:05');
  });
  it('guards non-finite/negative', () => {
    expect(formatTime(undefined)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });
});
