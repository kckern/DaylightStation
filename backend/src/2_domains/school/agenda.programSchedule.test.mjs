// @vitest-environment node
/**
 * A program's OWN schedule decides whether it is offered and owed today.
 *
 * The 2026-09-24 switchover: a learner moved off the sentence ladder onto the
 * card ladder mid-term. The plan kept both enrollments, dated by `except`
 * spans — the ladder retired from the switchover on (so every day before it
 * keeps its credit), the flashcards excepted up to it. The agenda read those
 * spans only for the "no school today" excuse, so the retired ladder kept
 * winning the Language slot and kept being owed, and the flashcards never
 * printed.
 */
import { describe, it, expect } from 'vitest';
import { planDailyAgenda } from './agenda.mjs';

const WEEKDAYS = [1, 2, 3, 4, 5];
const ladder = {
  unitId: 'sentence-ladder:glossika-korean', title: 'Glossika Korean', subject: 'language',
  program: 'sentence-ladder', programInstance: 'glossika-korean', cadence: 'daily',
  status: 'available', timingState: 'available', elective: false,
  schedule: { daysOfWeek: WEEKDAYS, except: [{ from: '2026-09-24', to: '2099-12-31' }] },
};
const cards = {
  unitId: 'flashcards:language/korean/week-01-classroom', title: 'UBKS 비둘기', subject: 'language',
  program: 'flashcards', programInstance: 'language/korean/week-01-classroom', cadence: 'daily',
  status: 'available', timingState: 'available', elective: false,
  schedule: { daysOfWeek: WEEKDAYS, except: [{ from: '2026-01-01', to: '2026-09-23' }] },
};
const statuses = ({ ladderDone = false, cardsDone = false } = {}) => ({
  [`sentence-ladder::glossika-korean`]: { doneToday: ladderDone },
  [`flashcards::language/korean/week-01-classroom`]: { doneToday: cardsDone },
});
const language = (now, s) => planDailyAgenda({
  plan: { entries: [{ ...ladder }, { ...cards }] }, now, programStatuses: statuses(s),
}).sections.find((x) => x.subject === 'language');

const SWITCH_DAY = '2026-09-24T18:00:00.000Z'; // Thursday
const BEFORE = '2026-09-22T18:00:00.000Z'; // Tuesday
const SATURDAY = '2026-09-26T18:00:00.000Z';

describe('planDailyAgenda — a program is offered and owed only on its own days', () => {
  it('offers the flashcards, not the retired ladder, from the switchover on', () => {
    const section = language(SWITCH_DAY);
    expect(section.next?.unitId).toBe(cards.unitId);
    expect(section.obligation.state).toBe('obligated');
  });

  it('the flashcards alone serve the day — the retired ladder is not owed', () => {
    expect(language(SWITCH_DAY, { cardsDone: true }).obligation).toEqual({ state: 'served', reason: null });
  });

  it('the retired ladder alone does not serve the day', () => {
    const section = language(SWITCH_DAY, { ladderDone: true });
    expect(section.obligation.state).not.toBe('served');
    expect(section.next?.unitId).toBe(cards.unitId);
  });

  it('before the switchover the ladder is offered and its credit stands', () => {
    expect(language(BEFORE).next?.unitId).toBe(ladder.unitId);
    expect(language(BEFORE, { ladderDone: true }).obligation).toEqual({ state: 'served', reason: null });
  });

  it('on a weekend it still offers work, preferring the live enrollment over the retired one', () => {
    const section = language(SATURDAY);
    expect(section.next?.unitId).toBe(cards.unitId);
    expect(section.obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
  });
});
