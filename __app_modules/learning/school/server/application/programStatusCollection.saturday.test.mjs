// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { collectProgramStatuses } from './programStatusCollection.mjs';
import { FlashcardProgramLauncher } from './FlashcardProgramLauncher.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const SATURDAY = '2026-11-14';
const WEEKDAYS = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];

function launcher({ doneOn = [], replayable = true, saturdayCatchUp = true, failOn = null, answerOn = {} }) {
  const seen = [];
  return {
    seen, id: 'p', entryAction: null, surface: null, replayable, saturdayCatchUp,
    async status({ day = null }) {
      seen.push(day);
      if (day && day === failOn) throw new Error('boom');
      if (day && answerOn[day]) return answerOn[day];
      return { doneToday: doneOn.includes(day ?? 'TODAY'), progressLabel: null, score: null };
    },
    async launch() {},
  };
}
const plan = (cadence = 'daily', elective = false) => ({ entries: [{ unitId: 'p:x', program: 'p', programInstance: null, cadence, elective }] });
const run = (l, extra = {}) => collectProgramStatuses({
  plan: plan(extra.cadence, extra.elective), learnerId: 'k', launchers: new Map([['p', l]]), logger: silent, studyDay: SATURDAY, ...extra,
});

describe('collectProgramStatuses — Saturday weekday fold', () => {
  it('a live Saturday asks Monday through Friday and records the done days', async () => {
    const l = launcher({ doneOn: ['2026-11-10', '2026-11-12'] });
    const [row] = await run(l);
    expect(l.seen).toEqual([null, ...WEEKDAYS]);
    expect(row.status.weekdays).toEqual({ weekFrom: '2026-11-09', doneOn: ['2026-11-10', '2026-11-12'] });
  });
  it('a weekday build does not replay', async () => {
    const l = launcher({});
    const [row] = await collectProgramStatuses({ plan: plan(), learnerId: 'k', launchers: new Map([['p', l]]), logger: silent, studyDay: '2026-11-12' });
    expect(l.seen).toEqual([null]);
    expect(row.status.weekdays).toBeUndefined();
  });
  it('a replayed past Saturday and a future Saturday preview do not fold', async () => {
    const past = launcher({});
    await run(past, { day: SATURDAY });
    expect(past.seen).toEqual([SATURDAY]);
    const future = launcher({});
    await run(future, { futureDay: SATURDAY });
    expect(future.seen).toEqual([SATURDAY]);
  });
  it('a non-replayable launcher gets no fold', async () => {
    const l = launcher({ replayable: false });
    const [row] = await run(l);
    expect(row.status.weekdays).toBeUndefined();
  });
  it('a replayable launcher that has not opted in is not replayed (its Saturday work would credit nothing)', async () => {
    const l = launcher({ saturdayCatchUp: false });
    const [row] = await run(l);
    expect(l.seen).toEqual([null]);
    expect(row.status.weekdays).toBeUndefined();
  });
  it('a weekly program keeps its own fold only', async () => {
    const l = launcher({});
    const [row] = await run(l, { cadence: 'weekly' });
    expect(row.status.weekdays).toBeUndefined();
    expect(row.status.weekly).toBeDefined();
  });
  it('a grown-up day bypass counts the day done', async () => {
    const l = launcher({ doneOn: [] });
    const dayBypasses = { async activeFor({ studyDate }) { return studyDate === '2026-11-09' ? { decidedBy: 'kc' } : null; } };
    const [row] = await run(l, { dayBypasses });
    expect(row.status.weekdays.doneOn).toEqual(['2026-11-09']);
  });
  it('a failed replay drops the fold (no evidence, no offer), not the status', async () => {
    const l = launcher({ failOn: '2026-11-11' });
    const [row] = await run(l);
    expect(row.status.error).toBeUndefined();
    expect(row.status.weekdays).toBeUndefined();
  });

  describe('fails closed on an unreadable replay', () => {
    const warns = [];
    const logger = { ...silent, warn: (event, data) => warns.push({ event, data }) };
    it.each([
      ['an error answer', { error: true }],
      ['an unknowable answer (an FSRS deck)', { doneToday: null, unknowable: true, reason: 'no_history', progressLabel: null, score: null }],
      ['a non-boolean doneToday', { doneToday: null, progressLabel: null, score: null }],
    ])('%s drops the fold and keeps today', async (_name, answer) => {
      warns.length = 0;
      const l = launcher({ answerOn: { '2026-11-11': answer } });
      const [row] = await run(l, { logger });
      expect(row.status.weekdays).toBeUndefined();
      expect(row.status.doneToday).toBe(false);
      expect(row.status.error).toBeUndefined();
      expect(warns.map((w) => w.event)).toContain('school.program-status.weekday-fold-failed');
      expect(warns.find((w) => w.event === 'school.program-status.weekday-fold-failed').data.reason).toBeTruthy();
    });
    it('an unknowable day with a grown-up bypass on file is a record, not a gap', async () => {
      const unknowable = { doneToday: null, unknowable: true, reason: 'no_history', progressLabel: null, score: null };
      const l = launcher({ answerOn: { '2026-11-11': unknowable } });
      const dayBypasses = { async activeFor({ studyDate }) { return studyDate === '2026-11-11' ? { decidedBy: 'kc' } : null; } };
      const [row] = await run(l, { dayBypasses });
      expect(row.status.weekdays.doneOn).toEqual(['2026-11-11']);
    });
  });
  it('done today: nothing to offer, so no replay', async () => {
    const l = launcher({ doneOn: ['TODAY'] });
    const [row] = await run(l);
    expect(l.seen).toEqual([null]);
    expect(row.status.weekdays).toBeUndefined();
  });
  it('a once-only program is not replayed', async () => {
    const l = launcher({});
    const [row] = await run(l, { cadence: 'once' });
    expect(l.seen).toEqual([null]);
    expect(row.status.weekdays).toBeUndefined();
  });
  it('an elective program is not replayed (it is never backfilled)', async () => {
    const l = launcher({});
    const [row] = await run(l, { elective: true });
    expect(l.seen).toEqual([null]);
    expect(row.status.weekdays).toBeUndefined();
  });
  it('an entry with no cadence is daily', async () => {
    const l = launcher({});
    const [row] = await collectProgramStatuses({
      plan: { entries: [{ unitId: 'p:x', program: 'p', programInstance: null }] },
      learnerId: 'k', launchers: new Map([['p', l]]), logger: silent, studyDay: SATURDAY,
    });
    expect(row.status.weekdays).toEqual({ weekFrom: '2026-11-09', doneOn: [] });
  });

  it('an FSRS flashcard deck (no dated history) yields no fold', async () => {
    const fsrs = new FlashcardProgramLauncher({
      studyService: {
        summary: async () => ({ counts: { due: 3, new: 0, learning: 0, mastered: 1, reviewed: 0, activeSeconds: 0 }, today: { reviewed: 0, activeSeconds: 0 } }),
      },
      assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: 'deck', policy: { minimumReviews: 1 } }] }) },
    });
    const [row] = await collectProgramStatuses({
      plan: { entries: [{ unitId: 'flashcards:deck', program: 'flashcards', programInstance: 'deck', cadence: 'daily' }] },
      learnerId: 'k', launchers: new Map([['flashcards', fsrs]]), logger: silent, studyDay: SATURDAY,
    });
    expect(row.status.doneToday).toBe(false);
    expect(row.status.weekdays).toBeUndefined();
  });
});
