// lectureMeta.test.js
import { describe, it, expect } from 'vitest';
import { isAtTail, lectureContentId, lectureStatus, resumeSecondsFor } from './lectureMeta.js';

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

  it('unenriched items start from zero — device playhead is never a resume source', () => {
    expect(resumeSecondsFor({ watchSeconds: 120 })).toBe(0);
    expect(resumeSecondsFor({ watchSeconds: 120, duration: 1800, watchProgress: 40 })).toBe(0);
    expect(resumeSecondsFor({})).toBe(0);
  });

  it('starts a known user with no per-user record at 0 — never inherits another user/device tail position', () => {
    // Enriched item (userWatched present, boolean false) but this user has no
    // playhead of their own. Device-level watchSeconds sits at the tail — e.g.
    // another user on the shared kiosk nearly finished it. Must NOT leak.
    expect(resumeSecondsFor({ userWatched: false, userPercent: null, watchSeconds: 1790, duration: 1800 })).toBe(0);
  });

  // 2026-10-28: a 77.5s lecture held userPlayhead 78 but was never credited, so
  // every open seeked to the end, fired `ended` at once and closed the player.
  it('restarts an uncredited lecture whose playhead sits at the tail', () => {
    expect(resumeSecondsFor({ userWatched: false, userPercent: 100, userPlayhead: 78, duration: 77.547 })).toBe(0);
    expect(resumeSecondsFor({ userWatched: false, userPercent: 99, userPlayhead: 1790, duration: 1800 })).toBe(0);
  });

  it('still resumes a long lecture stopped short of the tail', () => {
    expect(resumeSecondsFor({ userWatched: false, userPercent: 94, userPlayhead: 1700, duration: 1800 })).toBe(1700);
    expect(resumeSecondsFor({ userWatched: false, userPercent: 50, userPlayhead: 40, duration: 77.547 })).toBe(40);
  });
});

describe('isAtTail', () => {
  it('is true within the last 5 seconds or the last 2%, whichever is longer', () => {
    expect(isAtTail(73, 77.547)).toBe(true);
    expect(isAtTail(72, 77.547)).toBe(false);
    expect(isAtTail(1765, 1800)).toBe(true);
    expect(isAtTail(1760, 1800)).toBe(false);
  });

  it('is false when the duration is unknown', () => {
    expect(isAtTail(78, 0)).toBe(false);
    expect(isAtTail(78, undefined)).toBe(false);
    expect(isAtTail(78, NaN)).toBe(false);
  });
});
