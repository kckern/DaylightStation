import { describe, it, expect } from 'vitest';
import { budgetStory, isFinishedDay } from './budgetStory.js';

const range = { floor: 1200, top: 1791 };
const day = (food, exercise = 311, over = {}) => ({ food, exercise, maintenance: 2291, range, zone: 'in-range', declared: null, ...over });
const live = { date: '2026-09-25', today: '2026-09-25' };
const past = { date: '2026-09-24', today: '2026-09-25' };
const say = (s) => ({ job: s.job, value: s.value, text: s.text, sub: s.sub });

describe('isFinishedDay', () => {
  it('a past date, or a day closed as done or fasted', () => {
    expect(isFinishedDay({ ...past, declared: null })).toBe(true);
    expect(isFinishedDay({ ...live, declared: 'done' })).toBe(true);
    expect(isFinishedDay({ ...live, declared: 'fasting' })).toBe(true);
    expect(isFinishedDay({ ...live, declared: null })).toBe(false);
    expect(isFinishedDay({ date: null, today: null, declared: null })).toBe(false);
  });
});

describe('budgetStory — live day', () => {
  it('Afford, free tier: the 2026-09-25 day reads 321 free, then the other prices and the total', () => {
    expect(say(budgetStory(day(1470), live))).toEqual({
      job: 'afford', value: 321, text: 'free', sub: 'then 311 workout · 500 deficit · 1,132 to break even',
    });
  });

  it('Afford with no workout: no workout price', () => {
    expect(budgetStory(day(1470, 0), live).sub).toBe('then 500 deficit · 821 to break even');
  });

  it('Afford with no break even known: only the workout price', () => {
    expect(budgetStory(day(1470, 311, { maintenance: 0 }), live).sub).toBe('then 311 workout');
  });

  it('Afford, workout tier: what is left of the workout leads', () => {
    expect(say(budgetStory(day(1900), live))).toEqual({
      job: 'afford', value: 202, text: 'of workout left', sub: 'used 109 of 311 · 500 deficit · 702 to break even',
    });
  });

  it('Contain, over plan: the distance to break even leads', () => {
    expect(say(budgetStory(day(2300, 311, { zone: 'over' }), live))).toEqual({
      job: 'contain', value: 302, text: 'to break even', sub: '198 over plan',
    });
  });

  it('Contain with no break even known: the overrun leads', () => {
    expect(say(budgetStory(day(2300, 311, { zone: 'over', maintenance: 0 }), live))).toEqual({
      job: 'contain', value: 198, text: 'over plan', sub: null,
    });
  });

  it('Contain, past break even', () => {
    expect(say(budgetStory(day(2800, 311, { zone: 'past-even' }), live))).toEqual({
      job: 'contain', value: 198, text: 'past break even', sub: '698 over plan',
    });
  });

  it('Trust (7 am, breakfast logged): the free number still leads, dimmed, and the sub-line says why', () => {
    const s = budgetStory(day(800, 0, { zone: 'incomplete' }), live);
    expect(say(s)).toEqual({ job: 'trust', value: 991, text: 'free', sub: '400 under the 1,200 floor · prices assume the log is complete' });
    expect(s.tentative).toBe(true);
  });

  it('a skipped meal makes an under-floor day trustworthy: Afford, not Trust', () => {
    expect(budgetStory(day(800, 0, { zone: 'declared', fastedMeals: ['morning'] }), live).job).toBe('afford');
  });
});

describe('budgetStory — finished day (Judge)', () => {
  it('free tier: on plan, workout banked', () => {
    expect(say(budgetStory(day(1470), past))).toEqual({
      job: 'judge', value: null, text: 'On plan', sub: 'workout banked (311) · ended 1,132 under break even',
    });
  });

  it('workout tier: on plan, part of the workout eaten back', () => {
    expect(budgetStory(day(1900), past).sub).toBe('ate back 109 of 311 workout · ended 702 under break even');
  });

  it('over plan: missed, with where the day ended against break even', () => {
    expect(say(budgetStory(day(2300, 311, { zone: 'over' }), past))).toEqual({
      job: 'judge', value: null, text: 'Missed plan by 198', sub: 'ended 302 under break even',
    });
  });

  it('past break even: a surplus', () => {
    expect(say(budgetStory(day(2800, 311, { zone: 'past-even' }), past))).toEqual({
      job: 'judge', value: null, text: 'Surplus of 198', sub: 'missed plan by 698',
    });
  });

  it('an unclosed past day under the floor has no verdict', () => {
    expect(say(budgetStory(day(700, 0, { zone: 'incomplete' }), past))).toEqual({
      job: 'judge', value: null, text: 'Incomplete log', sub: '700 logged, under the 1,200 floor · no verdict',
    });
  });

  it('a fasted day says so', () => {
    expect(say(budgetStory(day(0, 0, { zone: 'declared', declared: 'fasting' }), live))).toEqual({
      job: 'judge', value: null, text: 'Fasted', sub: 'ended 2,291 under break even',
    });
  });

  it('closing today as done judges it', () => {
    expect(budgetStory(day(1470, 311, { declared: 'done' }), live).job).toBe('judge');
  });
});

describe('budgetStory — a plan capped at break even', () => {
  // floor 1200 over maintenance 1100 + 300 burned: break even 1400, so the
  // workout tier is 1200 → 1400, room for 200 of the 300 burned.
  const cappedCeiling = (food, over = {}) => ({ food, exercise: 300, maintenance: 1100, range: { floor: 1200, top: 1200 }, zone: 'in-range', declared: null, ...over });
  // floor 1500: the top itself is capped at 1400, so there is no workout tier.
  const cappedTop = (food, over = {}) => ({ ...cappedCeiling(food, over), range: { floor: 1500, top: 1500 } });
  const noExercise = (food, over = {}) => ({ ...cappedCeiling(food, over), exercise: 0 });

  it('judge: the workout banked is the room the plan had for it, not the full burn', () => {
    expect(budgetStory(cappedCeiling(1000, { zone: 'declared', declared: 'done' }), past).sub)
      .toBe('workout banked (200) · ended 400 under break even');
  });

  it('judge: eating back the workout is counted against its room', () => {
    expect(budgetStory(cappedCeiling(1300), past).sub).toBe('ate back 100 of 200 workout · ended 100 under break even');
  });

  it('live: the workout used is counted against its room', () => {
    expect(say(budgetStory(cappedCeiling(1300), live))).toEqual({
      job: 'afford', value: 100, text: 'of workout left', sub: 'used 100 of 200 · 100 to break even',
    });
  });

  it('judge: no workout tier, no workout mentioned', () => {
    expect(say(budgetStory(cappedTop(1300), past))).toEqual({
      job: 'judge', value: null, text: 'On plan', sub: 'ended 100 under break even',
    });
  });

  it('fully capped (over plan is the gain): the number is not repeated', () => {
    expect(say(budgetStory(noExercise(1300, { zone: 'past-even' }), live))).toEqual({
      job: 'contain', value: 200, text: 'past break even', sub: null,
    });
    expect(say(budgetStory(noExercise(1300, { zone: 'past-even' }), past))).toEqual({
      job: 'judge', value: null, text: 'Surplus of 200', sub: null,
    });
  });
});

describe('budgetStory — pricing a portion while it is dragged', () => {
  it('the sub-line becomes what the change costs, in the bar\'s nouns', () => {
    expect(budgetStory(day(1900), { ...live, baseline: day(1470) }).sub).toBe('this costs 321 free + 109 workout');
  });

  it('a smaller portion gives kcal back', () => {
    expect(budgetStory(day(1270), { ...live, baseline: day(1470) }).sub).toBe('gives back 200');
  });

  it('an unchanged day keeps its own sub-line', () => {
    expect(budgetStory(day(1470), { ...live, baseline: day(1470) }).sub).toBe('then 311 workout · 500 deficit · 1,132 to break even');
  });
});
