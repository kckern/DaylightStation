import { describe, it, expect } from 'vitest';
import { folderKey, sameLength, normalizeChapters } from './trackChapters.mjs';

describe('folderKey', () => {
  it('matches a Plex file and an Audiobookshelf item mounted at different roots', () => {
    const plex = folderKey('/data/media/audio/audiobooks/David Whyte/2014 Consolations/Consolations.mp3', { isFile: true });
    const abs = folderKey('/audiobooks/Authors/David Whyte/2014 Consolations');
    expect(plex).toBe('david whyte/2014 consolations');
    expect(abs).toBe(plex);
  });
  it('refuses paths too short to name author and book', () => {
    expect(folderKey('/book.mp3', { isFile: true })).toBeNull();
    expect(folderKey('')).toBeNull();
    expect(folderKey(null)).toBeNull();
  });
});

describe('sameLength', () => {
  it('allows two seconds either way', () => {
    expect(sameLength(13039125, 13039000)).toBe(true);
    expect(sameLength(13039125, 13042000)).toBe(false);
    expect(sameLength(0, 0)).toBe(false);
  });
});

describe('normalizeChapters', () => {
  const abs = [{ start: 0, end: 60.5, title: 'Opening' }, { start: 60.5, end: 120, title: 'Two' }];
  it('turns Audiobookshelf seconds into ms', () => {
    expect(normalizeChapters(abs, 120000)).toEqual({ chapters: [
      { startMs: 0, endMs: 60500, title: 'Opening' }, { startMs: 60500, endMs: 120000, title: 'Two' }] });
  });
  it('accepts Plex ms', () => {
    expect(normalizeChapters([{ startMs: 0, endMs: 5000, title: 'a' }, { startMs: 5000, endMs: 9000, title: 'b' }], 9000).chapters).toHaveLength(2);
  });
  it('gives no chapters rather than wrong ones', () => {
    expect(normalizeChapters([abs[0]], 60500)).toEqual({ reason: 'too-few' });
    expect(normalizeChapters(abs, 200000)).toEqual({ reason: 'duration-mismatch' });
    expect(normalizeChapters([abs[1], abs[0]], 120000)).toEqual({ reason: 'bad-chapters' });
    expect(normalizeChapters([{ start: 10, end: 60 }, { start: 60, end: 120 }], 120000)).toEqual({ reason: 'bad-chapters' });
  });
});
