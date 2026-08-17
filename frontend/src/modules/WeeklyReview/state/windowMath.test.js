// frontend/src/modules/WeeklyReview/state/windowMath.test.js
import { describe, it, expect } from 'vitest';
import {
  WINDOW_DAYS, addDaysISO, daysBetween, previousWindowStart, nextWindowStart,
  windowsBack, windowStartForDate, windowEnd, windowsBackLabel,
} from './windowMath.js';

describe('windowMath', () => {
  it('walks a window backward by the full stride', () => {
    expect(previousWindowStart('2026-08-08')).toBe('2026-07-31');
  });

  it('walks forward and stops at the newest window', () => {
    expect(nextWindowStart('2026-07-31', '2026-08-08')).toBe('2026-08-08');
    expect(nextWindowStart('2026-08-08', '2026-08-08')).toBeNull();
  });

  it('never overshoots the newest window when the stride would pass it', () => {
    // A jump-to-oldest can land off-stride; walking forward must still settle
    // exactly on the newest window rather than into the future.
    expect(nextWindowStart('2026-08-05', '2026-08-08')).toBe('2026-08-08');
  });

  it('reports the window end inclusively', () => {
    expect(windowEnd('2026-08-08')).toBe('2026-08-15');
    expect(daysBetween('2026-08-08', windowEnd('2026-08-08'))).toBe(WINDOW_DAYS - 1);
  });

  it('counts whole windows back', () => {
    expect(windowsBack('2026-08-08', '2026-08-08')).toBe(0);
    expect(windowsBack('2026-07-31', '2026-08-08')).toBe(1);
    expect(windowsBack('2026-07-23', '2026-08-08')).toBe(2);
    expect(windowsBack(null, '2026-08-08')).toBe(0);
  });

  it('snaps an arbitrary content date onto the stride, landing on the window that contains it', () => {
    const newest = '2026-08-08';
    const start = windowStartForDate('2026-07-02', newest);
    expect(start).toBe('2026-06-29');
    // The target really does fall inside [start, windowEnd(start)].
    expect(start <= '2026-07-02' && '2026-07-02' <= windowEnd(start)).toBe(true);
    // And it sits on the stride.
    expect(daysBetween(start, newest) % WINDOW_DAYS).toBe(0);
  });

  it('snaps a date exactly one stride back to that window, not two', () => {
    expect(windowStartForDate('2026-07-31', '2026-08-08')).toBe('2026-07-31');
  });

  it('never returns a window newer than the newest', () => {
    expect(windowStartForDate('2026-09-01', '2026-08-08')).toBe('2026-08-08');
  });

  it('crosses a month boundary and a DST shift without dropping a day', () => {
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
    // US DST begins 2026-03-08; a naive local-midnight date would slip here.
    expect(addDaysISO('2026-03-07', 1)).toBe('2026-03-08');
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(previousWindowStart('2026-03-12')).toBe('2026-03-04');
  });

  it('labels only when the user has actually paged back', () => {
    expect(windowsBackLabel('2026-08-08', '2026-08-08')).toBeNull();
    expect(windowsBackLabel('2026-07-31', '2026-08-08')).toBe('1 window back');
    expect(windowsBackLabel('2026-07-23', '2026-08-08')).toBe('2 windows back');
  });
});
