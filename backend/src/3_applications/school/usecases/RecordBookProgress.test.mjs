import { describe, expect, it } from 'vitest';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { studyDayForInstant } from '#domains/school/studyDay.mjs';
import { RecordBookProgress } from './RecordBookProgress.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const CLOCK = () => new Date('2026-09-02T20:00:00.000Z');
/** The launcher's dayOf: a 4am study-day boundary in a household timezone. */
const dayOfIn = (timezone) => (iso) => studyDayForInstant(Date.parse(iso), { timezone });
const UTC_DAY = (iso) => String(iso).slice(0, 10);
const shelf = (mode = 'page') => [{ itemId: 'kid:b:e1', bookId: 'b', progressMode: mode, pageCount: 184, events: [{ kind: 'started', at: '2026-09-01T10:00:00.000Z' }] }];

function makeStore(items = shelf()) {
  return {
    events: [], modes: [],
    async listForLearner() { return items; },
    async appendEvent(event) { this.events.push(event); return event; },
    async setProgressMode(change) { this.modes.push(change); return { ...items[0], progressMode: change.progressMode }; },
  };
}
const useCase = (store = makeStore()) => [new RecordBookProgress({ bookLog: store, clock: CLOCK, dayOf: UTC_DAY, logger: silent }), store];

describe('RecordBookProgress', () => {
  it('records a page for a page-mode book, stamped now', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', page: 84, entryId: 'p1' });
    expect(store.events[0]).toMatchObject({ itemId: 'kid:b:e1', kind: 'progress', page: 84, entryId: 'p1', at: '2026-09-02T20:00:00.000Z' });
  });

  it('records minutes for a minutes-mode book', async () => {
    const [uc, store] = useCase(makeStore(shelf('minutes')));
    await uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', minutes: 25, entryId: 'm1' });
    expect(store.events[0]).toMatchObject({ minutes: 25 });
  });

  it('records a bare check-in for a check-mode book', async () => {
    const [uc, store] = useCase(makeStore(shelf('check')));
    await uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', entryId: 'c1' });
    expect(store.events[0]).toMatchObject({ kind: 'progress', entryId: 'c1' });
    expect(store.events[0].page).toBeUndefined();
  });

  it('refuses a page on a check-mode book and minutes on a page-mode book', async () => {
    const [uc] = useCase(makeStore(shelf('check')));
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', page: 3, entryId: 'x' })).rejects.toThrow(/mode/);
    const [uc2] = useCase();
    await expect(uc2.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', minutes: 3, entryId: 'x' })).rejects.toThrow(/mode/);
  });

  it('requires the progress value promised by page/minutes mode', async () => {
    const [pages] = useCase();
    await expect(pages.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', entryId: 'empty-page' }))
      .rejects.toThrow(/requires a page/);
    const [minutes] = useCase(makeStore(shelf('minutes')));
    await expect(minutes.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', entryId: 'empty-minutes' }))
      .rejects.toThrow(/requires minutes/);
  });

  it('refuses page/minutes payloads on lifecycle events', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'finished', page: 184, entryId: 'finish-page' }))
      .rejects.toThrow(/only apply to a progress event/);
  });

  it('accepts a page beyond the known total — editions differ', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', page: 212, entryId: 'p1' });
    expect(store.events[0].page).toBe(212);
  });

  it('finished on a chosen day lands at noon UTC of that day', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'finished', finishedOn: '2026-08-30', entryId: 'f1' });
    expect(store.events[0].at).toBe('2026-08-30T12:00:00.000Z');
  });

  it('records an append-only reopened correction for a mistaken finish', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'reopened', entryId: 'undo-f1' });
    expect(store.events[0]).toMatchObject({
      itemId: 'kid:b:e1', kind: 'reopened', entryId: 'undo-f1', at: '2026-09-02T20:00:00.000Z',
    });
  });

  it('the future ceiling is the household study day, not the UTC date (review m1)', async () => {
    const finish = (uc, finishedOn) => uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'finished', finishedOn, entryId: `f-${finishedOn}` });
    // 00:30Z on the 3rd is 17:30 on the 2nd in Los Angeles — "Today" is still the 2nd.
    const pacific = new RecordBookProgress({
      bookLog: makeStore(), clock: () => new Date('2026-09-03T00:30:00.000Z'), dayOf: dayOfIn('America/Los_Angeles'), logger: silent,
    });
    await expect(finish(pacific, '2026-09-03')).rejects.toThrow(/future/);
    await expect(finish(pacific, '2026-09-02')).resolves.toMatchObject({ event: { kind: 'finished' } });
    // 20:00Z on the 2nd is 06:00 on the 3rd in Brisbane — past the 4am boundary, "Today" is the 3rd.
    const east = new RecordBookProgress({
      bookLog: makeStore(), clock: () => new Date('2026-09-02T20:00:00.000Z'), dayOf: dayOfIn('Australia/Brisbane'), logger: silent,
    });
    await expect(finish(east, '2026-09-03')).resolves.toMatchObject({ event: { kind: 'finished' } });
  });

  it('requires dayOf — the study day is never guessed from the clock alone', () => {
    expect(() => new RecordBookProgress({ bookLog: makeStore(), clock: CLOCK, logger: silent })).toThrow(/dayOf/);
  });

  it('refuses a calendar-impossible finishedOn', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'finished', finishedOn: '2026-02-31', entryId: 'f1' }))
      .rejects.toThrow(/day/);
  });

  it('refuses finishedOn on a non-finished event rather than dropping it', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', finishedOn: '2026-08-30', page: 3, entryId: 'x' })).rejects.toThrow(/finishedOn/);
  });

  it('refuses a rating outside 1..5', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', page: 3, rating: 9, entryId: 'x' })).rejects.toThrow(/rating/);
  });

  it("refuses an item that is not on this learner's shelf", async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:other:e9', kind: 'progress', page: 1, entryId: 'p' })).rejects.toThrow(/shelf/);
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:other:e9', kind: 'progress', page: 1, entryId: 'p' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses an unknown kind and a missing entryId', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'paused', entryId: 'p' })).rejects.toThrow(/kind/);
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', page: 1 })).rejects.toThrow(/entryId/);
  });

  it('switches mode through the store', async () => {
    const [uc, store] = useCase();
    const out = await uc.setMode({ learnerId: 'kid', itemId: 'kid:b:e1', progressMode: 'check' });
    expect(store.modes[0]).toEqual({ itemId: 'kid:b:e1', progressMode: 'check' });
    expect(out.progressMode).toBe('check');
  });
});
