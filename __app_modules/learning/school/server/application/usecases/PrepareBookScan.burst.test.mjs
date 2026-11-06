import { randomBytes } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { PrepareBookScan } from "./PrepareBookScan.mjs";

function fixture(targets = { deviceId: 'tablet', screenId: 'portal' }) {
  let now = 1_000_000;
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const service = new PrepareBookScan({
    mintId: () => randomBytes(32).toString('base64url'),
    resolveBook: { execute: vi.fn(async (isbn13) => ({ status: 'ok', book: { isbn13, title: 'B' } })) },
    roster: () => [{ id: 'child' }], issueLaunchTarget: vi.fn(), wake: vi.fn(async () => {}),
    notifications: { bookScanAvailable: vi.fn() }, logger, clock: () => now,
    target: targets, filer: null, dayOf: () => '2026-11-05',
  });
  let n = 0;
  const receive = (code, target) => service.receive({ code, device: 'reader', eventId: `e${n++}` });
  return { service, logger, receive, advance: (ms) => { now += ms; } };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const events = (f, level, name) => f.logger[level].mock.calls.filter(([e]) => e === name);

describe('PrepareBookScan burst + split', () => {
  it('splits a doubled ISBN: one record, duplicates 1, one split log', async () => {
    const f = fixture();
    const r = await f.receive('97800644015179780064401517'); await settle();
    expect(r.status).toBe('split');
    expect(r.results).toHaveLength(2);
    expect(r.results[1].intentId).toBe(r.results[0].intentId);
    const pile = f.service.pile('portal');
    expect(pile.cards).toHaveLength(1);
    expect(pile.cards[0].duplicates).toBe(1);
    expect(events(f, 'info', 'school.book-scan.split')).toHaveLength(1);
    expect(events(f, 'info', 'school.book-scan.split')[0][1]).toEqual({ screenId: 'portal', codes: ['9780064401517', '9780064401517'] });
  });

  it('splits two different ISBNs into two records', async () => {
    const f = fixture();
    const r = await f.receive('97805935319079780064401517'); await settle();
    expect(r.status).toBe('split');
    expect(f.service.pile('portal').cards.map((c) => c.isbn13)).toEqual(['9780593531907', '9780064401517']);
    expect(r.results[0].intentId).not.toBe(r.results[1].intentId);
  });

  it('a 26-digit code with a bad checksum in either half stays one invalid record', async () => {
    for (const code of ['97800644015189780064401517', '97800644015179780064401518']) {
      const f = fixture();
      const r = await f.receive(code); await settle();
      expect(r.status).toBe('pending');
      const cards = f.service.pile('portal').cards;
      expect(cards).toHaveLength(1);
      expect(cards[0].status).toBe('invalid');
      expect(events(f, 'info', 'school.book-scan.split')).toHaveLength(0);
    }
  });

  it('same ISBN 3s apart is one record, duplicates 1, burst-duplicate logged', async () => {
    const f = fixture();
    const a = await f.receive('9780064401517'); f.advance(3000); const b = await f.receive('9780064401517'); await settle();
    expect(b.intentId).toBe(a.intentId);
    const pile = f.service.pile('portal');
    expect(pile.cards).toHaveLength(1);
    expect(pile.cards[0].duplicates).toBe(1);
    expect(events(f, 'debug', 'school.book-scan.burst-duplicate')[0][1]).toEqual({ screenId: 'portal', isbn13: '9780064401517', msSinceFirst: 3000 });
  });

  it('same ISBN 11s apart is not absorbed (today\'s behaviour)', async () => {
    const f = fixture();
    const a = await f.receive('9780064401517'); f.advance(11_000); const b = await f.receive('9780064401517'); await settle();
    expect(events(f, 'debug', 'school.book-scan.burst-duplicate')).toHaveLength(0);
    expect(b.intentId).toBe(a.intentId); // today: coalesced onto the live intention
    expect(f.service.pile('portal').cards[0].duplicates).toBe(1);
  });

  it('the window is per screen: another screen is not absorbed', async () => {
    // The use case serves a single configured screen, so a second screen is a second instance
    // sharing nothing; its first scan must never be absorbed by the other\'s window.
    const a = fixture({ deviceId: 'tablet', screenId: 'portal' });
    const b = fixture({ deviceId: 'tablet2', screenId: 'other' });
    await a.receive('9780064401517'); a.advance(1000);
    await b.receive('9780064401517'); await settle();
    expect(events(b, 'debug', 'school.book-scan.burst-duplicate')).toHaveLength(0);
    expect(b.service.pile('other').cards).toHaveLength(1);
  });
});
