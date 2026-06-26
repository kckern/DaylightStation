import { describe, it, expect } from 'vitest';
import { lectureUserStatus } from './lectureMeta.js';

describe('lectureUserStatus', () => {
  it('prefers user fields when present (watched)', () => {
    expect(lectureUserStatus({ userWatched: true, userPercent: 95 })).toEqual({ watched: true, percent: 95 });
  });
  it('prefers user fields when present (in-progress, not watched)', () => {
    expect(lectureUserStatus({ userWatched: false, userPercent: 40 })).toEqual({ watched: false, percent: 40 });
  });
  it('treats userPercent null + userWatched false as a real (unwatched) user entry', () => {
    expect(lectureUserStatus({ userWatched: false, userPercent: null })).toEqual({ watched: false, percent: 0 });
  });
  it('falls back to device lectureStatus when no user fields', () => {
    expect(lectureUserStatus({ watchProgress: 92 })).toEqual({ watched: true, percent: 92 });
    expect(lectureUserStatus({ playCount: 1, watchProgress: 0 })).toEqual({ watched: true, percent: 0 });
  });
});
