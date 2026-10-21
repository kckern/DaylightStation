import { describe, expect, it, vi } from 'vitest';
import { HAPPENED, SKIP, failureMessage, performPlan, planFor } from "./logBookPlan.js";

const ISBN = '9780000000002';
const DAY = '2026-09-06';
const open = (over = {}) => ({ learnerId: 'learner_b', openReading: { id: 'rdg_b', progressMode: 'check', pageCount: 32, revisionCount: 2, ...over } });
const fresh = { learnerId: 'learner_c', openReading: null };

describe('planFor — a child with no open reading of this book', () => {
  it('finished: opens a finished reading and sends no day (the server supplies the study day)', () => {
    expect(planFor(fresh, { isbn: ISBN, happened: HAPPENED.FINISHED, mode: 'check', studyDay: DAY }))
      .toEqual({ kind: 'new', body: { isbn: ISBN, progressMode: 'check', where: 'finished' } });
  });

  it('started: opens it in the chosen mode', () => {
    expect(planFor(fresh, { isbn: ISBN, happened: HAPPENED.STARTED, mode: 'page', studyDay: DAY }))
      .toEqual({ kind: 'new', body: { isbn: ISBN, progressMode: 'page', where: 'starting' } });
  });

  it('partway: page mode, with the page', () => {
    expect(planFor(fresh, { isbn: ISBN, happened: HAPPENED.PARTWAY, page: 40, mode: 'page', studyDay: DAY }))
      .toEqual({ kind: 'new', body: { isbn: ISBN, progressMode: 'page', where: 'partway', page: 40 } });
  });
});

describe('planFor — a child reading it now', () => {
  it('finished (check mode): today’s check-in, then the finish, on THAT reading', () => {
    expect(planFor(open(), { isbn: ISBN, happened: HAPPENED.FINISHED, mode: 'page', studyDay: DAY })).toEqual({
      kind: 'open', readingId: 'rdg_b', baseRevisionCount: 2,
      entry: { on: DAY }, finish: { status: 'finished', finishedOn: DAY },
    });
  });

  it('finished (page mode, length known): the last page is today’s evidence', () => {
    expect(planFor(open({ progressMode: 'page', pageCount: 180 }), { isbn: ISBN, happened: HAPPENED.FINISHED, studyDay: DAY }))
      .toMatchObject({ kind: 'open', entry: { on: DAY, page: 180 }, finish: { status: 'finished', finishedOn: DAY } });
  });

  it('finished (page mode, length unknown, or minutes): the finish alone, no invented number', () => {
    expect(planFor(open({ progressMode: 'page', pageCount: null }), { isbn: ISBN, happened: HAPPENED.FINISHED, studyDay: DAY }))
      .toMatchObject({ kind: 'open', entry: null, finish: { status: 'finished' } });
    expect(planFor(open({ progressMode: 'minutes' }), { isbn: ISBN, happened: HAPPENED.FINISHED, studyDay: DAY }))
      .toMatchObject({ kind: 'open', entry: null });
  });

  it('started or partway (check mode): a check-in today', () => {
    for (const happened of [HAPPENED.STARTED, HAPPENED.PARTWAY]) {
      expect(planFor(open(), { isbn: ISBN, happened, page: 12, studyDay: DAY }))
        .toMatchObject({ kind: 'open', entry: { on: DAY }, finish: null });
    }
  });

  it('partway (page mode): the page, today', () => {
    expect(planFor(open({ progressMode: 'page' }), { isbn: ISBN, happened: HAPPENED.PARTWAY, page: 60, studyDay: DAY }))
      .toMatchObject({ kind: 'open', entry: { on: DAY, page: 60 }, finish: null });
  });

  it('started on a page- or minutes-mode reading is refused by name, never guessed', () => {
    expect(planFor(open({ progressMode: 'page' }), { isbn: ISBN, happened: HAPPENED.STARTED, studyDay: DAY }))
      .toMatchObject({ kind: 'skip', reason: expect.stringMatching(/Partway/) });
    expect(planFor(open({ progressMode: 'minutes' }), { isbn: ISBN, happened: HAPPENED.PARTWAY, page: 3, studyDay: DAY }))
      .toMatchObject({ kind: 'skip', reason: expect.stringMatching(/minutes/) });
  });
});

describe('planFor — a page the save cannot go without', () => {
  it('partway with no page is refused by name, never sent to a 400', () => {
    expect(planFor(fresh, { isbn: ISBN, happened: HAPPENED.PARTWAY, page: null, studyDay: DAY }))
      .toMatchObject({ kind: 'skip', code: SKIP.NEEDS_PAGE });
    expect(planFor(open({ progressMode: 'page' }), { isbn: ISBN, happened: HAPPENED.PARTWAY, page: 0, studyDay: DAY }))
      .toMatchObject({ kind: 'skip', code: SKIP.NEEDS_PAGE });
  });

  it('a check-mode reading needs no page for partway', () => {
    expect(planFor(open(), { isbn: ISBN, happened: HAPPENED.PARTWAY, page: null, studyDay: DAY }))
      .toMatchObject({ kind: 'open', entry: { on: DAY } });
  });
});

describe('planFor — a retry after an earlier save was planned against a reading', () => {
  const choice = { isbn: ISBN, happened: HAPPENED.FINISHED, studyDay: DAY };

  it('the same reading still open: plan on it as usual', () => {
    expect(planFor(open(), choice, { previousReadingId: 'rdg_b' })).toMatchObject({ kind: 'open', readingId: 'rdg_b' });
  });

  it('that reading finished today (the lost finish landed): done, nothing to send', () => {
    const reader = { learnerId: 'learner_b', openReading: null, finishedTodayIds: ['rdg_b'] };
    expect(planFor(reader, choice, { previousReadingId: 'rdg_b' })).toEqual({ kind: 'done', readingId: 'rdg_b' });
  });

  it('that reading gone some other way: refused, never a second new reading', () => {
    const gone = { learnerId: 'learner_b', openReading: null, finishedTodayIds: [] };
    expect(planFor(gone, choice, { previousReadingId: 'rdg_b' }))
      .toMatchObject({ kind: 'skip', code: SKIP.CHANGED, reason: expect.stringMatching(/changed/) });
    const other = { learnerId: 'learner_b', openReading: { id: 'rdg_other', progressMode: 'check', revisionCount: 0 } };
    expect(planFor(other, choice, { previousReadingId: 'rdg_b' })).toMatchObject({ kind: 'skip', code: SKIP.CHANGED });
  });
});

describe('performPlan', () => {
  const api = () => ({
    addReadingForLearner: vi.fn(async () => ({ ok: true, status: 201, data: {} })),
    addReadingEntry: vi.fn(async () => ({ ok: true, status: 201, data: {} })),
    updateReading: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
  });

  it('a new reading is one idempotent POST on the child’s key', async () => {
    const calls = api();
    const progress = { key: 'k1', entryDone: false, plan: { kind: 'new', body: { isbn: ISBN, progressMode: 'check', where: 'finished' } } };
    await performPlan(calls, { learnerId: 'learner_c', progress, actorId: 'test-user' });
    expect(calls.addReadingForLearner).toHaveBeenCalledWith('learner_c', { isbn: ISBN, progressMode: 'check', where: 'finished', by: 'test-user' }, 'k1');
  });

  it('an open reading: the entry, then the finish one revision later', async () => {
    const calls = api();
    const progress = { key: 'k2', entryDone: false, plan: planFor(open(), { isbn: ISBN, happened: HAPPENED.FINISHED, studyDay: DAY }) };
    const result = await performPlan(calls, { learnerId: 'learner_b', progress, actorId: 'test-user' });
    expect(result.ok).toBe(true);
    expect(calls.addReadingEntry).toHaveBeenCalledWith('learner_b', 'rdg_b', { on: DAY, baseRevisionCount: 2 }, 'k2:entry');
    expect(calls.updateReading).toHaveBeenCalledWith('learner_b', 'rdg_b', { status: 'finished', finishedOn: DAY, baseRevisionCount: 3 });
    expect(progress.entryDone).toBe(true);
  });

  it('a retry after the entry landed sends only the finish, on the fresh count', async () => {
    const calls = api();
    const progress = { key: 'k2', entryDone: true, plan: planFor(open({ revisionCount: 3 }), { isbn: ISBN, happened: HAPPENED.FINISHED, studyDay: DAY }) };
    await performPlan(calls, { learnerId: 'learner_b', progress, actorId: 'test-user' });
    expect(calls.addReadingEntry).not.toHaveBeenCalled();
    expect(calls.updateReading).toHaveBeenCalledWith('learner_b', 'rdg_b', expect.objectContaining({ baseRevisionCount: 3 }));
  });

  it('stops at a refused entry and does not finish', async () => {
    const calls = api();
    calls.addReadingEntry.mockResolvedValue({ ok: false, status: 409, data: { error: 'This reading changed since you loaded it — reload and try again.' } });
    const progress = { key: 'k2', entryDone: false, plan: planFor(open(), { isbn: ISBN, happened: HAPPENED.FINISHED, studyDay: DAY }) };
    const result = await performPlan(calls, { learnerId: 'learner_b', progress, actorId: 'test-user' });
    expect(result.ok).toBe(false);
    expect(calls.updateReading).not.toHaveBeenCalled();
    expect(failureMessage(result)).toMatch(/changed since you loaded it/);
  });

  it('a skip writes nothing and carries its reason', async () => {
    const calls = api();
    const result = await performPlan(calls, { learnerId: 'learner_b', progress: { key: 'k', entryDone: false, plan: { kind: 'skip', reason: 'No.' } }, actorId: 't' });
    expect(result).toMatchObject({ ok: false, skipped: true });
    expect(failureMessage(result)).toBe('No.');
    expect(calls.addReadingForLearner).not.toHaveBeenCalled();
  });

  it('chains the finish on the count the entry response served', async () => {
    const calls = api();
    calls.addReadingEntry.mockResolvedValue({ ok: true, status: 201, data: { result: { id: 'ent_1' }, revisionCount: 7 } });
    const progress = { key: 'k2', entryDone: false, plan: planFor(open(), { isbn: ISBN, happened: HAPPENED.FINISHED, studyDay: DAY }) };
    await performPlan(calls, { learnerId: 'learner_b', progress, actorId: 'test-user' });
    expect(calls.updateReading).toHaveBeenCalledWith('learner_b', 'rdg_b', expect.objectContaining({ baseRevisionCount: 7 }));
  });

  it('a lost entry response: the retry replays the entry key and finishes on the served count', async () => {
    const calls = api();
    // First try: the entry landed (revision 2 -> 3) but the response never came back.
    calls.addReadingEntry.mockResolvedValueOnce({ ok: false, status: 0, data: null });
    const progress = { key: 'k2', entryDone: false, plan: planFor(open(), { isbn: ISBN, happened: HAPPENED.FINISHED, studyDay: DAY }) };
    const first = await performPlan(calls, { learnerId: 'learner_b', progress, actorId: 'test-user' });
    expect(first.ok).toBe(false);
    expect(progress.entryDone).toBe(false);
    // Retry from a fresh read that already counts the landed entry: the server
    // replays the key and serves the count unchanged.
    calls.addReadingEntry.mockResolvedValueOnce({ ok: true, status: 201, data: { result: { id: 'ent_1' }, revisionCount: 3, replayed: true } });
    progress.plan = planFor(open({ revisionCount: 3 }), { isbn: ISBN, happened: HAPPENED.FINISHED, studyDay: DAY }, { previousReadingId: 'rdg_b' });
    const retry = await performPlan(calls, { learnerId: 'learner_b', progress, actorId: 'test-user' });
    expect(retry.ok).toBe(true);
    expect(calls.addReadingEntry).toHaveBeenLastCalledWith('learner_b', 'rdg_b', { on: DAY, baseRevisionCount: 3 }, 'k2:entry');
    expect(calls.updateReading).toHaveBeenCalledWith('learner_b', 'rdg_b', expect.objectContaining({ baseRevisionCount: 3 }));
  });

  it('done writes nothing and reports success', async () => {
    const calls = api();
    const result = await performPlan(calls, { learnerId: 'learner_b', progress: { key: 'k', entryDone: true, plan: { kind: 'done', readingId: 'rdg_b' } }, actorId: 't' });
    expect(result).toMatchObject({ ok: true, alreadyDone: true });
    expect(calls.updateReading).not.toHaveBeenCalled();
    expect(calls.addReadingEntry).not.toHaveBeenCalled();
  });

  it('failureMessage never shows an empty sentence', () => {
    expect(failureMessage({ ok: false, data: { error: '' } })).toBe('That didn’t save. Try again.');
    expect(failureMessage({ ok: false, data: { error: { message: '  ' } } })).toBe('That didn’t save. Try again.');
    expect(failureMessage({ ok: false, message: '' })).toBe('That didn’t save. Try again.');
  });
});
