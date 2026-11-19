// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { GetMakeupWork } from "./GetMakeupWork.mjs";

const silent = { info() {}, warn: vi.fn(), error() {}, debug() {} };
const ON = { enabled: true, deadlineWeekday: 6, subjects: null };
// Week Mon 2026-09-07 … Sat 09-12.
const MON = '2026-09-07'; const WED = '2026-09-09'; const THU = '2026-09-10';

const verdicts = (days) => ({ read: vi.fn(async () => ({ days })) });
const day = (studyDay, makeupOpen, sections) => ({ studyDay, makeupOpen, sections });

describe('GetMakeupWork', () => {
  const days = [
    day(WED, true, [{ subject: 'english', state: 'obligated' }, { subject: 'math', state: 'served' }]),
    day(MON, true, [{ subject: 'math', state: 'obligated' }, { subject: 'art', state: 'excused' }]),
    day(THU, false, [{ subject: 'math', state: 'obligated' }]),
  ];

  it('lists the obligated sections of open days, oldest first, with the week deadline', async () => {
    const termVerdicts = verdicts(days);
    const out = await new GetMakeupWork({ termVerdicts, makeupPolicy: ON, logger: silent }).execute({ learnerId: 'kid' });
    expect(termVerdicts.read).toHaveBeenCalledWith('kid', { detail: true });
    expect(out).toEqual({
      deadline: '2026-09-12',
      items: [{ day: MON, subject: 'math' }, { day: WED, subject: 'english' }],
    });
  });

  it('keeps only the subjects the policy covers', async () => {
    const out = await new GetMakeupWork({
      termVerdicts: verdicts(days), makeupPolicy: { ...ON, subjects: ['english'] }, logger: silent,
    }).execute({ learnerId: 'kid' });
    expect(out.items).toEqual([{ day: WED, subject: 'english' }]);
  });

  it('is empty when the policy is off, without reading verdicts', async () => {
    const termVerdicts = verdicts(days);
    const out = await new GetMakeupWork({ termVerdicts, makeupPolicy: { ...ON, enabled: false } }).execute({ learnerId: 'kid' });
    expect(out).toEqual({ deadline: null, items: [] });
    expect(termVerdicts.read).not.toHaveBeenCalled();
  });

  it('accepts getters for the service and the policy', async () => {
    const out = await new GetMakeupWork({
      termVerdicts: () => verdicts(days), makeupPolicy: () => ON, logger: silent,
    }).execute({ learnerId: 'kid' });
    expect(out.items).toHaveLength(2);
  });

  it('never throws: a failed read logs and returns empty', async () => {
    const logger = { warn: vi.fn() };
    const termVerdicts = { read: vi.fn(async () => { throw new Error('cache gone'); }) };
    const out = await new GetMakeupWork({ termVerdicts, makeupPolicy: ON, logger }).execute({ learnerId: 'kid' });
    expect(out).toEqual({ deadline: null, items: [] });
    expect(logger.warn).toHaveBeenCalledWith('school.makeup.read-failed', { learnerId: 'kid', error: 'cache gone' });
  });

  it('is empty with no open day', async () => {
    const out = await new GetMakeupWork({
      termVerdicts: verdicts([day(THU, false, [{ subject: 'math', state: 'obligated' }])]), makeupPolicy: ON,
    }).execute({ learnerId: 'kid' });
    expect(out).toEqual({ deadline: null, items: [] });
  });
});

describe('GetMakeupWork — only work that can earn credit today', () => {
  const cards = (extra) => ({ asked: true, lessons: 0, programsDone: [], needsLesson: false, needsPrograms: ['flashcards'], ...extra });
  const missedCards = { subject: 'language', state: 'obligated', ledger: cards() };
  const read = (todayLedger) => ({ read: vi.fn(async () => ({
    today: THU,
    days: [day(WED, true, [missedCards]), day(THU, false, [{ subject: 'language', state: 'served', ledger: todayLedger }])],
  })) });

  it('leaves off a missed program that today also owes', async () => {
    const out = await new GetMakeupWork({ termVerdicts: read(cards({ programsDone: ['flashcards'] })), makeupPolicy: ON, logger: silent })
      .execute({ learnerId: 'kid' });
    expect(out.items).toEqual([]);
  });

  it('lists it on a day that does not owe it', async () => {
    const out = await new GetMakeupWork({ termVerdicts: read(cards({ asked: false, needsPrograms: [] })), makeupPolicy: ON, logger: silent })
      .execute({ learnerId: 'kid' });
    expect(out.items).toEqual([{ day: WED, subject: 'language' }]);
  });
});
