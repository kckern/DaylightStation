import { describe, it, expect } from 'vitest';
import { lectureUserStatus } from './lectureMeta.js';

describe('lectureUserStatus', () => {
  it('prefers user fields when present (watched), surfacing the completion date', () => {
    expect(lectureUserStatus({ userWatched: true, userPercent: 95, userCompletedAt: '2026-06-26T00:00:00Z' }))
      .toEqual({ watched: true, percent: 95, completedAt: '2026-06-26T00:00:00Z' });
  });
  it('prefers user fields when present (in-progress, not watched) — no completion date', () => {
    expect(lectureUserStatus({ userWatched: false, userPercent: 40 })).toEqual({ watched: false, percent: 40, completedAt: null });
  });
  it('treats userPercent null + userWatched false as a real (unwatched) user entry', () => {
    expect(lectureUserStatus({ userWatched: false, userPercent: null })).toEqual({ watched: false, percent: 0, completedAt: null });
  });
  it('falls back to device lectureStatus when no user fields (no date available)', () => {
    expect(lectureUserStatus({ watchProgress: 92 })).toEqual({ watched: true, percent: 92, completedAt: null });
    expect(lectureUserStatus({ playCount: 1, watchProgress: 0 })).toEqual({ watched: true, percent: 0, completedAt: null });
  });
});
