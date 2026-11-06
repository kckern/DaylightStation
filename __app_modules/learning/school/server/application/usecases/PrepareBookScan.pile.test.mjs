import { randomBytes } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { PrepareBookScan, PILE_QUIET_GAP_MS } from "./PrepareBookScan.mjs";

const ISBNS = ['9780064400558', '9780062691026', '9780763648602', '9780763691677', '9780062042187'];

function fixture({ resolveBook, filer, day = () => '2026-10-30', pile = true } = {}) {
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
  // Timers the service sets (an intent's expiry), run by hand: `fire()`.
  const timers = [];
  const schedule = (fn, ms) => { timers.push({ fn, ms }); };
  const service = new PrepareBookScan({ pile, schedule,
    mintId: () => randomBytes(32).toString('base64url'), resolveBook,
    roster: () => [{ id: 'child' }, { id: 'sibling' }], issueLaunchTarget, wake, notifications, logger,
    clock: () => now, target: { deviceId: 'tablet', screenId: 'portal' },
    filer, dayOf: () => dayValue(),
  });
  let n = 0;
  const receive = (code) => service.receive({ code, device: 'reader', eventId: `e${n++}` });
  return {
    service, filer, wake, resolveBook, logger, receive, notifications, timers,
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

// 2026-11-05: filing gave no feedback, so the child tapped three more times.
// Each extra tap filed nothing and logged nothing, but reset the quiet gap.
describe('PrepareBookScan pile — filing feedback (2026-11-05)', () => {
  it("returns the server's own count of what this tap filed", async () => {
    const f = fixture();
    for (const isbn of ISBNS.slice(0, 2)) await f.receive(isbn);
    await settle();
    const result = await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    expect(result.filed).toEqual({ learnerId: 'child', count: 2, alreadyToday: 0, failed: 0 });
  });

  it('a tap with nothing to file changes nothing, extends nothing, and says so at debug', async () => {
    const f = fixture();
    for (const isbn of ISBNS.slice(0, 2)) await f.receive(isbn);
    await settle();
    await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    const before = pile(f).lastScanAt;
    f.advance(30_000);
    const again = await f.service.filePile({ screenId: 'portal', learnerId: 'child' });
    expect(again.filed).toEqual({ learnerId: 'child', count: 0, alreadyToday: 0, failed: 0 });
    expect(pile(f).lastScanAt).toBe(before);
    expect(f.filer.file).toHaveBeenCalledTimes(2);
    expect(f.logger.debug).toHaveBeenCalledWith('school.book-pile.file-empty', expect.objectContaining({ screenId: 'portal', learnerId: 'child' }));
  });
});

describe('PrepareBookScan — scan logging (2026-11-05)', () => {
  it('names the ISBN on card-added and received, with the firmware capture timing', async () => {
    const f = fixture();
    await f.service.receive({ code: ISBNS[0], device: 'reader', eventId: 'x1', capturedAt: '2026-11-05T03:31:48.000Z', delayedMs: 1300 });
    expect(f.logger.info).toHaveBeenCalledWith('school.book-pile.card-added', expect.objectContaining({ isbn13: ISBNS[0] }));
    expect(f.logger.info).toHaveBeenCalledWith('school.book-scan.received', expect.objectContaining({
      isbn13: ISBNS[0], capturedAt: '2026-11-05T03:31:48.000Z', delayedMs: 1300, receivedAt: expect.any(String),
    }));
  });

  it('warns on a code that is no book, without trying to split it (26 digits, bad checksum)', async () => {
    const f = fixture();
    await f.service.receive({ code: '97800644015189780064401517', device: 'reader', eventId: 'x2' });
    expect(f.logger.warn).toHaveBeenCalledWith('school.book-scan.rejected', expect.objectContaining({ code: '97800644015189780064401517', reason: expect.any(String) }));
    expect(pile(f).cards).toHaveLength(1);
    expect(pile(f).cards[0].status).toBe('invalid');
  });
});

// A screen WITHOUT a pile keeps the corner-offer rules: one presented intent
// plus the newest deferred one. (Final review I1: on the Portal these rules
// discarded books the shelf chip was still counting, so they apply only here.)
describe('PrepareBookScan — a superseded scan is logged (fix round 1; a screen without a pile)', () => {
  it('names the book that lost its intent and the one that replaced it', async () => {
    const f = fixture({ pile: false });
    // The server keeps the oldest live intent plus the newest deferred one, so
    // the third scan inside one shelf step is the first to retire one.
    const first = await f.receive(ISBNS[0]);
    await f.receive(ISBNS[1]);
    expect(f.logger.info).not.toHaveBeenCalledWith('school.book-scan.superseded', expect.anything());
    const third = await f.receive(ISBNS[2]);
    expect(f.logger.info).toHaveBeenCalledWith('school.book-scan.superseded', { screenId: 'portal', isbn13: ISBNS[0], intentId: first.intentId, supersededBy: third.intentId });
  });

  it('logs the older scan a shelf claim retires (two scans in one shelf step)', async () => {
    const f = fixture({ pile: false });
    const first = await f.receive(ISBNS[0]);
    const second = await f.receive(ISBNS[1]);
    await settle();
    await f.service.claim({ id: second.intentId, screenId: 'portal', learnerId: 'child' });
    expect(f.logger.info).toHaveBeenCalledWith('school.book-scan.superseded', { screenId: 'portal', isbn13: ISBNS[0], intentId: first.intentId, supersededBy: second.intentId });
  });
});


describe('PrepareBookScan pile — an open shelf can tell which cards it will never claim (book-scan experience task 3)', () => {
  it('names each card\'s intent, and marks the card whose intent is gone (dismissed)', async () => {
    const f = fixture();
    const first = await f.receive(ISBNS[0]);
    const second = await f.receive(ISBNS[1]);
    await settle();
    const before = pile(f).cards;
    expect(before.map((c) => [c.isbn13, c.intentId, c.superseded])).toEqual([
      [ISBNS[0], first.intentId, false],
      [ISBNS[1], second.intentId, false],
    ]);
    // A pile screen's claim retires nothing (final review I1); the older
    // intent goes because it was dismissed.
    f.service.dismiss({ id: first.intentId, screenId: 'portal' });
    await f.service.claim({ id: second.intentId, screenId: 'portal', learnerId: 'child' });
    const after = pile(f).cards;
    expect(after.find((c) => c.isbn13 === ISBNS[0])).toMatchObject({ state: 'unfiled', superseded: true, intentId: first.intentId });
    expect(after.find((c) => c.isbn13 === ISBNS[1])).toMatchObject({ state: 'claimed', superseded: false });
  });

  it('a rescan of a superseded book is claimable again: its card is no longer marked', async () => {
    const f = fixture();
    const first = await f.receive(ISBNS[0]);
    const second = await f.receive(ISBNS[1]);
    await settle();
    f.service.dismiss({ id: first.intentId, screenId: 'portal' });
    await f.service.claim({ id: second.intentId, screenId: 'portal', learnerId: 'child' });
    f.advance(15_000);
    const again = await f.receive(ISBNS[0]);
    await settle();
    const card = pile(f).cards.find((c) => c.isbn13 === ISBNS[0]);
    expect(card).toMatchObject({ state: 'unfiled', superseded: false, intentId: again.intentId });
    expect(pile(f).cards.filter((c) => c.isbn13 === ISBNS[0])).toHaveLength(1);
  });
});

describe('PrepareBookScan — "scan it again" works at once (task 3 fix round 1)', () => {
  it('a rescan of a superseded book 5 s later is a new claimable intent, not a burst duplicate', async () => {
    const f = fixture();
    const first = await f.receive(ISBNS[0]);
    f.advance(1000);
    const second = await f.receive(ISBNS[1]);
    await settle();
    f.service.dismiss({ id: first.intentId, screenId: 'portal' });
    await f.service.claim({ id: second.intentId, screenId: 'portal', learnerId: 'child' });
    expect(pile(f).cards.find((c) => c.isbn13 === ISBNS[0]).superseded).toBe(true);
    f.advance(4000);
    const again = await f.receive(ISBNS[0]);
    await settle();
    const card = pile(f).cards.find((c) => c.isbn13 === ISBNS[0]);
    expect(card).toMatchObject({ state: 'unfiled', superseded: false, intentId: again.intentId });
    expect(f.service.pending('portal')).toMatchObject({ id: again.intentId, isbn13: ISBNS[0] });
    expect(f.logger.debug).not.toHaveBeenCalledWith('school.book-scan.burst-duplicate', expect.anything());
  });

  it('a genuine burst (live twin) is still absorbed', async () => {
    const f = fixture();
    const first = await f.receive(ISBNS[0]);
    f.advance(3000);
    const again = await f.receive(ISBNS[0]);
    expect(again.intentId).toBe(first.intentId);
    expect(f.logger.debug).toHaveBeenCalledWith('school.book-scan.burst-duplicate', expect.objectContaining({ isbn13: ISBNS[0] }));
  });

  it('an unfiled card whose intent expired or was dismissed is marked superseded too (it can only be rescanned)', async () => {
    const f = fixture();
    const first = await f.receive(ISBNS[0]);
    await settle();
    f.service.dismiss({ id: first.intentId, screenId: 'portal' });
    expect(pile(f).cards.find((c) => c.isbn13 === ISBNS[0])).toMatchObject({ state: 'unfiled', superseded: true });
    f.advance(1000);
    await f.receive(ISBNS[1]);
    await settle();
    expect(pile(f).cards.find((c) => c.isbn13 === ISBNS[1]).superseded).toBe(false);
    f.advance(6 * 60_000);
    expect(pile(f).cards.find((c) => c.isbn13 === ISBNS[1])).toMatchObject({ state: 'unfiled', superseded: true });
  });
});

// ---------------------------------------------------------------------------
// Final review I1 (2026-11-05). The server kept a 2-slot queue: the third scan
// in one shelf step retired the first, and a shelf claim retired every older
// one, while the chip still counted them as "N more books waiting". On a pile
// screen nothing is superseded and the shelf drains first in, first out.
// ---------------------------------------------------------------------------
describe('PrepareBookScan — a pile screen drains in order (final review I1)', () => {
  it('four scans in one shelf step: each is offered in turn, oldest first, and none is superseded', async () => {
    const f = fixture();
    const scans = [];
    for (const isbn of ISBNS.slice(0, 4)) { scans.push(await f.receive(isbn)); f.advance(700); }
    await settle();
    expect(f.service.queue('portal').map((i) => i.id)).toEqual(scans.map((s) => s.intentId));
    for (const [n, scan] of scans.entries()) {
      const next = f.service.pending('portal');
      expect(next).toMatchObject({ id: scan.intentId, isbn13: ISBNS[n] });
      await f.service.claim({ id: next.id, screenId: 'portal', learnerId: 'child' });
      expect(f.service.queue('portal').map((i) => i.id)).toEqual(scans.slice(n + 1).map((s) => s.intentId));
      expect(pile(f).cards.filter((c) => c.state === 'unfiled').every((c) => c.superseded === false)).toBe(true);
      f.advance(9000);
    }
    expect(f.service.pending('portal')).toBeNull();
    expect(f.logger.info).not.toHaveBeenCalledWith('school.book-scan.superseded', expect.anything());
    expect(pile(f).cards.map((c) => c.state)).toEqual(['claimed', 'claimed', 'claimed', 'claimed']);
  });

  it('a claim of a later scan leaves the earlier ones claimable', async () => {
    const f = fixture();
    const first = await f.receive(ISBNS[0]);
    const second = await f.receive(ISBNS[1]);
    await settle();
    await f.service.claim({ id: second.intentId, screenId: 'portal', learnerId: 'child' });
    expect(f.service.pending('portal')).toMatchObject({ id: first.intentId });
    await expect(f.service.claim({ id: first.intentId, screenId: 'portal', learnerId: 'child' })).resolves.toMatchObject({ intentId: first.intentId });
  });

  it('a double-fire is still absorbed while its twin is live', async () => {
    const f = fixture();
    const a = await f.receive(ISBNS[0]); f.advance(2000);
    const b = await f.receive(ISBNS[1]); f.advance(1000);
    const again = await f.receive(ISBNS[0]);
    expect(again.intentId).toBe(a.intentId);
    expect(f.service.queue('portal').map((i) => i.id)).toEqual([a.intentId, b.intentId]);
    expect(pile(f).cards).toHaveLength(2);
  });

  it('an evicted intent still reads superseded ("scan it again")', async () => {
    const f = fixture();
    const first = await f.receive(ISBNS[0]);
    // 32 more distinct books push the first intent out of the bounded store.
    for (let i = 0; i < 32; i += 1) { await f.receive(`97800000${String(i).padStart(4, '0')}`.slice(0, 12) + '0'); f.advance(10); }
    await settle();
    expect(pile(f).cards.find((c) => c.intentId === first.intentId)).toMatchObject({ state: 'unfiled', superseded: true });
  });

  it('a screen without a pile has no queue', () => {
    expect(fixture({ pile: false }).service.queue('portal')).toBeNull();
  });
});

describe('PrepareBookScan — an expired intent says so at once (final review minor)', () => {
  it('notifies the screen when an intent expires, so its card shows "scan it again" without waiting for another event', async () => {
    const f = fixture();
    const first = await f.receive(ISBNS[0]);
    await settle();
    const expiry = f.timers.find((t) => t.ms === 5 * 60_000);
    expect(expiry).toBeTruthy();
    f.notifications.bookScanAvailable.mockClear();
    f.advance(5 * 60_000);
    expiry.fn();
    expect(f.notifications.bookScanAvailable).toHaveBeenCalledWith({ screenId: 'portal', intentId: first.intentId });
    expect(pile(f).cards[0]).toMatchObject({ state: 'unfiled', superseded: true });
  });

  it('says nothing for an intent already claimed', async () => {
    const f = fixture();
    const first = await f.receive(ISBNS[0]);
    await settle();
    await f.service.claim({ id: first.intentId, screenId: 'portal', learnerId: 'child' });
    f.notifications.bookScanAvailable.mockClear();
    f.advance(5 * 60_000);
    for (const t of f.timers) t.fn();
    expect(f.notifications.bookScanAvailable).not.toHaveBeenCalled();
  });
});
