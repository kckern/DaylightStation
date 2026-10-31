import { randomBytes } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { PrepareBookScan, PILE_QUIET_GAP_MS } from "./PrepareBookScan.mjs";

const ISBNS = ['9780064400558', '9780062691026', '9780763648602', '9780763691677', '9780062042187'];

function fixture({ resolveBook, filer, day = () => '2026-10-30' } = {}) {
  let now = 1_000_000;
  let dayValue = day;
  const issueLaunchTarget = vi.fn(({ userId }) => ({ kind: 'program', program: 'book-log', learnerId: userId, bookGrant: 'grant' }));
  resolveBook ??= { execute: vi.fn(async (isbn13) => ({ status: 'ok', book: { isbn13, title: `Book ${isbn13.slice(-4)}` } })) };
  filer ??= {
    file: vi.fn(async ({ isbn13 }) => ({ outcome: 'finished-new', itemId: `it-${isbn13}` })),
    undo: vi.fn(async () => ({ outcome: 'reopened' })),
  };
  const wake = vi.fn(async () => {});
  const notifications = { bookScanAvailable: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const service = new PrepareBookScan({
    mintId: () => randomBytes(32).toString('base64url'), resolveBook,
    roster: () => [{ id: 'child' }, { id: 'sibling' }], issueLaunchTarget, wake, notifications, logger,
    clock: () => now, target: { deviceId: 'tablet', screenId: 'portal' },
    filer, dayOf: () => dayValue(),
  });
  let n = 0;
  const receive = (code) => service.receive({ code, device: 'reader', eventId: `e${n++}` });
  return {
    service, filer, wake, resolveBook, logger, receive,
    advance: (ms) => { now += ms; },
    setDay: (fn) => { dayValue = fn; },
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const pile = (f) => f.service.pile('portal');

describe('PrepareBookScan pile', () => {
  it('keeps every scan as a card, in order', async () => {
    const f = fixture();
    for (const isbn of ISBNS) { await f.receive(isbn); f.advance(200); }
    await settle();
    expect(pile(f).cards.map((c) => c.isbn13)).toEqual(ISBNS);
    expect(pile(f).cards.every((c) => c.state === 'unfiled' && c.status === 'ready')).toBe(true);
  });

  it('same book twice in a live session is one card', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); f.advance(5000); await f.receive(ISBNS[0]); await settle();
    expect(pile(f).cards).toHaveLength(1);
    expect(pile(f).cards[0].duplicates).toBe(1);
  });

  it('one tap files the whole pile and makes the reader sticky', async () => {
    const f = fixture();
    for (const isbn of ISBNS.slice(0, 3)) await f.receive(isbn);
    await settle();
    const result = await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    expect(result.reader).toBe('child');
    expect(result.cards.every((c) => c.state === 'filed' && c.learnerId === 'child' && c.outcome === 'finished-new')).toBe(true);
    expect(f.filer.file).toHaveBeenCalledTimes(3);
  });

  it('a loading card files when its lookup settles', async () => {
    let release;
    const resolveBook = { execute: vi.fn(() => new Promise((r) => { release = () => r({ status: 'ok', book: { title: 'Late' } }); })) };
    const f = fixture({ resolveBook });
    await f.receive(ISBNS[0]);
    await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    expect(f.filer.file).not.toHaveBeenCalled();
    release(); await settle();
    await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    expect(f.filer.file).toHaveBeenCalledTimes(1);
    expect(pile(f).cards[0].state).toBe('filed');
  });

  it('files a card added during an in-flight file exactly once', async () => {
    let release;
    const filer = {
      file: vi.fn(({ isbn13 }) => new Promise((r) => { release = () => r({ outcome: 'finished-new', itemId: `it-${isbn13}` }); })),
      undo: vi.fn(),
    };
    const f = fixture({ filer });
    await f.receive(ISBNS[0]); await settle();
    const first = f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    await settle();
    const second = f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    release(); await first; await settle(); await second;
    expect(filer.file).toHaveBeenCalledTimes(1);
  });

  it('the quiet gap ends reader stickiness but keeps unfiled cards', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); await settle();
    await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    await f.receive(ISBNS[1]); await settle();
    expect(pile(f).reader).toBe('child');
    f.advance(PILE_QUIET_GAP_MS + 1);
    expect(pile(f).live).toBe(false);
    await f.receive(ISBNS[2]); await settle();
    expect(pile(f).reader).toBeNull();
    expect(pile(f).cards.map((c) => c.isbn13)).toContain(ISBNS[1]);
  });

  it('a new session does not merge a same-ISBN card from an earlier one', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); await settle();
    await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    f.advance(PILE_QUIET_GAP_MS + 1);
    await f.receive(ISBNS[0]); await settle();
    expect(pile(f).cards.filter((c) => c.isbn13 === ISBNS[0])).toHaveLength(2);
  });

  it('cards clear at the study-day boundary', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); await settle();
    f.setDay(() => '2026-10-31');
    expect(pile(f).cards).toEqual([]);
  });

  it('a later scan in a live session does not wake again', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); f.advance(10_000);
    await f.receive(ISBNS[1]); f.advance(10_000);
    await f.receive(ISBNS[2]); await settle();
    expect(f.wake).toHaveBeenCalledTimes(1);
  });

  it('move and remove on a filed card undo it', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); await f.receive(ISBNS[1]); await settle();
    await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    const [a, b] = pile(f).cards;
    await f.service.moveCard({ screenId: 'portal', cardId: a.id, learnerId: 'sibling' });
    expect(f.filer.undo).toHaveBeenCalledWith(expect.objectContaining({ learnerId: 'child', itemId: `it-${a.isbn13}` }));
    expect(pile(f).cards.find((c) => c.id === a.id)).toMatchObject({ state: 'filed', learnerId: 'sibling' });
    expect(pile(f).reader).toBe('child');
    await f.service.removeCard({ screenId: 'portal', cardId: b.id });
    expect(f.filer.undo).toHaveBeenCalledTimes(2);
    expect(pile(f).cards.find((c) => c.id === b.id)).toBeUndefined();
  });

  it('a retry after undo uses a fresh attempt key', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); await settle();
    await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    const [card] = pile(f).cards;
    await f.service.moveCard({ screenId: 'portal', cardId: card.id, learnerId: 'sibling' });
    const keys = f.filer.file.mock.calls.map(([args]) => args.attemptKey);
    expect(new Set(keys).size).toBe(2);
  });

  it('a scoped claim marks its card claimed', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); await settle();
    const intent = f.service.pending('portal');
    await f.service.claim({ id: intent.id, screenId: 'portal', learnerId: 'child' });
    expect(pile(f).cards[0].state).toBe('claimed');
    await f.service.filePile({ screenId: 'portal', learnerId: 'sibling' });
    expect(f.filer.file).not.toHaveBeenCalled();
  });

  it('remove on an already-today card leaves the child\'s own finish alone', async () => {
    const filer = { file: vi.fn(async () => ({ outcome: 'already-today', itemId: 'theirs' })), undo: vi.fn(async () => ({ outcome: 'untouched' })) };
    const f = fixture({ filer });
    await f.receive(ISBNS[0]); await settle();
    await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    await f.service.removeCard({ screenId: 'portal', cardId: pile(f).cards[0].id });
    expect(filer.undo).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'already-today' }));
  });

  it('a filed card is no longer offered to an open shelf', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); await settle();
    expect(f.service.pending('portal')).not.toBeNull();
    await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    expect(f.service.pending('portal')).toBeNull();
  });

  it('a removed card is no longer offered to an open shelf', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); await settle();
    await f.service.removeCard({ screenId: 'portal', cardId: pile(f).cards[0].id });
    expect(f.service.pending('portal')).toBeNull();
  });

  it('a rescan of a book a shelf claimed is a new card', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); await settle();
    const intent = f.service.pending('portal');
    await f.service.claim({ id: intent.id, screenId: 'portal', learnerId: 'child' });
    await f.receive(ISBNS[0]); await settle();
    expect(pile(f).cards.map((c) => c.state)).toEqual(['claimed', 'unfiled']);
  });

  it('a tap on a pile from a closed session starts a new session', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); await settle();
    f.advance(PILE_QUIET_GAP_MS + 1);
    await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    await f.receive(ISBNS[0]); await settle();
    expect(pile(f).cards.filter((c) => c.isbn13 === ISBNS[0])).toHaveLength(2);
  });

  it('reading an unknown screen allocates nothing', () => {
    const f = fixture();
    expect(f.service.pile('nowhere')).toMatchObject({ cards: [], live: false, reader: null });
  });

  it('refuses foreign card ids', async () => {
    const f = fixture();
    await f.receive(ISBNS[0]); await settle();
    await expect(f.service.removeCard({ screenId: 'portal', cardId: 'guess' })).rejects.toMatchObject({ status: 403 });
    await expect(f.service.removeCard({ screenId: 'other', cardId: pile(f).cards[0].id })).rejects.toMatchObject({ status: 403 });
  });

  it('refuses filing when no filer is wired', async () => {
    const f = fixture();
    const bare = new PrepareBookScan({
      mintId: () => 'x'.repeat(43), resolveBook: f.resolveBook, roster: () => [], issueLaunchTarget: vi.fn(),
      wake: vi.fn(async () => {}), notifications: { bookScanAvailable: vi.fn() }, target: { deviceId: 't', screenId: 'portal' },
    });
    await expect(bare.filePile({ screenId: 'portal', learnerId: 'child' })).rejects.toMatchObject({ status: 503 });
  });

  it('an invalid barcode is a card that never files', async () => {
    const f = fixture();
    await f.receive('9780064400559'); await settle();
    await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    expect(pile(f).cards[0]).toMatchObject({ status: 'invalid', state: 'unfiled' });
    expect(f.filer.file).not.toHaveBeenCalled();
  });
});
