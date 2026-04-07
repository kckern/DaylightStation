import { describe, it, expect } from 'vitest';
import { detectPattern } from '../../../backend/src/3_applications/coaching/patterns.mjs';

describe('detectPattern', () => {
  const goals = { calories_min: 1200, calories_max: 1600, protein: 120 };

  it('returns protein_short when protein < 80% goal for 3+ of last 5 days', () => {
    const days = [
      { date: '2026-04-07', calories: 1400, protein: 90 },
      { date: '2026-04-06', calories: 1300, protein: 80 },
      { date: '2026-04-05', calories: 1500, protein: 85 },
      { date: '2026-04-04', calories: 1400, protein: 130 },
      { date: '2026-04-03', calories: 1350, protein: 70 },
    ];
    expect(detectPattern(days, goals)).toBe('protein_short');
  });

  it('returns calorie_surplus when above goal_max for 2+ of last 3 days', () => {
    const days = [
      { date: '2026-04-07', calories: 1800, protein: 120 },
      { date: '2026-04-06', calories: 1700, protein: 120 },
      { date: '2026-04-05', calories: 1400, protein: 120 },
    ];
    expect(detectPattern(days, goals)).toBe('calorie_surplus');
  });

  it('returns calorie_deficit when below goal_min for 2+ of last 3 days', () => {
    const days = [
      { date: '2026-04-07', calories: 800, protein: 120 },
      { date: '2026-04-06', calories: 1000, protein: 120 },
      { date: '2026-04-05', calories: 1400, protein: 120 },
    ];
    expect(detectPattern(days, goals)).toBe('calorie_deficit');
  });

  it('returns missed_logging when 0 calories for 1+ of last 3 days', () => {
    const days = [
      { date: '2026-04-07', calories: 1400, protein: 120 },
      { date: '2026-04-06', calories: 0, protein: 0 },
      { date: '2026-04-05', calories: 1400, protein: 120 },
    ];
    expect(detectPattern(days, goals)).toBe('missed_logging');
  });

  it('returns binge_after_deficit when day > goal_max follows 2+ days < goal_min', () => {
    const days = [
      { date: '2026-04-07', calories: 2200, protein: 120 },
      { date: '2026-04-06', calories: 900, protein: 60 },
      { date: '2026-04-05', calories: 800, protein: 50 },
    ];
    expect(detectPattern(days, goals)).toBe('binge_after_deficit');
  });

  it('returns on_track when within goals for 3+ consecutive days', () => {
    const days = [
      { date: '2026-04-07', calories: 1400, protein: 125 },
      { date: '2026-04-06', calories: 1300, protein: 130 },
      { date: '2026-04-05', calories: 1500, protein: 122 },
    ];
    expect(detectPattern(days, goals)).toBe('on_track');
  });

  it('returns null when no pattern detected', () => {
    const days = [
      { date: '2026-04-07', calories: 1400, protein: 110 },
      { date: '2026-04-06', calories: 1700, protein: 130 },
    ];
    expect(detectPattern(days, goals)).toBeNull();
  });

  it('handles empty array', () => {
    expect(detectPattern([], goals)).toBeNull();
  });
});
