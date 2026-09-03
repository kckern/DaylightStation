/**
 * useBookShelf — the reading shelf's state machine (design §2–§5, §7).
 *
 * What these pin, one rule each: the parallel load, the retryable load
 * failure, the generation guard (a late shelf must not reopen a closed card —
 * `useSelfService` rule 4), the 90s idle close and its reset, the per-
 * keystroke ISBN check with its length gate, the four resolve outcomes, the
 * duplicate guard, entryId minting, the three `where` paths, the update
 * writes, that a failed write loses nothing, and that every state change
 * leaves a log line.
 *
 * Fake timers for the idle tests only: a real 90s wait exceeds vitest's
 * timeout, and wall-clock assertions on this host are flaky.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  shelf: vi.fn(),
  open: vi.fn(),
  progress: vi.fn(),
  mode: vi.fn(),
  resolve: vi.fn(),
  roster: vi.fn(),
  log: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    roster: (...args) => h.roster(...args),
    books: {
      shelf: (...args) => h.shelf(...args),
      open: (...args) => h.open(...args),
      progress: (...args) => h.progress(...args),
      mode: (...args) => h.mode(...args),
      resolve: (...args) => h.resolve(...args),
    },
  },
}));

vi.mock('../schoolLog.js', () => ({
  schoolLog: {
    bookShelf: (...args) => h.log(...args),
    bookShelfError: (...args) => h.logError(...args),
  },
}));

import { useBookShelf, LOAD_FAILED_SENTENCE, EMPTY_PROGRESS_SENTENCE } from './useBookShelf.js';
import { COPY } from './isbn.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISBN = '9780064400558';
const BOOK = { isbn13: ISBN, title: 'Hatchet', authors: ['Gary Paulsen'], coverUrl: '/c.jpg', pageCount: 195 };
const ITEM = {
  itemId: 'kid:9780064400558:e0', bookId: ISBN, progressMode: 'page', pageCount: 195,
  openedAt: '2026-08-20', events: [], title: 'Hatchet', authors: ['Gary Paulsen'], coverUrl: '/c.jpg',
  projection: { status: 'reading', page: 84, percent: 43, minutes: 0, daysRead: 2, lastAt: '2026-08-25' },
};
const shelfOf = (items = [ITEM]) => ({ ok: true, status: 200, data: { learnerId: 'kid', items, obligation: null } });
const okWrite = () => ({ ok: true, status: 200, data: { ok: true } });
const failedWrite = (message = 'page must be a whole number') => ({
  ok: false, status: 400, data: { ok: false, error: { type: 'validation', message, code: 'BAD' }, traceId: 't' },
});

function mount(overrides = {}) {
  const onExit = vi.fn();
  const hook = renderHook(() => useBookShelf({ learnerId: 'kid', grant: 'g1', idleTimeoutSeconds: 90, onExit, ...overrides }));
  return { ...hook, onExit };
}

/** Mount and settle the parallel load. */
async function mounted(overrides = {}) {
  const r = mount(overrides);
  await act(async () => {});
  expect(r.result.current.view).toBe('shelf');
  return r;
}

/**
 * Mount over an EMPTY shelf. The default fixture already has `BOOK` as
 * `reading`, so any test that must get past the cover step (the duplicate
 * guard refuses a second `reading` item for one ISBN) starts here.
 */
async function mountedEmpty(overrides = {}) {
  h.shelf.mockResolvedValue(shelfOf([]));
  return mounted(overrides);
}

/** Walk the add flow up to the cover for `book`. */
async function toCover(r, book = BOOK) {
  act(() => r.result.current.actions.startAdd());
  act(() => r.result.current.actions.typeIsbn(ISBN));
  h.resolve.mockResolvedValue({ ok: true, status: 200, data: { status: 'ok', book } });
  await act(async () => { await r.result.current.actions.lookup(); });
  expect(r.result.current.step).toBe('cover');
}

async function toWhere(r) {
  await toCover(r);
  act(() => r.result.current.actions.confirmCover(true));
  expect(r.result.current.step).toBe('where');
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.shelf.mockResolvedValue(shelfOf());
  h.roster.mockResolvedValue({ ok: true, status: 200, data: [{ id: 'kid', name: 'Kiddo' }, { id: 'other', name: 'Other' }] });
  h.open.mockResolvedValue(okWrite());
  h.progress.mockResolvedValue(okWrite());
  h.mode.mockResolvedValue(okWrite());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useBookShelf: loading', () => {
  it('1. loads the shelf and the roster in parallel, then names the learner', async () => {
    const r = mount();
    expect(r.result.current.view).toBe('loading');
    // Both requests are on the wire before either has answered.
    expect(h.shelf).toHaveBeenCalledWith('kid', 'g1');
    expect(h.roster).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(r.result.current.view).toBe('shelf');
    expect(r.result.current.shelf.items).toHaveLength(1);
    expect(r.result.current.learner).toEqual({ id: 'kid', name: 'Kiddo' });
    expect(r.result.current.error).toBeNull();
  });

  it('1c. exposes the study day the server read the shelf on; null when the field is absent (review m2)', async () => {
    h.shelf.mockResolvedValue({ ok: true, status: 200, data: { learnerId: 'kid', items: [ITEM], obligation: null, studyDay: '2026-09-02' } });
    const r = await mounted();
    expect(r.result.current.studyDay).toBe('2026-09-02');

    h.shelf.mockResolvedValue(shelfOf());
    const bare = await mounted();
    expect(bare.result.current.studyDay).toBeNull();
  });

  it('1b. a roster failure falls back to the id as the name — never a blank heading', async () => {
    h.roster.mockResolvedValue({ ok: false, status: 500, data: null });
    const r = await mounted();
    expect(r.result.current.learner).toEqual({ id: 'kid', name: 'kid' });
  });

  it('2. a shelf-load failure names the fault and retry re-fetches', async () => {
    h.shelf.mockResolvedValueOnce({ ok: false, status: 403, data: { ok: false, error: { type: 'auth', message: 'Book grant is missing', code: 'NO_GRANT' } } });
    const r = mount();
    await act(async () => {});
    expect(r.result.current.view).toBe('loading');
    expect(r.result.current.error).toEqual({ message: 'Book grant is missing' });
    expect(h.logError).toHaveBeenCalledWith('shelf.failed', expect.objectContaining({ status: 403 }));

    await act(async () => { await r.result.current.actions.retry(); });
    expect(h.shelf).toHaveBeenCalledTimes(2);
    expect(r.result.current.view).toBe('shelf');
    expect(r.result.current.error).toBeNull();
  });

  it('2b. a body without a message gets the panel\'s own sentence', async () => {
    h.shelf.mockResolvedValueOnce({ ok: false, status: 0, data: null });
    const r = mount();
    await act(async () => {});
    expect(r.result.current.error).toEqual({ message: LOAD_FAILED_SENTENCE });
  });
});

describe('useBookShelf: closing', () => {
  it('3. done() closes once, and a shelf answering afterwards cannot reopen the card', async () => {
    let release;
    h.shelf.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const r = mount();
    expect(r.result.current.view).toBe('loading');
    act(() => r.result.current.actions.done());
    expect(r.result.current.view).toBe('closed');
    expect(r.onExit).toHaveBeenCalledTimes(1);
    expect(r.onExit).toHaveBeenCalledWith('done');
    act(() => r.result.current.actions.done()); // a second tap is a no-op
    expect(r.onExit).toHaveBeenCalledTimes(1);

    await act(async () => { release(shelfOf()); });
    expect(r.result.current.view).toBe('closed');
    expect(r.result.current.shelf).toBeNull();
  });

  it('4. idle: no activity for idleTimeoutSeconds closes; noteActivity re-arms the clock', async () => {
    vi.useFakeTimers();
    const r = await mounted();
    act(() => { vi.advanceTimersByTime(89_000); });
    expect(r.onExit).not.toHaveBeenCalled();
    act(() => r.result.current.actions.noteActivity());
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(r.onExit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(31_000); });
    expect(r.onExit).toHaveBeenCalledTimes(1);
    expect(r.onExit).toHaveBeenCalledWith('idle');
    expect(r.result.current.view).toBe('closed');
  });

  it('4b. any state change is activity: typing into the pad keeps the shelf open', async () => {
    vi.useFakeTimers();
    const r = await mounted();
    act(() => r.result.current.actions.startAdd());
    act(() => { vi.advanceTimersByTime(80_000); });
    act(() => r.result.current.actions.typeIsbn('978'));
    act(() => { vi.advanceTimersByTime(80_000); });
    expect(r.onExit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(11_000); });
    expect(r.onExit).toHaveBeenCalledWith('idle');
  });

  it('4c. a non-positive timeout never arms', async () => {
    vi.useFakeTimers();
    const r = await mounted({ idleTimeoutSeconds: 0 });
    act(() => { vi.advanceTimersByTime(10 * 60_000); });
    expect(r.onExit).not.toHaveBeenCalled();
  });
});

describe('useBookShelf: the add flow', () => {
  it('5. judges the number per keystroke behind the length gate', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.startAdd());
    expect(r.result.current.view).toBe('add');
    expect(r.result.current.step).toBe('number');
    expect(r.result.current.add.entry).toBe('');

    act(() => r.result.current.actions.typeIsbn('9780064400557'));
    expect(r.result.current.add.hint).toBe(COPY['isbn13-checksum']);
    expect(r.result.current.add.canSubmit).toBe(false);
    expect(h.log).toHaveBeenCalledWith('add.rejected', { reason: 'isbn13-checksum' });

    act(() => r.result.current.actions.typeIsbn('00100123456789'));
    expect(r.result.current.add.hint).toBe(COPY['not-an-identifier']);
    expect(r.result.current.add.canSubmit).toBe(false);

    act(() => r.result.current.actions.typeIsbn('97800'));
    expect(r.result.current.add.hint).toBeNull();
    expect(r.result.current.add.canSubmit).toBe(false);

    act(() => r.result.current.actions.typeIsbn(ISBN));
    expect(r.result.current.add.hint).toBeNull();
    expect(r.result.current.add.canSubmit).toBe(true);
    expect(r.result.current.add.check).toEqual({ state: 'valid', isbn13: ISBN });
  });

  it('5c. ten digits light Look it up; the tap judges them as an ISBN-10 and says so when a digit is off', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.startAdd());
    act(() => r.result.current.actions.typeIsbn('0064400550')); // bad ISBN-10 check digit
    expect(r.result.current.add.hint).toBeNull(); // nothing while typing
    expect(r.result.current.add.canSubmit).toBe(true);
    await act(async () => { await r.result.current.actions.lookup(); });
    expect(h.resolve).not.toHaveBeenCalled();
    expect(r.result.current.step).toBe('number');
    expect(r.result.current.add.entry).toBe('0064400550'); // the digits stay
    expect(r.result.current.add.hint).toBe(COPY['isbn10-checksum']);
    expect(h.log).toHaveBeenCalledWith('add.rejected', { reason: 'isbn10-checksum' });
    expect(r.result.current.add.canSubmit).toBe(false); // the verdict unlights the button

    act(() => r.result.current.actions.typeIsbn('0064400557')); // fixed
    expect(r.result.current.add.hint).toBeNull(); // the next keystroke clears the verdict
    expect(r.result.current.add.canSubmit).toBe(true);
    h.resolve.mockResolvedValue({ ok: true, status: 200, data: { status: 'ok', book: BOOK } });
    await act(async () => { await r.result.current.actions.lookup(); });
    expect(h.resolve).toHaveBeenCalledWith(ISBN); // converted to the 13
    expect(r.result.current.step).toBe('cover');
  });

  it('5d. eleven and twelve digits are still typing: dark button, no sentence', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.startAdd());
    for (const n of [10, 11, 12]) {
      act(() => r.result.current.actions.typeIsbn(ISBN.slice(0, n)));
      expect(r.result.current.add.hint).toBeNull();
      expect(r.result.current.add.canSubmit).toBe(n === 10);
    }
    expect(h.log).not.toHaveBeenCalledWith('add.rejected', expect.anything());
    act(() => r.result.current.actions.typeIsbn(ISBN.slice(0, 11)));
    await act(async () => { await r.result.current.actions.lookup(); });
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it('5b. lookup() with an unsubmittable number does nothing', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.startAdd());
    act(() => r.result.current.actions.typeIsbn('97800'));
    await act(async () => { await r.result.current.actions.lookup(); });
    expect(h.resolve).not.toHaveBeenCalled();
    expect(r.result.current.step).toBe('number');
  });

  it('6. lookup: ok → cover; not-found and unavailable → back to the pad with the number kept', async () => {
    h.shelf.mockResolvedValue(shelfOf([])); // an empty shelf, so nothing reads as a duplicate
    const r = await mounted();
    act(() => r.result.current.actions.startAdd());
    act(() => r.result.current.actions.typeIsbn('0064400557')); // ISBN-10, converted on the wire

    let release;
    h.resolve.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    let pending;
    act(() => { pending = r.result.current.actions.lookup(); });
    expect(r.result.current.step).toBe('lookup');
    expect(h.resolve).toHaveBeenCalledWith(ISBN);
    await act(async () => { release({ ok: true, status: 200, data: { status: 'ok', book: BOOK } }); await pending; });
    expect(r.result.current.step).toBe('cover');
    expect(r.result.current.add.resolved.book).toEqual(BOOK);
    expect(r.result.current.current).toEqual(BOOK);
    expect(r.result.current.add.duplicateOf).toBeNull();
    expect(h.log).toHaveBeenCalledWith('lookup', expect.objectContaining({ status: 'ok' }));

    act(() => r.result.current.actions.confirmCover(false));
    act(() => r.result.current.actions.typeIsbn(ISBN));
    h.resolve.mockResolvedValueOnce({ ok: false, status: 404, data: { status: 'not-found', reason: 'no-source' } });
    await act(async () => { await r.result.current.actions.lookup(); });
    expect(r.result.current.step).toBe('number');
    expect(r.result.current.add.hint).toBe(COPY['not-found']);
    expect(r.result.current.add.entry).toBe(ISBN);
    expect(r.result.current.add.canRetry).toBe(false);
    expect(h.log).toHaveBeenCalledWith('lookup', expect.objectContaining({ status: 'not-found' }));

    h.resolve.mockResolvedValueOnce({ ok: false, status: 503, data: { status: 'unavailable', failures: 2 } });
    await act(async () => { await r.result.current.actions.lookup(); });
    expect(r.result.current.step).toBe('number');
    expect(r.result.current.add.hint).toBe(COPY.unavailable);
    expect(r.result.current.add.entry).toBe(ISBN);
    expect(r.result.current.add.canRetry).toBe(true);

    h.resolve.mockResolvedValueOnce({ ok: true, status: 200, data: { status: 'ok', book: BOOK } });
    await act(async () => { await r.result.current.actions.retryLookup(); });
    expect(h.resolve).toHaveBeenCalledTimes(4);
    expect(r.result.current.step).toBe('cover');
  });

  it('6b. a resolve that never answered (status 0) reads as unavailable, not as an unknown book', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.startAdd());
    act(() => r.result.current.actions.typeIsbn(ISBN));
    h.resolve.mockResolvedValueOnce({ ok: false, status: 0, data: null });
    await act(async () => { await r.result.current.actions.lookup(); });
    expect(r.result.current.add.hint).toBe(COPY.unavailable);
    expect(r.result.current.add.canRetry).toBe(true);
  });

  it('7. duplicate guard: a book already being read points at that item', async () => {
    const r = await mounted();
    await toCover(r);
    expect(r.result.current.add.duplicateOf).toBe(ITEM.itemId);
    // A finished copy is not a duplicate — a re-read opens a fresh item.
    const finished = { ...ITEM, projection: { ...ITEM.projection, status: 'finished' } };
    h.shelf.mockResolvedValue(shelfOf([finished]));
    const r2 = await mounted();
    await toCover(r2);
    expect(r2.result.current.add.duplicateOf).toBeNull();
  });

  it('8. confirmCover(false) clears the number; confirmCover(true) mints two distinct ids', async () => {
    const r = await mountedEmpty();
    await toCover(r);
    act(() => r.result.current.actions.confirmCover(false));
    expect(r.result.current.step).toBe('number');
    expect(r.result.current.add.entry).toBe('');
    expect(r.result.current.add.resolved).toBeNull();

    await toCover(r);
    act(() => r.result.current.actions.confirmCover(true));
    expect(r.result.current.step).toBe('where');
    const { entryId, progressEntryId } = r.result.current.add;
    expect(entryId).toMatch(UUID);
    expect(progressEntryId).toMatch(UUID);
    expect(entryId).not.toBe(progressEntryId);
  });

  it('9a. choose(starting) opens the item and returns to a refetched shelf', async () => {
    const r = await mountedEmpty();
    await toWhere(r);
    const { entryId } = r.result.current.add;
    await act(async () => { await r.result.current.actions.choose('starting'); });
    expect(h.open).toHaveBeenCalledWith('kid', 'g1', { bookId: ISBN, entryId, where: 'starting' });
    expect(h.shelf).toHaveBeenCalledTimes(2);
    expect(r.result.current.view).toBe('shelf');
    expect(r.result.current.step).toBeNull();
    expect(r.result.current.add.entry).toBe('');
    expect(h.log).toHaveBeenCalledWith('item-opened', expect.objectContaining({ where: 'starting' }));
  });

  it('9b. choose(partway) asks for the page, then opens with a first progress event', async () => {
    const r = await mountedEmpty();
    await toWhere(r);
    await act(async () => { await r.result.current.actions.choose('partway'); });
    expect(r.result.current.step).toBe('page');
    const { entryId, progressEntryId } = r.result.current.add;
    await act(async () => { await r.result.current.actions.submitPage(84); });
    expect(h.open).toHaveBeenCalledWith('kid', 'g1', { bookId: ISBN, entryId, where: 'partway', page: 84, progressEntryId });
    expect(r.result.current.view).toBe('shelf');
  });

  it('9c. choose(finished) asks for the day, then opens with the finished event on that day', async () => {
    const r = await mountedEmpty();
    await toWhere(r);
    await act(async () => { await r.result.current.actions.choose('finished'); });
    expect(r.result.current.step).toBe('when');
    const { entryId, progressEntryId } = r.result.current.add;
    await act(async () => { await r.result.current.actions.submitDay('2026-08-25'); });
    expect(r.result.current.add.finishedOn === '2026-08-25' || r.result.current.view === 'shelf').toBe(true);
    expect(h.open).toHaveBeenCalledWith('kid', 'g1', { bookId: ISBN, entryId, where: 'finished', finishedOn: '2026-08-25', progressEntryId });
    expect(r.result.current.view).toBe('shelf');
  });

  it('9d. the same ids ride a retried open — a double tap appends once', async () => {
    const r = await mountedEmpty();
    await toWhere(r);
    h.open.mockResolvedValueOnce(failedWrite('store busy'));
    await act(async () => { await r.result.current.actions.choose('starting'); });
    expect(r.result.current.view).toBe('add');
    expect(r.result.current.step).toBe('where');
    expect(r.result.current.error).toEqual({ message: 'store busy' });
    await act(async () => { await r.result.current.actions.choose('starting'); });
    const [first, second] = h.open.mock.calls;
    expect(second[2].entryId).toBe(first[2].entryId);
    expect(r.result.current.view).toBe('shelf');
    expect(r.result.current.error).toBeNull();
  });

  it('back() during a lookup abandons it: the pad comes back with the digits, and the late answer is dropped (review M3)', async () => {
    const r = await mountedEmpty();
    act(() => r.result.current.actions.startAdd());
    act(() => r.result.current.actions.typeIsbn(ISBN));
    let release;
    h.resolve.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    let pending;
    act(() => { pending = r.result.current.actions.lookup(); });
    expect(r.result.current.step).toBe('lookup');

    act(() => r.result.current.actions.back());
    expect(r.result.current.view).toBe('add');
    expect(r.result.current.step).toBe('number');
    expect(r.result.current.add.entry).toBe(ISBN);
    expect(r.result.current.add.canSubmit).toBe(true);

    // The slow answer lands: no cover, no log line for it.
    await act(async () => { release({ ok: true, status: 200, data: { status: 'ok', book: BOOK } }); await pending; });
    expect(r.result.current.step).toBe('number');
    expect(r.result.current.add.resolved).toBeNull();
    expect(h.log).not.toHaveBeenCalledWith('lookup', expect.anything());

    // And the pad is live again: a second tap sends a second request.
    h.resolve.mockResolvedValue({ ok: true, status: 200, data: { status: 'ok', book: BOOK } });
    await act(async () => { await r.result.current.actions.lookup(); });
    expect(h.resolve).toHaveBeenCalledTimes(2);
    expect(r.result.current.step).toBe('cover');
  });

  it('back() walks the add flow one step at a time and lands on the shelf', async () => {
    const r = await mountedEmpty();
    await toWhere(r);
    await act(async () => { await r.result.current.actions.choose('partway'); });
    act(() => r.result.current.actions.back());
    expect(r.result.current.step).toBe('where');
    act(() => r.result.current.actions.back());
    expect(r.result.current.step).toBe('number');
    expect(r.result.current.add.entry).toBe(ISBN); // the number survives a step back
    act(() => r.result.current.actions.back());
    expect(r.result.current.view).toBe('shelf');
    expect(r.result.current.step).toBeNull();
  });
});

describe('useBookShelf: updating a book', () => {
  it('10. openItem → update view with a fresh entryId; each write carries it and refetches', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.openItem(ITEM.itemId));
    expect(r.result.current.view).toBe('update');
    expect(r.result.current.current).toEqual(ITEM);
    const { entryId } = r.result.current.update;
    expect(entryId).toMatch(UUID);
    expect(h.log).toHaveBeenCalledWith('update-opened', expect.objectContaining({ itemId: ITEM.itemId, mode: 'page' }));

    await act(async () => { await r.result.current.actions.submitProgress({ page: 90 }); });
    expect(h.progress).toHaveBeenCalledWith('kid', 'g1', ITEM.itemId, { kind: 'progress', page: 90, entryId });
    expect(h.shelf).toHaveBeenCalledTimes(2);
    expect(r.result.current.view).toBe('shelf');
    expect(h.log).toHaveBeenCalledWith('progress', expect.objectContaining({ kind: 'progress', mode: 'page' }));

    act(() => r.result.current.actions.openItem(ITEM.itemId));
    const second = r.result.current.update.entryId;
    expect(second).toMatch(UUID);
    expect(second).not.toBe(entryId);
    await act(async () => { await r.result.current.actions.checkIn(); });
    expect(h.progress).toHaveBeenLastCalledWith('kid', 'g1', ITEM.itemId, { kind: 'progress', entryId: second });

    act(() => r.result.current.actions.openItem(ITEM.itemId));
    const third = r.result.current.update.entryId;
    await act(async () => { await r.result.current.actions.finish(); });
    expect(h.progress).toHaveBeenLastCalledWith('kid', 'g1', ITEM.itemId, { kind: 'finished', entryId: third });

    act(() => r.result.current.actions.openItem(ITEM.itemId));
    const fourth = r.result.current.update.entryId;
    await act(async () => { await r.result.current.actions.finish('2026-08-25'); });
    expect(h.progress).toHaveBeenLastCalledWith('kid', 'g1', ITEM.itemId, { kind: 'finished', finishedOn: '2026-08-25', entryId: fourth });

    act(() => r.result.current.actions.openItem(ITEM.itemId));
    const fifth = r.result.current.update.entryId;
    await act(async () => { await r.result.current.actions.setAside(); });
    expect(h.progress).toHaveBeenLastCalledWith('kid', 'g1', ITEM.itemId, { kind: 'set-aside', entryId: fifth });

    act(() => r.result.current.actions.openItem(ITEM.itemId));
    await act(async () => { await r.result.current.actions.setMode('check'); });
    expect(h.mode).toHaveBeenCalledWith('kid', 'g1', ITEM.itemId, 'check');
    expect(r.result.current.view).toBe('shelf');
  });

  it('10b. minutes ride the same event; a blank save is refused locally with words, not a request', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.openItem(ITEM.itemId));
    const { entryId } = r.result.current.update;
    await act(async () => { await r.result.current.actions.submitProgress({}); });
    expect(h.progress).not.toHaveBeenCalled();
    expect(r.result.current.view).toBe('update');
    expect(r.result.current.error).toEqual({ message: EMPTY_PROGRESS_SENTENCE });
    await act(async () => { await r.result.current.actions.submitProgress({ minutes: 20 }); });
    expect(h.progress).toHaveBeenCalledWith('kid', 'g1', ITEM.itemId, { kind: 'progress', minutes: 20, entryId });
    expect(r.result.current.error).toBeNull();
  });

  it('10c. openItem with an unknown id is ignored', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.openItem('nope'));
    expect(r.result.current.view).toBe('shelf');
  });

  it('11. a failed write stays put and names the fault; the next attempt reuses the same entryId', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.openItem(ITEM.itemId));
    const { entryId } = r.result.current.update;
    h.progress.mockResolvedValueOnce(failedWrite());
    await act(async () => { await r.result.current.actions.submitProgress({ page: 90 }); });
    expect(r.result.current.view).toBe('update');
    expect(r.result.current.current).toEqual(ITEM);
    expect(r.result.current.error).toEqual({ message: 'page must be a whole number' });
    expect(h.logError).toHaveBeenCalledWith('write.failed', expect.objectContaining({ kind: 'progress', status: 400 }));
    expect(h.shelf).toHaveBeenCalledTimes(1);

    await act(async () => { await r.result.current.actions.submitProgress({ page: 90 }); });
    expect(h.progress).toHaveBeenLastCalledWith('kid', 'g1', ITEM.itemId, { kind: 'progress', page: 90, entryId });
    expect(r.result.current.view).toBe('shelf');
    expect(r.result.current.error).toBeNull();
  });

  it('11b. a write answering after done() changes nothing', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.openItem(ITEM.itemId));
    let release;
    h.progress.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    let pending;
    act(() => { pending = r.result.current.actions.checkIn(); });
    act(() => r.result.current.actions.done());
    await act(async () => { release(okWrite()); await pending; });
    expect(r.result.current.view).toBe('closed');
    expect(h.shelf).toHaveBeenCalledTimes(1); // no refetch after close
  });

  it('history opens and back returns to the shelf', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.openHistory());
    expect(r.result.current.view).toBe('history');
    act(() => r.result.current.actions.back());
    expect(r.result.current.view).toBe('shelf');
  });
});

describe('useBookShelf: logging', () => {
  it('12. logs opened on mount and closed{reason} on the way out', async () => {
    vi.useFakeTimers();
    const r = await mounted();
    expect(h.log).toHaveBeenCalledWith('opened', { learnerId: 'kid' });
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(h.log).toHaveBeenCalledWith('closed', { reason: 'idle', view: 'shelf' });
    expect(r.onExit).toHaveBeenCalledWith('idle');
  });

  it('12b. done() logs closed{reason:done}', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.done());
    expect(h.log).toHaveBeenCalledWith('closed', { reason: 'done', view: 'shelf' });
  });
});

describe('useBookShelf: review hardenings (task 11b)', () => {
  // Item 1 — `busy` is held through the refetch, not just through the write.
  it('13a. submitProgress: busy holds until the shelf re-read lands; a tap in that window sends nothing', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.openItem(ITEM.itemId));
    let releaseShelf;
    h.shelf.mockReturnValueOnce(new Promise((resolve) => { releaseShelf = resolve; }));
    let pending;
    await act(async () => { pending = r.result.current.actions.submitProgress({ page: 90 }); });
    // The write has answered; the re-read has not.
    expect(h.progress).toHaveBeenCalledTimes(1);
    expect(h.shelf).toHaveBeenCalledTimes(2);
    expect(r.result.current.view).toBe('update');
    expect(r.result.current.busy).toBe(true);

    await act(async () => { await r.result.current.actions.submitProgress({ page: 91 }); });
    expect(h.progress).toHaveBeenCalledTimes(1);

    await act(async () => { releaseShelf(shelfOf()); await pending; });
    expect(r.result.current.busy).toBe(false);
    expect(r.result.current.view).toBe('shelf');
  });

  it('13b. choose(starting): busy holds until the shelf re-read lands; a tap in that window sends nothing', async () => {
    const r = await mountedEmpty();
    await toWhere(r);
    let releaseShelf;
    h.shelf.mockReturnValueOnce(new Promise((resolve) => { releaseShelf = resolve; }));
    let pending;
    await act(async () => { pending = r.result.current.actions.choose('starting'); });
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.shelf).toHaveBeenCalledTimes(2);
    expect(r.result.current.view).toBe('add');
    expect(r.result.current.busy).toBe(true);

    await act(async () => { await r.result.current.actions.choose('starting'); });
    expect(h.open).toHaveBeenCalledTimes(1);

    await act(async () => { releaseShelf(shelfOf()); await pending; });
    expect(r.result.current.busy).toBe(false);
    expect(r.result.current.view).toBe('shelf');
  });

  // Item 2 — the duplicate guard refuses the mint, and openDuplicate reaches the item.
  it('14a. confirmCover(true) on a duplicate is refused and logged; openDuplicate lands on that item', async () => {
    const reading = { ...ITEM, itemId: 'kid:9780064400558:e1' };
    h.shelf.mockResolvedValue(shelfOf([reading]));
    const r = await mounted();
    await toCover(r);
    expect(r.result.current.add.duplicateOf).toBe('kid:9780064400558:e1');

    act(() => r.result.current.actions.confirmCover(true));
    expect(r.result.current.step).toBe('cover');
    expect(r.result.current.add.entryId).toBeNull();
    expect(r.result.current.add.progressEntryId).toBeNull();
    expect(h.log).toHaveBeenCalledWith('add.rejected', expect.objectContaining({ reason: 'duplicate', itemId: 'kid:9780064400558:e1' }));

    act(() => r.result.current.actions.openDuplicate());
    expect(r.result.current.view).toBe('update');
    expect(r.result.current.step).toBeNull();
    expect(r.result.current.current.itemId).toBe('kid:9780064400558:e1');
    expect(r.result.current.update.entryId).toMatch(UUID);
    expect(r.result.current.add.entry).toBe('');
    expect(r.result.current.add.duplicateOf).toBeNull();
    expect(h.log).toHaveBeenCalledWith('update-opened', expect.objectContaining({ itemId: 'kid:9780064400558:e1' }));
  });

  it('14b. a set-aside copy of the same ISBN is not a duplicate', async () => {
    const aside = { ...ITEM, projection: { ...ITEM.projection, status: 'set-aside' } };
    h.shelf.mockResolvedValue(shelfOf([aside]));
    const r = await mounted();
    await toCover(r);
    expect(r.result.current.add.duplicateOf).toBeNull();
  });

  it('14c. openDuplicate with nothing to open is a no-op', async () => {
    h.shelf.mockResolvedValue(shelfOf([]));
    const r = await mounted();
    await toCover(r);
    expect(r.result.current.add.duplicateOf).toBeNull();
    act(() => r.result.current.actions.openDuplicate());
    expect(r.result.current.view).toBe('add');
    expect(r.result.current.step).toBe('cover');
  });

  // Item 3 — a write that answers after the parent unmounted neither refetches nor logs.
  it('15. an in-flight write answering after unmount changes nothing', async () => {
    const r = await mounted();
    act(() => r.result.current.actions.openItem(ITEM.itemId));
    let release;
    h.progress.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    let pending;
    act(() => { pending = r.result.current.actions.checkIn(); });
    r.unmount();
    await act(async () => { release(okWrite()); await pending; });
    expect(h.shelf).toHaveBeenCalledTimes(1);
    expect(h.log).not.toHaveBeenCalledWith('progress', expect.anything());
  });

  // Item 4 — lookup is single-flight.
  it('16. two lookup() calls in one batch send one request', async () => {
    h.shelf.mockResolvedValue(shelfOf([]));
    const r = await mounted();
    act(() => r.result.current.actions.startAdd());
    act(() => r.result.current.actions.typeIsbn(ISBN));
    h.resolve.mockResolvedValue({ ok: true, status: 200, data: { status: 'ok', book: BOOK } });
    await act(async () => {
      const a = r.result.current.actions.lookup();
      const b = r.result.current.actions.lookup();
      await Promise.all([a, b]);
    });
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(r.result.current.step).toBe('cover');
  });

  // Item 5 — done() and then the idle clock: one exit, one closed line.
  it('17. done() then the idle timer: onExit and closed fire exactly once', async () => {
    vi.useFakeTimers();
    const r = await mounted();
    act(() => r.result.current.actions.done());
    act(() => { vi.advanceTimersByTime(200_000); });
    expect(r.onExit).toHaveBeenCalledTimes(1);
    expect(r.onExit).toHaveBeenCalledWith('done');
    expect(h.log.mock.calls.filter(([event]) => event === 'closed')).toHaveLength(1);
  });
});
