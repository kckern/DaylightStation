/**
 * THE GUARD ON WHAT A READING LOG WILL ACCEPT.
 *
 * Two rules added 2026-09-06 after a shelf audit found entries no honest
 * reading session produces:
 *
 *   - page **250** logged against a **192**-page book, followed by page 5
 *     fifteen seconds later — a keypad being mashed, not a book being read;
 *   - a book started `2026-09-06T15:07Z` whose `finished` event was stamped
 *     `2026-08-19T12:00:00Z`, eighteen days BEFORE it was opened, which drops
 *     credit into a week the gradebook has already reported on.
 *
 * WHY THIS FILE LIVES HERE and not beside the use cases it covers. The
 * colocated backend specs (`RecordBookProgress.test.mjs`,
 * `OpenBookShelfItem.test.mjs`, `bookShelf.test.mjs`) are NOT swept by the
 * isolated harness — `findColocatedTestFiles` walks `frontend/src` ONLY
 * (`isolated.harness.mjs`), so those 64 assertions never run in CI. Rules that
 * exist to refuse falsified data have to run on every push, so they are
 * asserted here, in a directory the harness actually walks
 * (`applications` is a VITEST target).
 *
 * BOTH DOORS, DELIBERATELY. A finish can be recorded two ways — `RecordBookProgress`
 * on a book already on the shelf, and `OpenBookShelfItem`'s `finished` door for
 * a book being logged as already-read. The second is the one a far-backdated
 * entry actually travels, so bounding only the first would leave the hole open.
 * Every backdate case below is asserted against both.
 */
import { describe, expect, it } from 'vitest';
import { RecordBookProgress } from '#apps/school/usecases/RecordBookProgress.mjs';
import { OpenBookShelfItem } from '#apps/school/usecases/OpenBookShelfItem.mjs';
import {
  isPlausiblePage, isBackdateAllowed, MAX_BACKDATE_DAYS,
} from '#domains/school/bookShelf.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

const NOW = '2026-09-06T20:00:00.000Z';
const TODAY = '2026-09-06';
const CLOCK = () => new Date(NOW);
const dayOf = (iso) => String(iso).slice(0, 10);

/** The real shelf shape the audit was run against: a 192-page book. */
const item = (over = {}) => ({
  itemId: 'test-learner:b:e1', bookId: 'b', progressMode: 'page', pageCount: 192,
  events: [{ kind: 'started', at: '2026-09-06T15:07:00.000Z' }], ...over,
});

function progressStore(items = [item()]) {
  return {
    events: [],
    async listForLearner() { return items; },
    async appendEvent(event) { this.events.push(event); return event; },
  };
}

const recorder = (store) => new RecordBookProgress({
  bookLog: store, clock: CLOCK, dayOf, logger: silent,
});

function openStore() {
  return {
    events: [], opened: [],
    async openItem(args) { this.opened.push(args); return { itemId: 'test-learner:b:e2', ...args }; },
    async appendEvent(event) { this.events.push(event); return event; },
  };
}

/** `pageCount: null` is the ordinary case, so it is a parameter here. */
const opener = (store, pageCount = 192) => new OpenBookShelfItem({
  bookLog: store,
  resolveBook: { async execute() { return { status: 'ok', book: { isbn13: '9780000000002', pageCount } }; } },
  clock: CLOCK, dayOf, logger: silent,
});

const daysBack = (n) => new Date(Date.parse(`${TODAY}T12:00:00.000Z`) - n * 86_400_000)
  .toISOString().slice(0, 10);

describe('reading shelf — the page ceiling', () => {
  it('KEEPS the 212-of-184 case: a page past the stated length is still evidence', async () => {
    // The prior product decision (`percentFor`: "Clamp the BAR, keep the page")
    // must survive. A hard `page <= pageCount` would reverse it and start
    // refusing mispaginated editions, omnibus volumes and other printings.
    const store = progressStore([item({ pageCount: 184 })]);
    await recorder(store).execute({
      learnerId: 'test-learner', itemId: 'test-learner:b:e1', kind: 'progress', page: 212, entryId: 'p1',
    });
    expect(store.events[0]).toMatchObject({ page: 212 });
  });

  it('refuses the audited 250-of-192', async () => {
    const store = progressStore();
    await expect(recorder(store).execute({
      learnerId: 'test-learner', itemId: 'test-learner:b:e1', kind: 'progress', page: 500, entryId: 'p1',
    })).rejects.toThrow(/too big for this book/);
    expect(store.events).toHaveLength(0);
  });

  it('has NO ceiling when the book has no known length', async () => {
    // Load-bearing: pageCount is null for an unresolved ISBN, for a provider
    // that returned 0, and on the `partway` door by design — and it is
    // snapshotted at open time and never refreshed. Treating unknown as
    // unbounded is the common path, not the edge case.
    const store = progressStore([item({ pageCount: null })]);
    await recorder(store).execute({
      learnerId: 'test-learner', itemId: 'test-learner:b:e1', kind: 'progress', page: 9999, entryId: 'p1',
    });
    expect(store.events[0]).toMatchObject({ page: 9999 });
  });

  it('applies on the partway door too, after metadata resolves', async () => {
    const store = openStore();
    await expect(opener(store).execute({
      learnerId: 'test-learner', bookId: '9780000000002', entryId: 'e1', progressEntryId: 'e2',
      where: 'partway', page: 500,
    })).rejects.toThrow(/too big for this book/);
  });

  it('lets the partway door through when the book resolved without a length', async () => {
    const store = openStore();
    await opener(store, null).execute({
      learnerId: 'test-learner', bookId: '9780000000002', entryId: 'e1', progressEntryId: 'e2',
      where: 'partway', page: 500,
    });
    expect(store.events[0]).toMatchObject({ kind: 'progress', page: 500 });
  });
});

describe('reading shelf — the backdate floor', () => {
  it(`accepts a finish ${MAX_BACKDATE_DAYS} days back, on both doors`, async () => {
    const day = daysBack(MAX_BACKDATE_DAYS);

    const store = progressStore();
    await recorder(store).execute({
      learnerId: 'test-learner', itemId: 'test-learner:b:e1', kind: 'finished', finishedOn: day, entryId: 'f1',
    });
    expect(store.events[0]).toMatchObject({ kind: 'finished', at: `${day}T12:00:00.000Z` });

    const opened = openStore();
    await opener(opened).execute({
      learnerId: 'test-learner', bookId: '9780000000002', entryId: 'e1', progressEntryId: 'e2',
      where: 'finished', finishedOn: day,
    });
    expect(opened.events[0]).toMatchObject({ kind: 'finished', at: `${day}T12:00:00.000Z` });
  });

  it('refuses a finish 15 days back, on both doors', async () => {
    const day = daysBack(MAX_BACKDATE_DAYS + 1);

    const store = progressStore();
    await expect(recorder(store).execute({
      learnerId: 'test-learner', itemId: 'test-learner:b:e1', kind: 'finished', finishedOn: day, entryId: 'f1',
    })).rejects.toThrow(/days ago/);
    expect(store.events).toHaveLength(0);

    const opened = openStore();
    await expect(opener(opened).execute({
      learnerId: 'test-learner', bookId: '9780000000002', entryId: 'e1', progressEntryId: 'e2',
      where: 'finished', finishedOn: day,
    })).rejects.toThrow(/days ago/);
    expect(opened.events).toHaveLength(0);
  });

  it('refuses the audited 2026-08-19 stamp on a book opened 2026-09-06', async () => {
    const store = progressStore();
    await expect(recorder(store).execute({
      learnerId: 'test-learner', itemId: 'test-learner:b:e1', kind: 'finished', finishedOn: '2026-08-19', entryId: 'f1',
    })).rejects.toThrow(/days ago/);
  });

  it('still refuses the future, and says so differently', async () => {
    // Two ends, two sentences: a child who picked tomorrow and a child who
    // picked last month have different mistakes to fix.
    const store = progressStore();
    await expect(recorder(store).execute({
      learnerId: 'test-learner', itemId: 'test-learner:b:e1', kind: 'finished', finishedOn: '2026-09-07', entryId: 'f1',
    })).rejects.toThrow(/future/);
  });
});

describe('reading shelf — the pure predicates', () => {
  it('isPlausiblePage treats an absent, zero or non-finite length as no ceiling', () => {
    for (const pageCount of [null, undefined, 0, -5, Number.NaN, 'x']) {
      expect(isPlausiblePage(9999, pageCount)).toBe(true);
    }
  });

  it('isPlausiblePage still refuses a non-positive or non-integer page', () => {
    for (const page of [0, -1, 1.5, '12', null]) {
      expect(isPlausiblePage(page, 192)).toBe(false);
    }
  });

  it('isBackdateAllowed fails closed on an unreadable day', () => {
    expect(isBackdateAllowed('2026-02-31', TODAY)).toBe(false);
    expect(isBackdateAllowed('not-a-day', TODAY)).toBe(false);
    expect(isBackdateAllowed(TODAY, 'not-a-day')).toBe(false);
  });

  it('isBackdateAllowed admits today and refuses tomorrow', () => {
    expect(isBackdateAllowed(TODAY, TODAY)).toBe(true);
    expect(isBackdateAllowed('2026-09-07', TODAY)).toBe(false);
  });
});
