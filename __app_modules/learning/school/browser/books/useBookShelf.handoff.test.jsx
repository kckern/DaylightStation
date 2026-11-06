/**
 * A scan claimed while the shelf is open is HANDED to the mounted shelf, not
 * delivered by remounting it (2026-11-05: every claimed scan remounted the
 * shelf — "Getting your shelf…" again — and threw away an Add the child had
 * started 24ms earlier, and a receipt they had just been shown).
 */
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ shelf: vi.fn(), open: vi.fn(), progress: vi.fn(), mode: vi.fn(), resolve: vi.fn(), roster: vi.fn(), log: vi.fn(), debug: vi.fn(), warn: vi.fn() }));
vi.mock("../schoolApi.js", () => ({ schoolApi: {
  roster: (...a) => h.roster(...a),
  books: { shelf: (...a) => h.shelf(...a), open: (...a) => h.open(...a), progress: (...a) => h.progress(...a), mode: (...a) => h.mode(...a), resolve: (...a) => h.resolve(...a) },
} }));
vi.mock("../schoolLog.js", () => ({ schoolLog: { bookShelf: (...a) => h.log(...a), bookShelfError: vi.fn(), bookShelfDebug: (...a) => h.debug(...a), bookShelfWarn: (...a) => h.warn(...a) } }));
vi.mock("../../../../../frontend/src/lib/identity/ProfileAvatar.jsx", () => ({ default: () => <span>avatar</span> }));
import { useBookShelf } from "./useBookShelf.js";
import BookShelf from "./BookShelf.jsx";

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

  // Fix round 1.
  it('reports the receipt hold, and lifts it after RECEIPT_HOLD_MS', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const r = mountShelf(); await act(async () => {});
    expect(r.result.current.receiptHeld).toBe(false);
    act(() => r.result.current.actions.openItem(ITEM.itemId));
    await act(async () => r.result.current.actions.submitProgress({ page: 90 }));
    expect(r.result.current.receiptHeld).toBe(true);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(r.result.current.receiptHeld).toBe(false);
  });

  it('a close with a scan still queued says so at warn, with the book', async () => {
    const r = mountShelf(); await act(async () => {});
    act(() => r.result.current.actions.startAdd());
    act(() => r.result.current.actions.typeIsbn('978'));
    r.rerender({ initialBookEntry: { intentId: 'scan-2', isbn13: ISBN2, book: BOOK2 } });
    await act(async () => {});
    act(() => r.result.current.actions.done());
    expect(h.warn).toHaveBeenCalledWith('scan.dropped', expect.objectContaining({ isbn13: ISBN2, reason: 'done' }));
  });

  it('an unmount with a scan still queued says so at warn', async () => {
    const r = mountShelf(); await act(async () => {});
    act(() => r.result.current.actions.startAdd());
    act(() => r.result.current.actions.typeIsbn('978'));
    r.rerender({ initialBookEntry: { intentId: 'scan-2', isbn13: ISBN2, book: BOOK2 } });
    await act(async () => {});
    r.unmount();
    expect(h.warn).toHaveBeenCalledWith('scan.dropped', expect.objectContaining({ isbn13: ISBN2, reason: 'unmount' }));
  });

  it('queuing a scan re-arms the idle close', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onExit = vi.fn();
    const r = renderHook((props) => useBookShelf({ learnerId: 'kid', grant: 'g1', idleTimeoutSeconds: 90, onExit, ...props }), { initialProps: { initialBookEntry: null } });
    await act(async () => {});
    act(() => r.result.current.actions.startAdd());
    act(() => r.result.current.actions.typeIsbn('978'));
    await act(async () => { vi.advanceTimersByTime(80_000); });
    r.rerender({ initialBookEntry: { intentId: 'scan-2', isbn13: ISBN2, book: BOOK2 } });
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(onExit).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(75_000); });
    expect(onExit).toHaveBeenCalledWith('idle');
  });
});


// ---------------------------------------------------------------------------
// Book-scan experience task 3: the shelf says at once that a scan landed, and
// how many more books are waiting behind the one on screen.
// ---------------------------------------------------------------------------
const ISBN3 = '9780763648602';
const ISBN4 = '9780763691677';
const BOOK3 = { isbn13: ISBN3, title: 'Book Three', authors: [] };
const BOOK4 = { isbn13: ISBN4, title: 'Book Four', authors: [] };
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const pileCard = (intentId, isbn13, over = {}) => ({ id: `card-${intentId}`, intentId, isbn13, status: 'ready', book: null, superseded: false, ...over });
const chip = () => screen.queryByTestId('scan-status-chip');

function renderShelf(props = {}) {
  const base = { learnerId: 'kid', grant: 'g1', idleTimeoutSeconds: 90, onExit: vi.fn(), scanStatus: null, initialBookEntry: null };
  const view = render(<BookShelf {...base} {...props} />);
  return { ...view, update: (next) => view.rerender(<BookShelf {...base} {...props} {...next} />) };
}

describe('the shelf acknowledges a scan at once and shows what is waiting', () => {
  it('a scan while the shelf is open: "Got it" before the claim resolves; it clears, and the book is shown, with both moments logged', async () => {
    const receivedAt = ago(300);
    const ack = { intentId: 'scan-2', receivedAt, screenId: 'portal' };
    const s = renderShelf({ scanStatus: { acknowledging: ack, cards: [pileCard('scan-2', ISBN2, { status: 'loading' })] } });
    await act(async () => {});
    expect(chip()?.textContent).toBe('Got it — looking it up');
    expect(h.log).toHaveBeenCalledWith('scan.acknowledged', { screenId: 'portal', msSinceReceived: expect.any(Number) });
    const acked = h.log.mock.calls.find(([event]) => event === 'scan.acknowledged')[1];
    expect(acked.msSinceReceived).toBeGreaterThanOrEqual(300);
    // Logged once per scan, not once per render.
    s.update({ scanStatus: { acknowledging: ack, cards: [pileCard('scan-2', ISBN2)] } });
    await act(async () => {});
    expect(h.log.mock.calls.filter(([event]) => event === 'scan.acknowledged')).toHaveLength(1);
    // The claim lands: the scan is handed to the shelf and opens.
    s.update({ scanStatus: { acknowledging: null, cards: [] }, initialBookEntry: { intentId: 'scan-2', isbn13: ISBN2, book: BOOK2, receivedAt, screenId: 'portal' } });
    await act(async () => {});
    expect(screen.getByRole('heading', { name: BOOK2.title })).toBeTruthy();
    expect(chip()).toBeNull();
    expect(h.log).toHaveBeenCalledWith('scan.visible', { screenId: 'portal', msSinceReceived: expect.any(Number) });
    const visible = h.log.mock.calls.find(([event]) => event === 'scan.visible')[1];
    expect(visible.msSinceReceived).toBeGreaterThanOrEqual(300);
  });

  it('two books scanned while the child is on Add: Add stays, "2 more books waiting"; finishing Add surfaces the next and the count drops to 1', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.shelf.mockResolvedValue({ ok: true, status: 200, data: { learnerId: 'kid', items: [], obligation: null } });
    h.open.mockResolvedValue({ ok: true, status: 200, data: { ok: true, item: ITEM } });
    const s = renderShelf({ initialBookEntry: { intentId: 'scan-2', isbn13: ISBN2, book: BOOK2, receivedAt: ago(100), screenId: 'portal' } });
    await act(async () => {});
    expect(screen.getByRole('heading', { name: BOOK2.title })).toBeTruthy();
    // Two scans mid-step: not claimed (the shelf is not scan-ready), so both
    // are unfiled pile cards for this screen.
    s.update({ scanStatus: { acknowledging: null, cards: [pileCard('scan-3', ISBN3), pileCard('scan-4', ISBN4)] } });
    await act(async () => {});
    expect(screen.getByRole('heading', { name: BOOK2.title })).toBeTruthy();
    expect(chip()?.textContent).toBe('2 more books waiting');
    // Finish the Add. The receipt it earns stays on screen through its hold,
    // with the count beside it — the queue does not take its place.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start reading' })); });
    await act(async () => {});
    expect(screen.getByTestId('book-save-receipt')).toBeTruthy();
    expect(chip()?.textContent).toBe('2 more books waiting');
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(screen.getByTestId('book-save-receipt')).toBeTruthy();
    expect(chip()?.textContent).toBe('2 more books waiting');
    // The hold lifts; the shelf claims the newest scan (the server retires the
    // older one: it stays a pile card, marked superseded).
    await act(async () => { vi.advanceTimersByTime(3000); });
    s.update({
      scanStatus: { acknowledging: null, cards: [pileCard('scan-3', ISBN3, { superseded: true })] },
      initialBookEntry: { intentId: 'scan-4', isbn13: ISBN4, book: BOOK4, receivedAt: ago(6000), screenId: 'portal' },
    });
    await act(async () => {});
    expect(screen.getByRole('heading', { name: BOOK4.title })).toBeTruthy();
    expect(chip()?.textContent).toContain('1 more book waiting');
    expect(chip()?.textContent).toContain(ISBN3);
    expect(chip()?.textContent).toContain('scan it again to open it');
  });

  it('two scans in one step: the older is superseded — "1 more book waiting", and it is listed by ISBN', async () => {
    h.shelf.mockResolvedValue({ ok: true, status: 200, data: { learnerId: 'kid', items: [], obligation: null } });
    renderShelf({
      initialBookEntry: { intentId: 'scan-4', isbn13: ISBN4, book: BOOK4, receivedAt: ago(100), screenId: 'portal' },
      scanStatus: { acknowledging: null, cards: [pileCard('scan-3', ISBN3, { superseded: true }), pileCard('scan-4', ISBN4)] },
    });
    await act(async () => {});
    expect(screen.getByRole('heading', { name: BOOK4.title })).toBeTruthy();
    // scan-4 is the book on screen (handed to this shelf), so it is not waiting.
    const text = chip()?.textContent ?? '';
    expect(text).toContain('1 more book waiting');
    expect(text).toContain(ISBN3);
    expect(text).toContain('scan it again to open it');
  });

  it('a claimed scan queued behind hand-typed digits counts as waiting, and stops counting once it opens', async () => {
    const s = renderShelf();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /Add a book/ }));
    await act(async () => {});
    for (const key of ['9', '7', '8']) fireEvent.click(screen.getByRole('button', { name: key }));
    expect(chip()).toBeNull();
    s.update({ initialBookEntry: { intentId: 'scan-2', isbn13: ISBN2, book: BOOK2, receivedAt: ago(50), screenId: 'portal' } });
    await act(async () => {});
    expect(chip()?.textContent).toBe('1 more book waiting');
    fireEvent.click(screen.getByTestId('screen-header-back'));
    await act(async () => {});
    expect(screen.getByRole('heading', { name: BOOK2.title })).toBeTruthy();
    expect(chip()).toBeNull();
  });
});
