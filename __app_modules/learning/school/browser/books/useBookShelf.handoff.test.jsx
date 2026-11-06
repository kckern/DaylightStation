/**
 * A scan claimed while the shelf is open is HANDED to the mounted shelf, not
 * delivered by remounting it (2026-11-05: every claimed scan remounted the
 * shelf — "Getting your shelf…" again — and threw away an Add the child had
 * started 24ms earlier, and a receipt they had just been shown).
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ shelf: vi.fn(), open: vi.fn(), progress: vi.fn(), mode: vi.fn(), resolve: vi.fn(), roster: vi.fn(), log: vi.fn(), debug: vi.fn() }));
vi.mock("../schoolApi.js", () => ({ schoolApi: {
  roster: (...a) => h.roster(...a),
  books: { shelf: (...a) => h.shelf(...a), open: (...a) => h.open(...a), progress: (...a) => h.progress(...a), mode: (...a) => h.mode(...a), resolve: (...a) => h.resolve(...a) },
} }));
vi.mock("../schoolLog.js", () => ({ schoolLog: { bookShelf: (...a) => h.log(...a), bookShelfError: vi.fn(), bookShelfDebug: (...a) => h.debug(...a) } }));
import { useBookShelf } from "./useBookShelf.js";

const ISBN = '9780064400558';
const ISBN2 = '9780064401517';
const ITEM = { itemId: 'kid:9780064400558:e0', bookId: ISBN, progressMode: 'page', pageCount: 195, openedAt: '2026-08-20', events: [], title: 'Hatchet', authors: [],
  projection: { status: 'reading', page: 84, percent: 43, minutes: 0, daysRead: 2, lastAt: '2026-08-25' } };
const BOOK2 = { isbn13: ISBN2, title: 'The Indian in the Cupboard', authors: [] };

beforeEach(() => {
  vi.clearAllMocks();
  h.shelf.mockResolvedValue({ ok: true, status: 200, data: { learnerId: 'kid', items: [ITEM], obligation: null } });
  h.roster.mockResolvedValue({ ok: true, data: [] });
  h.progress.mockResolvedValue({ ok: true, status: 200, data: { ok: true, item: ITEM } });
});
afterEach(() => { vi.useRealTimers(); });

function mountShelf(initialBookEntry = null) {
  return renderHook((props) => useBookShelf({ learnerId: 'kid', grant: 'g1', idleTimeoutSeconds: 90, onExit: vi.fn(), ...props }), { initialProps: { initialBookEntry } });
}

describe('a scan handed to a mounted shelf', () => {
  it('keeps a half-typed Add, queues the scanned book, and surfaces it when the child steps back — with no second shelf load', async () => {
    const r = mountShelf(); await act(async () => {});
    expect(r.result.current.view).toBe('shelf');
    act(() => r.result.current.actions.startAdd());
    act(() => r.result.current.actions.typeIsbn('978'));
    expect(r.result.current.add.entry).toBe('978');
    r.rerender({ initialBookEntry: { intentId: 'scan-2', isbn13: ISBN2, book: BOOK2 }, grant: 'g2' });
    await act(async () => {});
    expect(r.result.current.view).toBe('add');
    expect(r.result.current.step).toBe('number');
    expect(r.result.current.add.entry).toBe('978');
    expect(h.debug).toHaveBeenCalledWith('scan.queued', expect.objectContaining({ isbn13: ISBN2 }));
    act(() => r.result.current.actions.back());
    await act(async () => {});
    expect(r.result.current.view).toBe('add');
    expect(r.result.current.step).toBe('cover');
    expect(r.result.current.add.resolved.book).toEqual(BOOK2);
    expect(h.shelf).toHaveBeenCalledTimes(1);
  });

  it('a scan at the empty barcode pad is the answer to it: the book opens at once', async () => {
    const r = mountShelf(); await act(async () => {});
    act(() => r.result.current.actions.startAdd());
    r.rerender({ initialBookEntry: { intentId: 'scan-2', isbn13: ISBN2, book: BOOK2 } });
    await act(async () => {});
    expect(r.result.current.step).toBe('cover');
    expect(r.result.current.add.resolved.book).toEqual(BOOK2);
    expect(h.shelf).toHaveBeenCalledTimes(1);
  });

  it('holds a new scan behind a fresh save receipt, then opens it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const r = mountShelf(); await act(async () => {});
    act(() => r.result.current.actions.openItem(ITEM.itemId));
    expect(r.result.current.view).toBe('update');
    await act(async () => r.result.current.actions.submitProgress({ page: 90 }));
    expect(r.result.current.view).toBe('shelf');
    expect(r.result.current.receipt).toBeTruthy();
    r.rerender({ initialBookEntry: { intentId: 'scan-3', isbn13: ISBN2, book: BOOK2 } });
    await act(async () => {});
    expect(r.result.current.view).toBe('shelf');
    expect(r.result.current.receipt).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(r.result.current.view).toBe('add');
    expect(r.result.current.step).toBe('cover');
  });

  it('seeds every claimed scan once, in order', async () => {
    const r = mountShelf({ intentId: 'scan-1', isbn13: ISBN, book: { isbn13: ISBN, title: 'Hatchet' } }); await act(async () => {});
    expect(r.result.current.view).toBe('update');
    r.rerender({ initialBookEntry: { intentId: 'scan-2', isbn13: ISBN2, book: BOOK2 } });
    await act(async () => {});
    expect(r.result.current.view).toBe('update');
    act(() => r.result.current.actions.back());
    await act(async () => {});
    expect(r.result.current.step).toBe('cover');
    expect(r.result.current.add.resolved.book).toEqual(BOOK2);
    act(() => r.result.current.actions.back());
    act(() => r.result.current.actions.back());
    await act(async () => {});
    expect(r.result.current.view).toBe('shelf');
    expect(h.shelf).toHaveBeenCalledTimes(1);
  });

  it('a pad holding only the last scanned number is still asking for a barcode', async () => {
    h.shelf.mockResolvedValue({ ok: true, status: 200, data: { learnerId: 'kid', items: [], obligation: null } });
    const r = mountShelf({ intentId: 'scan-1', isbn13: ISBN, book: { isbn13: ISBN, title: 'Hatchet' } }); await act(async () => {});
    expect(r.result.current.step).toBe('cover');
    act(() => r.result.current.actions.back());
    expect(r.result.current.step).toBe('number');
    expect(r.result.current.add.entry).toBe(ISBN);
    r.rerender({ initialBookEntry: { intentId: 'scan-2', isbn13: ISBN2, book: BOOK2 } });
    await act(async () => {});
    expect(r.result.current.step).toBe('cover');
    expect(r.result.current.add.resolved.book).toEqual(BOOK2);
  });
});

