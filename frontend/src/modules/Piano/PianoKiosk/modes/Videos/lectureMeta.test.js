// lectureMeta.test.js
import { describe, it, expect } from 'vitest';
import { lectureContentId, deriveResumeSeconds, lectureStatus, resumeSecondsFor } from './lectureMeta.js';

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

describe('resumeSecondsFor', () => {
  it('restarts a completed lecture from 0 (per-user completion)', () => {
    expect(resumeSecondsFor({ userWatched: true, userPlayhead: 1700, watchSeconds: 1700 })).toBe(0);
  });

  it('restarts a device-watched lecture from 0 (playCount signal)', () => {
    expect(resumeSecondsFor({ playCount: 2, watchSeconds: 1650, duration: 1800 })).toBe(0);
  });

  it('resumes an in-progress lecture at the per-user playhead', () => {
    expect(resumeSecondsFor({ userWatched: false, userPercent: 40, userPlayhead: 480 })).toBe(480);
  });

  it('falls back to device signals when no per-user playhead', () => {
    expect(resumeSecondsFor({ watchSeconds: 120 })).toBe(120);
    expect(resumeSecondsFor({})).toBe(0);
  });

  it('starts a known user with no per-user record at 0 — never inherits another user/device tail position', () => {
    // Enriched item (userWatched present, boolean false) but this user has no
    // playhead of their own. Device-level watchSeconds sits at the tail — e.g.
    // another user on the shared kiosk nearly finished it. Must NOT leak.
    expect(resumeSecondsFor({ userWatched: false, userPercent: null, watchSeconds: 1790, duration: 1800 })).toBe(0);
  });
});
