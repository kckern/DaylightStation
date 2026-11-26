import { describe, it, expect } from 'vitest';
import { isLongAudio, LONG_AUDIO_MS } from './PlexAdapter.mjs';

// Long audio (talks, lectures, audiobooks) resumes where it was left, like video;
// songs start over. Before this, every Plex track was unresumable.
describe('isLongAudio', () => {
  it('is a track of 20 minutes or more', () => {
    expect(isLongAudio({ type: 'track', duration: LONG_AUDIO_MS })).toBe(true);
    expect(isLongAudio({ type: 'track', duration: 294 * 60_000 })).toBe(true);
  });
  it('is not a song, nor anything that is not a track', () => {
    expect(isLongAudio({ type: 'track', duration: 4 * 60_000 })).toBe(false);
    expect(isLongAudio({ type: 'track' })).toBe(false);
    expect(isLongAudio({ type: 'movie', duration: LONG_AUDIO_MS * 5 })).toBe(false);
    expect(isLongAudio(null)).toBe(false);
  });
});
