// lectureMeta.test.js
import { describe, it, expect } from 'vitest';
import { lectureContentId, deriveResumeSeconds, lectureStatus } from './lectureMeta.js';

describe('lectureContentId', () => {
  it('prefers the plex field', () => {
    expect(lectureContentId({ plex: '662039' })).toBe('plex:662039');
  });
  it('accepts a plex:-prefixed id and contentId fallback', () => {
    expect(lectureContentId({ id: 'plex:5' })).toBe('plex:5');
    expect(lectureContentId({ contentId: 'plex:7' })).toBe('plex:7');
  });
  it('returns null when unresolved', () => {
    expect(lectureContentId({ id: '5' })).toBeNull();
    expect(lectureContentId(null)).toBeNull();
  });
});

describe('deriveResumeSeconds', () => {
  it('uses watchSeconds when present', () => {
    expect(deriveResumeSeconds({ watchSeconds: 42, duration: 100 })).toBe(42);
  });
  it('falls back to watchProgress percent of duration', () => {
    expect(deriveResumeSeconds({ watchProgress: 25, duration: 200 })).toBe(50);
  });
  it('is 0 with no progress info', () => {
    expect(deriveResumeSeconds({ duration: 100 })).toBe(0);
    expect(deriveResumeSeconds(null)).toBe(0);
  });
});

describe('lectureStatus', () => {
  it('reports watched and clamps percent', () => {
    expect(lectureStatus({ isWatched: true, watchProgress: 140 })).toEqual({ watched: true, percent: 100, completedAt: null });
  });
  it('reports in-progress percent', () => {
    expect(lectureStatus({ watchProgress: 33.6 })).toEqual({ watched: false, percent: 34, completedAt: null });
  });
  it('defaults to unwatched/0', () => {
    expect(lectureStatus({})).toEqual({ watched: false, percent: 0, completedAt: null });
  });
  it('ignores a spurious isWatched flag when there is no real history', () => {
    // Generic Plex collections return isWatched:true with playCount/progress 0.
    expect(lectureStatus({ isWatched: true, playCount: 0, watchProgress: 0 })).toEqual({ watched: false, percent: 0, completedAt: null });
  });
  it('counts a real completed view via playCount', () => {
    expect(lectureStatus({ playCount: 1, watchProgress: 0 })).toEqual({ watched: true, percent: 0, completedAt: null });
  });
});
