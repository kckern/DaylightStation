import { describe, expect, it } from 'vitest';
import { missedWeekdays } from './saturdayCatchUp.mjs';

const SATURDAY = '2026-11-14'; // week Mon 2026-11-09 … Sun 2026-11-15
const cards = { unitId: 'flashcards:x', subject: 'language', program: 'flashcards', schedule: { daysOfWeek: [1, 2, 3, 4, 5] } };

describe('missedWeekdays', () => {
  it('names the scheduled weekdays the program was not done', () => {
    expect(missedWeekdays({ entry: cards, doneOn: ['2026-11-10', '2026-11-12', '2026-11-13'], today: SATURDAY }))
      .toEqual(['2026-11-09', '2026-11-11']);
  });
  it('nothing missed when every weekday was done', () => {
    const all = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
    expect(missedWeekdays({ entry: cards, doneOn: all, today: SATURDAY })).toEqual([]);
  });
  it('no evidence is no offer (fail closed)', () => {
    expect(missedWeekdays({ entry: cards, doneOn: undefined, today: SATURDAY })).toEqual([]);
  });
  it('a weekday the program does not meet is not missed', () => {
    const tueThu = { ...cards, schedule: { daysOfWeek: [2, 4] } };
    expect(missedWeekdays({ entry: tueThu, doneOn: ['2026-11-10'], today: SATURDAY })).toEqual(['2026-11-12']);
  });
  it("a day inside the program's own except span is not missed", () => {
    const retired = { ...cards, schedule: { daysOfWeek: [1, 2, 3, 4, 5], except: [{ from: '2026-11-09', to: '2026-11-10' }] } };
    expect(missedWeekdays({ entry: retired, doneOn: ['2026-11-12', '2026-11-13'], today: SATURDAY })).toEqual(['2026-11-11']);
  });
  it('an away day is not missed', () => {
    const householdSchedule = { except: [{ from: '2026-11-09', to: '2026-11-09', label: 'Trip', tier: 'away' }] };
    expect(missedWeekdays({ entry: cards, doneOn: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'], today: SATURDAY, householdSchedule }))
      .toEqual([]);
  });
  it('a keeping-tier day counts only when its keep-list keeps this program', () => {
    const householdSchedule = { except: [{ from: '2026-11-11', to: '2026-11-11', label: 'Veterans Day', tier: 'stay-home' }] };
    const dropsLanguage = { 'stay-home': { keep: [{ subject: 'english' }] } };
    const keepsLanguage = { 'stay-home': { keep: [{ subject: 'language' }] } };
    const doneOn = ['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13'];
    expect(missedWeekdays({ entry: cards, doneOn, today: SATURDAY, householdSchedule, dayOffPolicy: dropsLanguage })).toEqual([]);
    expect(missedWeekdays({ entry: cards, doneOn, today: SATURDAY, householdSchedule, dayOffPolicy: keepsLanguage })).toEqual(['2026-11-11']);
  });
  it('never looks at today or later', () => {
    expect(missedWeekdays({ entry: cards, doneOn: [], today: '2026-11-11' })).toEqual(['2026-11-09', '2026-11-10']);
  });
});
