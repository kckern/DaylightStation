import { describe, it, expect } from 'vitest';
import {
  classifyDay, buildCalendarDays, averageTrusted, resolveMinCalories, shiftDate, DEFAULT_MIN_CALORIES,
} from '../../../backend/src/3_applications/coaching/dayCompleteness.mjs';

describe('dayCompleteness', () => {
  it('defaults the threshold to 1200 and accepts a configured value', () => {
    expect(DEFAULT_MIN_CALORIES).toBe(1200);
    expect(resolveMinCalories(undefined)).toBe(1200);
    expect(resolveMinCalories({ min_calories: 'lots' })).toBe(1200);
    expect(resolveMinCalories({ min_calories: 1500 })).toBe(1500);
  });

  it('classifies an under-threshold day as incomplete, not low intake', () => {
    expect(classifyDay({ calories: 460, protein: 18 }, undefined, 1200)).toBe('incomplete');
    expect(classifyDay({ calories: 1200, protein: 90 }, undefined, 1200)).toBe('complete');
    expect(classifyDay(undefined, undefined, 1200)).toBe('unlogged');
    expect(classifyDay({ calories: 0 }, undefined, 1200)).toBe('unlogged');
  });

  it('trusts a low day the user closed with /done or /fast (incl. legacy `true`)', () => {
    expect(classifyDay({ calories: 800 }, { status: 'done' }, 1200)).toBe('done');
    expect(classifyDay({ calories: 800 }, true, 1200)).toBe('done');
    expect(classifyDay(undefined, { status: 'fasting' }, 1200)).toBe('fasting');
  });

  it('walks calendar days so an unlogged Sunday is not skipped', () => {
    // Real shape from 2026-09-14: Sunday 09-13 has no nutriday row.
    const nutritionData = {
      '2026-09-12': { calories: 1362, protein: 90.8 },
      '2026-09-11': { calories: 600, protein: 54 },
    };
    const days = buildCalendarDays({ nutritionData, closures: {}, beforeDate: '2026-09-14', count: 3, minCalories: 1200 });
    expect(days.map(d => [d.date, d.status])).toEqual([
      ['2026-09-13', 'unlogged'],
      ['2026-09-12', 'complete'],
      ['2026-09-11', 'incomplete'],
    ]);
    expect(days[1].protein).toBe(91);
  });

  it('averages trusted days only', () => {
    const avg = averageTrusted([
      { calories: 1600, protein: 100, status: 'complete' },
      { calories: 400, protein: 20, status: 'incomplete' },
      { calories: 0, protein: 0, status: 'unlogged' },
      { calories: 0, protein: 0, status: 'fasting' },
    ]);
    expect(avg).toEqual({ calories: 800, protein: 50, trustedDays: 2, totalDays: 4 });
    expect(averageTrusted([{ calories: 300, protein: 5, status: 'incomplete' }]).calories).toBeNull();
  });

  it('shifts dates across month boundaries', () => {
    expect(shiftDate('2026-10-01', 1)).toBe('2026-09-30');
  });
});

describe('reconstructed days', () => {
  it('trusts their calories but never averages their (unknown) protein', () => {
    expect(classifyDay({ calories: 2000, protein: 30, reconstructed_calories: 1540 }, undefined, 1200)).toBe('reconstructed');
    const avg = averageTrusted([
      { calories: 1800, protein: 120, status: 'complete' },
      { calories: 2000, protein: 30, status: 'reconstructed' },
    ]);
    expect(avg).toEqual({ calories: 1900, protein: 120, trustedDays: 2, totalDays: 2 });
    expect(averageTrusted([{ calories: 2000, protein: 0, status: 'reconstructed' }]).protein).toBeNull();
  });
});
