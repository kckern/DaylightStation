import { describe, expect, it } from 'vitest';
import { GetBookShelf } from './GetBookShelf.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const items = [
  { id: 'rdg_b', learnerId: 'kid', book: { isbn: 'b', pageCount: 184 }, progressMode: 'page',
    status: 'reading', openedOn: '2026-09-01', finishedOn: null, revisions: [],
    entries: [{ id: 'ent_1', on: '2026-09-02', at: '2026-09-02T10:00:00.000Z', page: 84, source: 'panel' }] },
  { id: 'rdg_c', learnerId: 'kid', book: { isbn: 'c', pageCount: null }, progressMode: 'check',
    status: 'finished', openedOn: '2026-08-20', finishedOn: '2026-08-28', revisions: [],
    entries: [{ id: 'ent_2', on: '2026-08-28', at: '2026-08-28T12:00:00.000Z', source: 'panel' }] },
];
const deps = (over = {}) => ({
  bookLog: { async listForLearner() { return items; } },
  bookRepository: { async findByIsbn(id) { return id === 'b' ? { isbn13: 'b', title: 'Hatchet', subtitle: 'A Novel', authors: ['Gary Paulsen'], coverUrl: 'https://c/h.jpg' } : null; } },
  bookLogLauncher: {
    dayOf: (iso) => String(iso).slice(0, 10),
    async status({ userId }) { return { enrolled: true, progressLabel: '1 of 1 check-in', obligationProgress: { actual: 1, target: 1, metric: 'checkins', incompatibleBooks: [] } }; },
  },
  logger: silent,
  ...over,
});

describe('GetBookShelf', () => {
  it('returns every item with its projection and the book facts the tile needs', async () => {
    const view = await new GetBookShelf(deps()).execute({ learnerId: 'kid' });
    const hatchet = view.items.find((i) => i.itemId === 'rdg_b');
    expect(hatchet).toMatchObject({ title: 'Hatchet', subtitle: 'A Novel', authors: ['Gary Paulsen'], coverUrl: 'https://c/h.jpg',
      projection: { status: 'reading', page: 84, percent: 46 } });
  });

  it('survives a book the repository does not have — a shelf item is not lost for a missing cover', async () => {
    const view = await new GetBookShelf(deps()).execute({ learnerId: 'kid' });
    const c = view.items.find((i) => i.itemId === 'rdg_c');
    expect(c).toMatchObject({ title: null, coverUrl: null, projection: { status: 'finished', percent: 100 } });
  });

  it('names the study day the shelf is being read on — dayOf(now), never the UTC date (review m2)', async () => {
    // 00:30Z on the 3rd is 17:30 on the 2nd in a Pacific household: the study day is the 2nd.
    const pacific = (iso) => (String(iso) >= '2026-09-03T11:00:00.000Z' ? '2026-09-03' : '2026-09-02');
    const view = await new GetBookShelf(deps({
      clock: () => new Date('2026-09-03T00:30:00.000Z'),
      bookLogLauncher: { dayOf: pacific, async status() { return { obligationProgress: null }; } },
    })).execute({ learnerId: 'kid' });
    expect(view.studyDay).toBe('2026-09-02');
  });

  it('orders most recently touched first', async () => {
    const view = await new GetBookShelf(deps()).execute({ learnerId: 'kid' });
    expect(view.items.map((i) => i.itemId)).toEqual(['rdg_b', 'rdg_c']);
  });

  it('carries the obligation line from the launcher, or null when there is none', async () => {
    const withIt = await new GetBookShelf(deps()).execute({ learnerId: 'kid' });
    expect(withIt.obligation).toMatchObject({ label: '1 of 1 check-in', actual: 1, target: 1, metric: 'checkins' });
    const without = await new GetBookShelf(deps({ bookLogLauncher: { dayOf: (i) => String(i).slice(0, 10), async status({ userId }) { return { enrolled: true, progressLabel: 'No books yet', obligationProgress: null }; } } })).execute({ learnerId: 'kid' });
    expect(without.obligation).toBeNull();
  });

  it('asks the launcher with { userId } — the same shape the agenda collector uses', async () => {
    const calls = [];
    const launcher = { dayOf: (i) => String(i).slice(0, 10), async status(arg) { calls.push(arg); return { obligationProgress: null }; } };
    await new GetBookShelf(deps({ bookLogLauncher: launcher })).execute({ learnerId: 'kid' });
    expect(calls).toEqual([{ userId: 'kid' }]);
  });

  it('counts days from the entries themselves — no rule is applied to an instant', async () => {
    // The v1 path needed the launcher's dayOf here, and a shelf projected with
    // the wrong one disagreed with the agenda about the same child. `on` is
    // already a study day, so there is nothing left to disagree about.
    const twice = {
      ...items[0],
      entries: [
        { id: 'ent_a', on: '2026-09-02', at: '2026-09-02T10:00:00.000Z', page: 40 },
        { id: 'ent_b', on: '2026-09-02', at: '2026-09-02T23:30:00.000Z', page: 84 },
      ],
    };
    const view = await new GetBookShelf(deps({ bookLog: { async listForLearner() { return [twice]; } } })).execute({ learnerId: 'kid' });
    expect(view.items[0].projection).toMatchObject({ daysRead: 1, page: 84, lastOn: '2026-09-02' });
  });

  it('sorts a reading with nothing logged yet last, and still shows it', async () => {
    const fresh = {
      id: 'rdg_d', learnerId: 'kid', book: { isbn: 'd', pageCount: null }, progressMode: 'check',
      status: 'reading', openedOn: '2026-09-03', finishedOn: null, entries: [], revisions: [],
    };
    const view = await new GetBookShelf(deps({ bookLog: { async listForLearner() { return [fresh, ...items]; } } })).execute({ learnerId: 'kid' });
    expect(view.items.map((i) => i.itemId)).toEqual(['rdg_b', 'rdg_c', 'rdg_d']);
    expect(view.items.at(-1).projection).toMatchObject({ status: 'reading', daysRead: 0, lastAt: null });
  });

  it('refuses a missing learnerId', async () => {
    await expect(new GetBookShelf(deps()).execute({})).rejects.toThrow(/learnerId/);
  });
});
