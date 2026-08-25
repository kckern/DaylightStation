/**
 * PAST, PRESENT, FUTURE — the rule that decides whether a progress bar has a
 * present tense at all (2026-08-23).
 *
 * The course bar had two states, so the module a child is CURRENTLY working
 * through was drawn identically to modules they have never opened. On a result
 * receipt that is plainly wrong: they had just finished a lesson inside it.
 */
import { describe, it, expect } from 'vitest';
import { activeProgressPosition, inProgressSegments } from '#domains/school/progressRows.mjs';

describe('inProgressSegments', () => {
  it('marks one segment underway mid-course', () => {
    expect(inProgressSegments({ completed: 2, total: 7, currentComplete: false })).toBe(1);
  });

  it('marks none when the module just worked in is itself finished', () => {
    // It is already inside `completed`; hatching the NEXT one would mark a
    // module the child has not opened as though they were in it.
    expect(inProgressSegments({ completed: 3, total: 7, currentComplete: true })).toBe(0);
  });

  it('marks none on a finished course — all past tense, nothing left to be in', () => {
    expect(inProgressSegments({ completed: 7, total: 7, currentComplete: false })).toBe(0);
    expect(inProgressSegments({ completed: 7, total: 7, currentComplete: true })).toBe(0);
  });

  it('marks the very first segment for a course only just begun', () => {
    expect(inProgressSegments({ completed: 0, total: 7, currentComplete: false })).toBe(1);
  });

  it('marks the last segment when the final module is the one underway', () => {
    expect(inProgressSegments({ completed: 6, total: 7, currentComplete: false })).toBe(1);
  });

  it('never claims more than the bar has room for', () => {
    // The renderer refuses to paint past the track, but the rule must not ask
    // it to in the first place.
    for (let completed = 0; completed <= 7; completed += 1) {
      const marked = inProgressSegments({ completed, total: 7, currentComplete: false });
      expect(completed + marked).toBeLessThanOrEqual(7);
    }
  });

  it('stays silent on unusable numbers rather than guessing', () => {
    expect(inProgressSegments()).toBe(0);
    expect(inProgressSegments({ completed: null, total: 7 })).toBe(0);
    expect(inProgressSegments({ completed: 2, total: null })).toBe(0);
    expect(inProgressSegments({ completed: -1, total: 7 })).toBe(0);
    expect(inProgressSegments({ completed: 0, total: 0 })).toBe(0);
    expect(inProgressSegments({ completed: 9, total: 7 })).toBe(0);
    expect(inProgressSegments({ completed: 2.5, total: 7 })).toBe(0);
  });

  it('treats a missing currentComplete as "not finished" — the receipt-time default', () => {
    // A result receipt is printed the moment a lesson closes, so the module is
    // underway unless something says otherwise.
    expect(inProgressSegments({ completed: 2, total: 7 })).toBe(1);
  });
});

describe('activeProgressPosition', () => {
  it('labels the first active segment as 1 while completion remains zero', () => {
    expect(activeProgressPosition({ completed: 0, total: 17, inProgress: 1 })).toBe(1);
  });

  it('advances through an active segment without changing the completed count', () => {
    expect(activeProgressPosition({ completed: 4, total: 17, inProgress: 1 })).toBe(5);
  });

  it('uses the completed position when no segment is active', () => {
    expect(activeProgressPosition({ completed: 5, total: 17, inProgress: 0 })).toBe(5);
  });

  it('never displays a position beyond the total', () => {
    expect(activeProgressPosition({ completed: 17, total: 17, inProgress: 1 })).toBe(17);
  });
});
