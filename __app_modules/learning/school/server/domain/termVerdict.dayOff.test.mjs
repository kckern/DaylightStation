// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { dayVerdict, VERDICT_VERSION } from "./termVerdict.mjs";

const sec = (state, reason = null, subject = 'math') => ({ subject, state, reason });
const done = { state: 'complete', faults: [] };
const day = (sections) => dayVerdict({ studyDay: '2026-11-11', today: '2026-11-12', completion: done, sections });

describe('dayVerdict — day-off tiers', () => {
  it('a tier day with nothing asked reads exempt / day_off', () => {
    expect(day([sec('excused', 'day_off'), sec('excused', 'day_off', 'arts')])).toMatchObject({ state: 'exempt', reason: 'day_off' });
  });
  it('day_off beside a weekday a course does not meet is still day_off', () => {
    expect(day([sec('excused', 'day_off'), sec('excused', 'not_a_school_day', 'arts')])).toMatchObject({ state: 'exempt', reason: 'day_off' });
  });
  it('the house being away outranks a tier', () => {
    expect(day([sec('excused', 'day_off'), sec('excused', 'household_calendar', 'arts')])).toMatchObject({ state: 'exempt', reason: 'household_calendar' });
  });
  it('a tier day with kept work reads like any day', () => {
    expect(day([sec('excused', 'day_off'), sec('served', null, 'scripture')]).state).toBe('met');
    expect(day([sec('excused', 'day_off'), sec('obligated', null, 'scripture')]).state).toBe('none');
  });
  it('the cached verdicts are recomputed', () => {
    expect(VERDICT_VERSION).toBe(2);
  });
});
