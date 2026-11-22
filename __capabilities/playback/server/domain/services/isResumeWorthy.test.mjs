// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isResumeWorthy, resumeFloorSec, RESUME_MIN_SEC } from './isResumeWorthy.mjs';

describe('isResumeWorthy', () => {
  const film = 5000;
  it('treats a peek at the opening as a fresh start', () => {
    expect(isResumeWorthy({ playhead: 25, duration: film, watchTime: 25 })).toBe(false);
    expect(isResumeWorthy({ playhead: 16, duration: film, watchTime: 16 })).toBe(false);
  });
  it('resumes once three minutes are in and watched', () => {
    expect(isResumeWorthy({ playhead: 180, duration: film, watchTime: 180 })).toBe(true);
    expect(isResumeWorthy({ playhead: 2400, duration: film, watchTime: 2300 })).toBe(true);
  });
  it('does not resume a spot reached by skipping ahead with little watched', () => {
    expect(isResumeWorthy({ playhead: 1200, duration: film, watchTime: 70 })).toBe(false);
  });
  it('judges an older record without watch time by the spot alone', () => {
    expect(isResumeWorthy({ playhead: 600, duration: film })).toBe(true);
    expect(isResumeWorthy({ playhead: 60, duration: film, watchTime: 0 })).toBe(false);
  });
  it('scales the floor down for short items', () => {
    expect(resumeFloorSec(200)).toBe(20);
    expect(isResumeWorthy({ playhead: 90, duration: 200, watchTime: 90 })).toBe(true);
    expect(resumeFloorSec(0)).toBe(RESUME_MIN_SEC);
  });
  it('never resumes nothing', () => {
    expect(isResumeWorthy({ playhead: 0, duration: film })).toBe(false);
    expect(isResumeWorthy()).toBe(false);
  });
});
