/**
 * THE FOUR-BOOK INCIDENT, END TO END (final review I1, 2026-11-05).
 *
 * The real server use case (`PrepareBookScan`, as the Portal wires it) behind
 * the real panel pieces (`BookScanEntry`, `BookPile`, `BookShelf`), joined the
 * way `SchoolApp` joins them. Only the transport is faked: the API calls the
 * service directly and its notices reach every subscribed hook.
 *
 * The server used to keep a 2-slot queue — the third scan in one shelf step
 * retired the first, a shelf claim retired every older one — while the chip
 * still counted them as "N more books waiting", then told the child to scan
 * them again. On the Portal the shelf now drains first in, first out.
 */
import { randomBytes } from 'node:crypto';
import { useState, useMemo } from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ failClaims: new Set(), service: null, subscribers: new Set(), log: vi.fn(), debug: vi.fn(), warn: vi.fn(), open: vi.fn(), shelf: vi.fn() }));
const ok = (data) => ({ ok: true, status: 200, data });
const call = async (fn) => {
  try { return ok(await fn()); } catch (error) { return { ok: false, status: error.status ?? 500, data: { error: { message: error.message } } }; }
};
vi.mock("../schoolApi.js", () => ({ schoolApi: {
  roster: async () => ok([]),
  books: {
    shelf: (...a) => h.shelf(...a), open: (...a) => h.open(...a),
    progress: async () => ok({ ok: true }), mode: async () => ok({}), resolve: async () => ok({}),
  },
  bookScans: {
    pending: async (screenId) => call(() => {
      const queue = h.service.queue(screenId);
      return { intent: h.service.pending(screenId), ...(queue ? { queue } : {}) };
    }),
    claim: async (id, { screenId, learnerId }) => (h.failClaims.has(id)
      ? { ok: false, status: 410, data: { error: { message: 'This scan is no longer available. Scan again.' } } }
      : call(() => h.service.claim({ id, screenId, learnerId }))),
    dismiss: async (id, { screenId }) => call(() => h.service.dismiss({ id, screenId })),
    pile: async (screenId) => call(() => ({ pile: h.service.pile(screenId) })),
    filePile: async () => ({ ok: false, status: 503, data: {} }),
  },
} }));
vi.mock("../../../../../frontend/src/hooks/useWebSocket.js", async () => {
  const { useEffect, useRef } = await import('react');
  return { useWebSocketSubscription: (_topic, cb) => {
    const ref = useRef(cb); ref.current = cb;
    useEffect(() => { const fn = (msg) => ref.current(msg); h.subscribers.add(fn); return () => h.subscribers.delete(fn); }, []);
  } };
});
vi.mock("../../../../../frontend/src/services/WebSocketService.js", () => ({ wsService: { onStatusChange: () => () => {} } }));
vi.mock("../schoolLog.js", () => ({ schoolLog: {
  bookShelf: (...a) => h.log(...a), bookShelfError: vi.fn(), bookShelfDebug: (...a) => h.debug(...a), bookShelfWarn: (...a) => h.warn(...a),
} }));
vi.mock("../../../../../frontend/src/lib/identity/ProfileAvatar.jsx", () => ({ default: () => <span>avatar</span> }));

import { PrepareBookScan } from "../../server/application/usecases/PrepareBookScan.mjs";
import BookScanEntry from "./BookScanEntry.jsx";
import BookPile from "./BookPile.jsx";
import BookShelf from "./BookShelf.jsx";

const TITLES = {
  '9780064400558': 'Book Zero',
  '9780062691026': 'Book One',
  '9780763648602': 'Book Two',
  '9780763691677': 'Book Three',
  '9780062042187': 'Book Four',
};
const [ISBN0, ...FOUR] = Object.keys(TITLES);

function makeService({ pile = true } = {}) {
  const notify = ({ screenId, intentId }) => { for (const fn of [...h.subscribers]) fn({ type: 'school.book-scan', screenId, intentId }); };
  return new PrepareBookScan({
    pile, mintId: () => randomBytes(32).toString('base64url'),
    resolveBook: { execute: async (isbn13) => ({ status: 'ok', book: { isbn13, title: TITLES[isbn13] ?? 'Other', authors: [] } }) },
    roster: () => [{ id: 'kid' }],
    issueLaunchTarget: ({ userId }) => ({ kind: 'program', program: 'book-log', learnerId: userId, bookGrant: `grant-${userId}` }),
    wake: async () => ({ ok: true }), notifications: { bookScanAvailable: notify },
    target: { deviceId: 'tablet', screenId: 'portal' }, dayOf: () => '2026-11-05',
    schedule: () => {},
  });
}

/** `SchoolApp`'s wiring of the three; `open` is the child's shelf being open. */
function Panel({ open = true }) {
  const [ready, setReady] = useState(false);
  const [ack, setAck] = useState(null);
  const [cards, setCards] = useState(null);
  const [entry, setEntry] = useState(null);
  const scanStatus = useMemo(() => ({ acknowledging: ack, cards: cards ?? [] }), [ack, cards]);
  return (
    <>
      <BookScanEntry screenId="portal" roster={[]} safe={false} pile
        scopeLearnerId={open && ready ? 'kid' : null} shelfLearnerId={open ? 'kid' : null} onShelfScan={setAck}
        onLaunch={(target) => setEntry(target.bookEntry)} />
      <BookPile screenId="portal" roster={[]} safe={false} scopeLearnerId={open ? 'kid' : null} onShelfCards={setCards} />
      {open && <BookShelf learnerId="kid" grant="g" idleTimeoutSeconds={600} onExit={() => {}}
        initialBookEntry={entry} onScanReadyChange={setReady} scanStatus={scanStatus} />}
    </>
  );
}

let n = 0;
const scan = async (code) => { let r; await act(async () => { r = await h.service.receive({ code, device: 'reader', eventId: `e${n++}` }); }); await flush(); return r; };
const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => {}); };
const chip = () => screen.queryByTestId('scan-status-chip')?.textContent ?? null;
const heading = (title) => screen.queryByRole('heading', { name: title });
const startReading = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start reading' })); }); await flush(); };
// The panel at rest, then the child's shelf opens.
const openShelf = async () => { const view = render(<Panel open={false} />); await flush(); view.rerender(<Panel open />); await flush(); return view; };
const holdLifts = async () => { await act(async () => { vi.advanceTimersByTime(4100); }); await flush(); };

beforeEach(() => {
  vi.clearAllMocks();
  h.subscribers.clear();
  h.failClaims.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  h.shelf.mockResolvedValue(ok({ learnerId: 'kid', items: [], obligation: null }));
  h.open.mockImplementation(async (_learner, body) => ok({ ok: true, item: { itemId: `kid:${body?.isbn13 ?? 'x'}:e0`, bookId: body?.isbn13 ?? 'x', events: [], projection: { status: 'reading' } } }));
});
afterEach(() => { vi.useRealTimers(); });

describe('the four-book incident: four scans during one shelf step', () => {
  it('all four open one by one after each step and the receipt hold; the chip counts down; nothing says "scan it again"', async () => {
    h.service = makeService();
    await openShelf();
    // The shelf is open and asking for a barcode: the first book opens at once.
    await scan(ISBN0);
    expect(heading('Book Zero')).toBeTruthy();
    // Four more while the child is on that book's cover step.
    for (const isbn of FOUR) { await scan(isbn); await act(async () => { vi.advanceTimersByTime(700); }); }
    await flush();
    expect(heading('Book Zero')).toBeTruthy();
    expect(chip()).toBe('4 more books waiting');

    const counts = [];
    for (const [i, isbn] of FOUR.entries()) {
      await startReading();
      // The receipt holds the screen; the books keep waiting.
      expect(screen.getByTestId('book-save-receipt')).toBeTruthy();
      expect(chip()).toBe(`${4 - i} more books waiting`.replace(/^1 more books/, '1 more book'));
      await holdLifts();
      expect(heading(TITLES[isbn])).toBeTruthy();
      counts.push(chip());
      expect(chip() ?? '').not.toContain('scan it again');
    }
    expect(counts).toEqual(['3 more books waiting', '2 more books waiting', '1 more book waiting', null]);
    // Every one was claimed, in the order scanned; none was superseded.
    expect(h.service.pile('portal').cards.map((c) => [c.isbn13, c.state])).toEqual([ISBN0, ...FOUR].map((isbn) => [isbn, 'claimed']));
    // They had all been shown as waiting: no "acknowledged" for them, and each
    // visible log says the scan waited.
    expect(h.log.mock.calls.filter(([e]) => e === 'scan.acknowledged')).toHaveLength(1);
    const visible = h.log.mock.calls.filter(([e]) => e === 'scan.visible').map(([, d]) => d.queued);
    expect(visible).toEqual([false, true, true, true, true]);
  });

  it('a scan already waiting when the shelf opened stays in the pile and does not hold up the books scanned after it', async () => {
    h.service = makeService();
    // Scanned before the shelf opened: another child's stack, most likely.
    await h.service.receive({ code: ISBN0, device: 'reader', eventId: 'before' });
    await openShelf();
    expect(heading('Book Zero')).toBeNull();
    await scan(FOUR[0]);
    expect(heading('Book One')).toBeTruthy();
    expect(h.service.pile('portal').cards.find((c) => c.isbn13 === ISBN0).state).toBe('unfiled');
  });

  it('an unreadable barcode in the queue does not hold up the books behind it', async () => {
    h.service = makeService();
    await openShelf();
    await scan(ISBN0);
    await scan('9780064400559');      // bad checksum: an invalid card, never openable
    await scan(FOUR[0]);
    await startReading();
    await holdLifts();
    expect(heading('Book One')).toBeTruthy();
  });

  it('a genuinely expired scan still says "scan it again"', async () => {
    h.service = makeService();
    await openShelf();
    await scan(ISBN0);
    await scan(FOUR[0]);
    expect(chip()).toBe('1 more book waiting');
    // The child stays on the step past the scan's five minutes.
    await act(async () => { vi.advanceTimersByTime(5 * 60_000 + 1000); });
    await act(async () => { for (const fn of [...h.subscribers]) fn({ type: 'school.book-scan', screenId: 'portal' }); });
    await flush();
    expect(chip()).toContain('scan it again to open it');
  });
});

// Re-review residual: a failed claim at the head of the queue must not stall
// it. The failure re-reads the queue, whose walk skips the failed head.
describe('a failed claim at the head of the queue', () => {
  it('the next book opens without any further scan or notice', async () => {
    h.service = makeService();
    await openShelf();
    await scan(ISBN0);
    expect(heading('Book Zero')).toBeTruthy();
    const queued = [];
    for (const isbn of FOUR) queued.push(await scan(isbn));
    expect(chip()).toBe('4 more books waiting');
    h.failClaims.add(queued[0].intentId);
    await startReading();
    await holdLifts();
    await flush();
    expect(heading('Book Two')).toBeTruthy();
    expect(h.service.pile('portal').cards.find((c) => c.isbn13 === FOUR[1]).state).toBe('claimed');
  });
});
