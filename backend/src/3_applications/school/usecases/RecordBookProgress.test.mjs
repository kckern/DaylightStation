import { describe, expect, it } from 'vitest';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { studyDayForInstant } from '#domains/school/studyDay.mjs';
import { RecordBookProgress } from './RecordBookProgress.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const CLOCK = () => new Date('2026-09-02T20:00:00.000Z');
/** The launcher's dayOf: a 4am study-day boundary in a household timezone. */
const dayOfIn = (timezone) => (iso) => studyDayForInstant(Date.parse(iso), { timezone });
const UTC_DAY = (iso) => String(iso).slice(0, 10);
const shelf = (mode = 'page', over = {}) => [{
  id: 'rdg_one', learnerId: 'kid', book: { isbn: 'b', pageCount: 184 }, progressMode: mode,
  status: 'reading', openedOn: '2026-09-01', finishedOn: null, entries: [], revisions: [], ...over,
}];

function makeStore(readings = shelf()) {
  return {
    entries: [], updates: [], deleted: [],
    async listForLearner() { return readings; },
    async deleteEntry(change) { this.deleted.push(change); return { id: change.entryId }; },
    async appendEntry(entry) { this.entries.push(entry); return { id: `ent_${entry.idempotencyKey}`, ...entry }; },
    async updateReading(change) { this.updates.push(change); return { ...readings[0], ...change.patch }; },
  };
}
const useCase = (store = makeStore()) => [new RecordBookProgress({ bookLog: store, clock: CLOCK, dayOf: UTC_DAY, logger: silent }), store];

describe('RecordBookProgress', () => {
  it('records a page for a page-mode book, stamped now', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', page: 84, entryId: 'p1' });
    expect(store.entries[0]).toMatchObject({
      learnerId: 'kid', readingId: 'rdg_one', page: 84, idempotencyKey: 'p1',
      on: '2026-09-02', at: '2026-09-02T20:00:00.000Z',
    });
    expect(store.updates).toEqual([]);
  });

  it('records minutes for a minutes-mode book', async () => {
    const [uc, store] = useCase(makeStore(shelf('minutes')));
    await uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', minutes: 25, entryId: 'm1' });
    expect(store.entries[0]).toMatchObject({ minutes: 25 });
  });

  it('records a bare check-in for a check-mode book', async () => {
    const [uc, store] = useCase(makeStore(shelf('check')));
    await uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', entryId: 'c1' });
    expect(store.entries[0]).toMatchObject({ idempotencyKey: 'c1', on: '2026-09-02' });
    expect(store.entries[0].page).toBeUndefined();
  });

  it('refuses a page on a check-mode book and minutes on a page-mode book', async () => {
    const [uc] = useCase(makeStore(shelf('check')));
    await expect(uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', page: 3, entryId: 'x' })).rejects.toThrow(/mode/);
    const [uc2] = useCase();
    await expect(uc2.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', minutes: 3, entryId: 'x' })).rejects.toThrow(/mode/);
  });

  it('requires the progress value promised by page/minutes mode', async () => {
    const [pages] = useCase();
    await expect(pages.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', entryId: 'empty-page' }))
      .rejects.toThrow(/requires a page/);
    const [minutes] = useCase(makeStore(shelf('minutes')));
    await expect(minutes.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', entryId: 'empty-minutes' }))
      .rejects.toThrow(/requires minutes/);
  });

  it('refuses page/minutes payloads on lifecycle events', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'finished', page: 184, entryId: 'finish-page' }))
      .rejects.toThrow(/only apply to a progress event/);
  });

  it('accepts a page beyond the known total — editions differ', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', page: 212, entryId: 'p1' });
    expect(store.entries[0].page).toBe(212);
  });

  it('a finish on a chosen day is dated that day and recorded now', async () => {
    // No noon-UTC fiction: `on` is the day the child names, `at` is the instant
    // the tap happened, and the state is SET rather than implied by a row.
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'finished', finishedOn: '2026-08-30', entryId: 'f1' });
    expect(store.entries[0]).toMatchObject({ on: '2026-08-30', at: '2026-09-02T20:00:00.000Z' });
    expect(store.updates[0].patch).toEqual({ status: 'finished', finishedOn: '2026-08-30' });
  });

  it('takes back a mistaken finish by clearing the state, not by cancelling an event', async () => {
    const finished = shelf('page', {
      status: 'finished',
      finishedOn: '2026-09-01',
      entries: [{ id: 'ent_finish', kind: 'finished', on: '2026-09-01', at: '2026-09-01T20:00:00.000Z', source: 'panel' }],
    });
    const [uc, store] = useCase(makeStore(finished));
    await uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'reopened', entryId: 'undo-f1' });
    expect(store.updates[0].patch).toEqual({ status: 'reading', finishedOn: null });
    // `reopened` existed only to negate `finished`. It writes no evidence — it
    // withdraws what the finish wrote, credit for that day included.
    expect(store.entries).toEqual([]);
    expect(store.deleted).toEqual([{ learnerId: 'kid', readingId: 'rdg_one', entryId: 'ent_finish' }]);
  });

  it('leaves a real page log alone when a finish is undone', async () => {
    const finished = shelf('page', {
      status: 'finished',
      finishedOn: '2026-09-01',
      entries: [{ id: 'ent_pages', on: '2026-09-01', at: '2026-09-01T19:00:00.000Z', page: 120 }],
    });
    const [uc, store] = useCase(makeStore(finished));
    await uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'reopened', entryId: 'undo-f1' });
    expect(store.deleted).toEqual([]);
  });

  it('sets a book aside, and picking it back up resumes it', async () => {
    const [aside, asideStore] = useCase();
    await aside.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'set-aside', entryId: 's1' });
    expect(asideStore.updates[0].patch).toEqual({ status: 'set-aside' });
    expect(asideStore.entries).toEqual([]);

    const [resume, resumeStore] = useCase(makeStore(shelf('page', { status: 'set-aside' })));
    await resume.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', page: 90, entryId: 'p9' });
    expect(resumeStore.entries[0]).toMatchObject({ page: 90 });
    expect(resumeStore.updates[0].patch).toEqual({ status: 'reading' });
  });

  it('logging a page in a finished book does not un-finish it', async () => {
    const [uc, store] = useCase(makeStore(shelf('page', { status: 'finished', finishedOn: '2026-09-01' })));
    await uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', page: 90, entryId: 'p9' });
    expect(store.updates).toEqual([]);
  });

  it('the future ceiling is the household study day, not the UTC date (review m1)', async () => {
    const finish = (uc, finishedOn) => uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'finished', finishedOn, entryId: `f-${finishedOn}` });
    // 00:30Z on the 3rd is 17:30 on the 2nd in Los Angeles — "Today" is still the 2nd.
    const pacific = new RecordBookProgress({
      bookLog: makeStore(), clock: () => new Date('2026-09-03T00:30:00.000Z'), dayOf: dayOfIn('America/Los_Angeles'), logger: silent,
    });
    await expect(finish(pacific, '2026-09-03')).rejects.toThrow(/future/);
    await expect(finish(pacific, '2026-09-02')).resolves.toMatchObject({ item: { status: 'finished', finishedOn: '2026-09-02' } });
    // 20:00Z on the 2nd is 06:00 on the 3rd in Brisbane — past the 4am boundary, "Today" is the 3rd.
    const east = new RecordBookProgress({
      bookLog: makeStore(), clock: () => new Date('2026-09-02T20:00:00.000Z'), dayOf: dayOfIn('Australia/Brisbane'), logger: silent,
    });
    await expect(finish(east, '2026-09-03')).resolves.toMatchObject({ item: { status: 'finished', finishedOn: '2026-09-03' } });
  });

  it('requires dayOf — the study day is never guessed from the clock alone', () => {
    expect(() => new RecordBookProgress({ bookLog: makeStore(), clock: CLOCK, logger: silent })).toThrow(/dayOf/);
  });

  it('refuses a calendar-impossible finishedOn', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'finished', finishedOn: '2026-02-31', entryId: 'f1' }))
      .rejects.toThrow(/day/);
  });

  it('refuses finishedOn on a non-finished event rather than dropping it', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', finishedOn: '2026-08-30', page: 3, entryId: 'x' })).rejects.toThrow(/finishedOn/);
  });

  it('refuses a rating outside 1..5', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', page: 3, rating: 9, entryId: 'x' })).rejects.toThrow(/rating/);
  });

  it("refuses an item that is not on this learner's shelf", async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'rdg_missing', kind: 'progress', page: 1, entryId: 'p' })).rejects.toThrow(/shelf/);
    await expect(uc.execute({ learnerId: 'kid', itemId: 'rdg_missing', kind: 'progress', page: 1, entryId: 'p' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses an unknown kind and a missing entryId', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'paused', entryId: 'p' })).rejects.toThrow(/kind/);
    await expect(uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'progress', page: 1 })).rejects.toThrow(/entryId/);
  });

  it('switches mode through the store', async () => {
    const [uc, store] = useCase();
    const out = await uc.setMode({ learnerId: 'kid', itemId: 'rdg_one', progressMode: 'check' });
    expect(store.updates[0]).toEqual({ learnerId: 'kid', readingId: 'rdg_one', patch: { progressMode: 'check' } });
    expect(out.progressMode).toBe('check');
  });
});


it('undo removes the marked finish and preserves a later independent check-in', async () => {
  const [uc, store] = useCase(makeStore(shelf('check', {
    status: 'finished', finishedOn: '2026-09-01', entries: [
      { id: 'ent_finish', kind: 'finished', on: '2026-09-01' },
      { id: 'ent_check', kind: 'progress', on: '2026-09-01' },
    ],
  })));
  await uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'reopened', entryId: 'undo' });
  expect(store.deleted.map(entry => entry.entryId)).toEqual(['ent_finish']);
});
it('undo preserves ambiguous historical v2 check-ins without a finish marker', async () => {
  const [uc, store] = useCase(makeStore(shelf('check', {
    status: 'finished', finishedOn: '2026-09-01', entries: [{ id: 'ent_check', on: '2026-09-01' }],
  })));
  await uc.execute({ learnerId: 'kid', itemId: 'rdg_one', kind: 'reopened', entryId: 'undo' });
  expect(store.deleted).toEqual([]);
});
