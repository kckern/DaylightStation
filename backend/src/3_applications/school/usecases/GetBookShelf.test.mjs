import { describe, expect, it } from 'vitest';
import { GetBookShelf } from './GetBookShelf.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const items = [
  { itemId: 'kid:b:e1', bookId: 'b', progressMode: 'page', pageCount: 184, openedAt: '2026-09-01T10:00:00.000Z',
    events: [{ kind: 'started', at: '2026-09-01T10:00:00.000Z' }, { kind: 'progress', at: '2026-09-02T10:00:00.000Z', page: 84 }] },
  { itemId: 'kid:c:e2', bookId: 'c', progressMode: 'check', pageCount: null, openedAt: '2026-08-20T10:00:00.000Z',
    events: [{ kind: 'started', at: '2026-08-20T10:00:00.000Z' }, { kind: 'finished', at: '2026-08-28T12:00:00.000Z' }] },
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
    const hatchet = view.items.find((i) => i.itemId === 'kid:b:e1');
    expect(hatchet).toMatchObject({ title: 'Hatchet', subtitle: 'A Novel', authors: ['Gary Paulsen'], coverUrl: 'https://c/h.jpg',
      projection: { status: 'reading', page: 84, percent: 46 } });
  });

  it('survives a book the repository does not have — a shelf item is not lost for a missing cover', async () => {
    const view = await new GetBookShelf(deps()).execute({ learnerId: 'kid' });
    const c = view.items.find((i) => i.itemId === 'kid:c:e2');
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
    expect(view.items.map((i) => i.itemId)).toEqual(['kid:b:e1', 'kid:c:e2']);
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

  it('counts days with the launcher\'s dayOf, so the agenda and the card agree', async () => {
    // A day-SHIFTING rule: every 2026-09-02 instant belongs to 09-01, so both of
    // Hatchet's events fold onto ONE day. The ISO default would say two.
    let asked = 0;
    const shifting = (iso) => { asked += 1; return String(iso).slice(0, 10).replace('2026-09-02', '2026-09-01'); };
    const view = await new GetBookShelf(deps({ bookLogLauncher: { dayOf: shifting, async status({ userId }) { return { obligationProgress: null }; } } })).execute({ learnerId: 'kid' });
    expect(asked).toBeGreaterThan(0);
    expect(view.items[0].projection.daysRead).toBe(1);
  });

  it('sorts an unread item (no events yet) last, projected as unread', async () => {
    const unread = { itemId: 'kid:d:e3', bookId: 'd', progressMode: 'check', pageCount: null, openedAt: '2026-09-03T10:00:00.000Z', events: [] };
    const view = await new GetBookShelf(deps({ bookLog: { async listForLearner() { return [unread, ...items]; } } })).execute({ learnerId: 'kid' });
    expect(view.items.map((i) => i.itemId)).toEqual(['kid:b:e1', 'kid:c:e2', 'kid:d:e3']);
    expect(view.items.at(-1).projection).toMatchObject({ status: 'unread' });
  });

  it('refuses a missing learnerId', async () => {
    await expect(new GetBookShelf(deps()).execute({})).rejects.toThrow(/learnerId/);
  });
});
