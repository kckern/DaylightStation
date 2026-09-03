import { describe, expect, it } from 'vitest';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { studyDayForInstant } from '#domains/school/studyDay.mjs';
import { OpenBookShelfItem } from './OpenBookShelfItem.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const CLOCK = () => new Date('2026-09-02T20:00:00.000Z');
/** The launcher's dayOf: a 4am study-day boundary in a household timezone. */
const dayOfIn = (timezone) => (iso) => studyDayForInstant(Date.parse(iso), { timezone });
const UTC_DAY = (iso) => String(iso).slice(0, 10);

function makeStore() {
  return {
    opened: [], events: [],
    async openItem(item) { this.opened.push(item); return { itemId: `kid:${item.bookId}:${item.entryId}`, ...item, events: [] }; },
    async appendEvent(event) { this.events.push(event); return event; },
    async listForLearner() { return []; },
  };
}
const resolveBook = { async execute(id) {
  return id === '9780064400558'
    ? { status: 'ok', book: { isbn13: '9780064400558', title: "Charlotte's Web", pageCount: 184 } }
    : { status: 'not-found' };
} };
const useCase = (store = makeStore()) => [new OpenBookShelfItem({ bookLog: store, resolveBook, clock: CLOCK, dayOf: UTC_DAY, logger: silent }), store];

describe('OpenBookShelfItem', () => {
  it('opens a page-mode item for a book with a page count, as "starting"', async () => {
    const [uc, store] = useCase();
    const out = await uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'starting' });
    expect(out.item.progressMode).toBe('page');
    expect(store.opened[0]).toMatchObject({ learnerId: 'kid', pageCount: 184, entryId: 'e1', openedAt: '2026-09-02T20:00:00.000Z' });
    expect(store.events).toEqual([]);
  });

  it('partway: appends a progress event with its OWN entryId', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'partway', page: 84, progressEntryId: 'p1' });
    expect(store.events[0]).toMatchObject({ kind: 'progress', page: 84, entryId: 'p1', at: '2026-09-02T20:00:00.000Z' });
  });

  it('finished: the whole item lives on the chosen day — openedAt and the finish alike', async () => {
    // "I already finished it last week" credits LAST WEEK, not today. The
    // store stamps the started event at openedAt, so openedAt must carry the
    // chosen day too, or today gets a check-in for a book read days ago.
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'finished', finishedOn: '2026-08-25', progressEntryId: 'f1' });
    expect(store.opened[0].openedAt).toBe('2026-08-25T12:00:00.000Z');
    expect(store.events[0]).toMatchObject({ kind: 'finished', entryId: 'f1', at: '2026-08-25T12:00:00.000Z' });
  });

  it('starting and partway are still opened NOW', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'starting' });
    await uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e2', where: 'partway', page: 3, progressEntryId: 'p1' });
    expect(store.opened.map((o) => o.openedAt)).toEqual(['2026-09-02T20:00:00.000Z', '2026-09-02T20:00:00.000Z']);
  });

  it('refuses a finish in the future', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'finished', finishedOn: '2027-01-01', progressEntryId: 'f1' }))
      .rejects.toThrow(/future/);
    await expect(uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'finished', finishedOn: '2027-01-01', progressEntryId: 'f1' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('the future ceiling is the household study day, not the UTC date (review m1)', async () => {
    const finish = (uc, finishedOn) => uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'finished', finishedOn, progressEntryId: 'f1' });
    // 00:30Z on the 3rd is 17:30 on the 2nd in Los Angeles — "Today" is still the 2nd.
    const pacific = new OpenBookShelfItem({
      bookLog: makeStore(), resolveBook, clock: () => new Date('2026-09-03T00:30:00.000Z'), dayOf: dayOfIn('America/Los_Angeles'), logger: silent,
    });
    await expect(finish(pacific, '2026-09-03')).rejects.toThrow(/future/);
    await expect(finish(pacific, '2026-09-02')).resolves.toMatchObject({ event: { kind: 'finished' } });
    // 20:00Z on the 2nd is 06:00 on the 3rd in Brisbane — past the 4am boundary, "Today" is the 3rd.
    const east = new OpenBookShelfItem({
      bookLog: makeStore(), resolveBook, clock: () => new Date('2026-09-02T20:00:00.000Z'), dayOf: dayOfIn('Australia/Brisbane'), logger: silent,
    });
    await expect(finish(east, '2026-09-03')).resolves.toMatchObject({ event: { kind: 'finished' } });
  });

  it('requires dayOf — the study day is never guessed from the clock alone', () => {
    expect(() => new OpenBookShelfItem({ bookLog: makeStore(), resolveBook, clock: CLOCK, logger: silent })).toThrow(/dayOf/);
  });

  it('refuses a calendar-impossible finishedOn', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'finished', finishedOn: '2026-02-31', progressEntryId: 'f1' }))
      .rejects.toThrow(/day/);
  });

  it('refuses partway without a page, and a second entryId shared with the first', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'partway', progressEntryId: 'p1' })).rejects.toThrow(/page/);
    await expect(uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'partway', page: 3, progressEntryId: 'e1' })).rejects.toThrow(/entryId/);
  });

  it('refuses a page on the starting door rather than dropping it', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'starting', page: 4 })).rejects.toThrow(/page/);
  });

  it('refuses a finishedOn on the partway door rather than dropping it', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'partway', page: 4, finishedOn: '2026-08-30', progressEntryId: 'p1' })).rejects.toThrow(/finishedOn/);
  });

  it('refuses a book the resolver does not know, before touching the store', async () => {
    const [uc, store] = useCase();
    await expect(uc.execute({ learnerId: 'kid', bookId: '9780000000000', entryId: 'e1', where: 'starting' })).rejects.toThrow(/not-found/);
    expect(store.opened).toEqual([]);
  });

  it('infers check mode when the book has no page count', async () => {
    const resolver = { async execute() { return { status: 'ok', book: { isbn13: '9780027746723', title: 'x', pageCount: null } }; } };
    const store = makeStore();
    const uc = new OpenBookShelfItem({ bookLog: store, resolveBook: resolver, clock: CLOCK, dayOf: UTC_DAY, logger: silent });
    const out = await uc.execute({ learnerId: 'kid', bookId: '9780027746723', entryId: 'e1', where: 'starting' });
    expect(out.item.progressMode).toBe('check');
  });
});
