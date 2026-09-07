import { randomBytes } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { PrepareBookScan } from './PrepareBookScan.mjs';
import { HmacSchoolBookGrantIssuer } from '#adapters/school/actions/HmacSchoolBookGrantIssuer.mjs';
const ISBN = '9780064400558';
function fixture(extra = {}) {
  let now = 1000000;
  const grants = new HmacSchoolBookGrantIssuer({ key: 'test-only-secret-key-32-bytes-long-enough', clock: () => now });
  const issueLaunchTarget = vi.fn(({ userId }) => ({ kind: 'program', program: 'book-log', learnerId: userId, bookGrant: grants.issue({ learnerId: userId }) }));
  const resolveBook = { execute: vi.fn(async () => ({ status: 'ok', book: { isbn13: ISBN, title: 'Hatchet' } })) };
  const roster = vi.fn(() => [{ id: 'child' }, { id: 'sibling' }]);
  const wake = vi.fn(async () => {});
  const notifications = { bookScanAvailable: vi.fn() };
  const service = new PrepareBookScan({ mintId: () => randomBytes(32).toString('base64url'), resolveBook, roster, issueLaunchTarget, wake, notifications, clock: () => now,
    target: { deviceId: 'tablet', screenId: 'portal' }, ...extra });
  return { service, grants, issueLaunchTarget, resolveBook, roster, wake, notifications, advance: ms => { now += ms; } };
}
const receive = (f, code = ISBN, eventId = 'one') => f.service.receive({ code, device: 'reader', eventId });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
describe('PrepareBookScan', () => {
  it('retains metadata and wakes without issuing authority until an eligible avatar is claimed', async () => {
    const f = fixture(); await receive(f); await settle();
    const intent = f.service.pending('portal');
    expect(intent).toMatchObject({ isbn13: ISBN, status: 'ready', screenId: 'portal' });
    expect(intent.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.issueLaunchTarget).not.toHaveBeenCalled();
    expect(f.wake).toHaveBeenCalledWith({ target: 'tablet' });
    expect(f.notifications.bookScanAvailable).toHaveBeenCalledWith({ screenId: 'portal', intentId: intent.id });
    const result = await f.service.claim({ id: intent.id, screenId: 'portal', learnerId: 'child' });
    expect(f.grants.verify(result.launchTarget.bookGrant, { learnerId: 'child' }).ok).toBe(true);
    expect(await f.service.claim({ id: intent.id, screenId: 'portal', learnerId: 'child' })).toEqual(result);
    expect(f.issueLaunchTarget).toHaveBeenCalledTimes(1);
    await expect(f.service.claim({ id: intent.id, screenId: 'portal', learnerId: 'sibling' })).rejects.toMatchObject({ status: 409 });
    expect(f.service.pending('portal')).toBeNull();
  });
  it('rejects malformed ISBN before lookup and claim', async () => {
    const f = fixture(); await receive(f, '9780064400559');
    const intent = f.service.pending('portal');
    expect(intent.status).toBe('invalid'); expect(f.resolveBook.execute).not.toHaveBeenCalled();
    await expect(f.service.claim({ id: intent.id, screenId: 'portal', learnerId: 'child' })).rejects.toMatchObject({ status: 400 });
    expect(f.issueLaunchTarget).not.toHaveBeenCalled();
  });
  it('refuses missing, mismatched, expired and currently ineligible claims', async () => {
    const f = fixture(); await receive(f); const { id } = f.service.pending('portal');
    for (const args of [{ id: 'guess', screenId: 'portal', learnerId: 'child' }, { id, screenId: 'other', learnerId: 'child' }, { id, screenId: 'portal', learnerId: 'outsider' }]) {
      await expect(f.service.claim(args)).rejects.toBeInstanceOf(Error);
    }
    f.roster.mockReturnValue([]);
    await expect(f.service.claim({ id, screenId: 'portal', learnerId: 'child' })).rejects.toMatchObject({ status: 403 });
    f.advance(300000);
    await expect(f.service.claim({ id, screenId: 'portal', learnerId: 'child' })).rejects.toMatchObject({ status: 410 });
    expect(f.issueLaunchTarget).not.toHaveBeenCalled();
  });
  it('coalesces ISBN without extending expiry and remembers events after dismissal', async () => {
    const f = fixture(); await receive(f); const first = f.service.pending('portal');
    f.advance(1000); await receive(f, ISBN, 'two');
    expect(f.service.pending('portal').id).toBe(first.id);
    expect(f.service.pending('portal').expiresAt).toBe(first.expiresAt);
    f.service.dismiss({ id: first.id, screenId: 'portal' });
    f.service.dismiss({ id: first.id, screenId: 'portal' });
    await receive(f); expect(f.service.pending('portal')).toBeNull();
    expect(f.wake).toHaveBeenCalledTimes(1);
  });
  it('late metadata never resurrects dismissed or superseded presentation; retention is bounded', async () => {
    let finish; const f = fixture({ resolveBook: { execute: () => new Promise(r => { finish = r; }) } });
    await receive(f); await settle(); const first = f.service.pending('portal');
    f.service.dismiss({ id: first.id, screenId: 'portal' });
    finish({ status: 'ok', book: { isbn13: ISBN } }); await settle();
    expect(f.service.pending('portal')).toBeNull();
    for (let i = 0; i < 40; i++) await receive(f, `978000000${String(i).padStart(4, '0')}`, `e${i}`);
    await expect(f.service.claim({ id: first.id, screenId: 'portal', learnerId: 'child' })).rejects.toMatchObject({ status: 410 });
  });
  it('retains honest lookup/wake failures for reconnect', async () => {
    const f = fixture({ resolveBook: { execute: async () => { throw Error('offline'); } }, wake: async () => { throw Error('asleep'); } });
    await receive(f); await settle(); expect(f.service.pending('portal')).toMatchObject({ status: 'unavailable', error: expect.any(String) });
  });
  it('refuses missing target visibly', async () => {
    const f = fixture({ target: null });
    await expect(receive(f)).rejects.toMatchObject({ status: 503 });
    expect(f.resolveBook.execute).not.toHaveBeenCalled();
  });
});

it('pins concurrent same-learner claims and keeps only the newest deferred scan', async () => {
  let finish; const f = fixture({ issueLaunchTarget: vi.fn(() => new Promise(r => { finish = r; })) });
  await receive(f); const { id } = f.service.pending('portal');
  const a = f.service.claim({ id, screenId: 'portal', learnerId: 'child' });
  const b = f.service.claim({ id, screenId: 'portal', learnerId: 'child' });
  await settle();
  await receive(f, '9791234567896', 'next');
  const superseded = f.service.pending('portal');
  await receive(f, '9780064400559', 'latest');
  const deferred = f.service.pending('portal');
  await expect(f.service.claim({ id: superseded.id, screenId: 'portal', learnerId: 'sibling' })).rejects.toMatchObject({ status: 410 });
  finish({ learnerId: 'child', bookGrant: 'one-grant' });
  expect(await a).toEqual(await b);
  expect(f.service.pending('portal').id).toBe(deferred.id);
});
it('late replaced metadata cannot replace the latest ISBN or revive a dismissed latest intent', async () => {
  const finishes = []; const f = fixture({ resolveBook: { execute: () => new Promise(r => finishes.push(r)) } });
  await receive(f); await settle();
  await receive(f, '9791234567896', 'next'); await settle();
  const next = f.service.pending('portal');
  finishes[0]({ status: 'ok', book: { isbn13: ISBN, title: 'old' } }); await settle();
  expect(f.service.pending('portal')).toMatchObject({ id: next.id, status: 'loading', book: null });
  f.service.dismiss({ id: next.id, screenId: 'portal' });
  finishes[1]({ status: 'ok', book: { title: 'late' } }); await settle();
  expect(f.service.pending('portal')?.id).not.toBe(next.id);
});
it.each(['lookup', 'wake'])('new-event rescan retries a failed %s without extending the intention', async failure => {
  const resolveBook = { execute: vi.fn().mockResolvedValueOnce({ status: failure === 'lookup' ? 'unavailable' : 'ok', book: { isbn13: ISBN } }).mockResolvedValue({ status: 'ok', book: { isbn13: ISBN } }) };
  const wake = vi.fn().mockResolvedValueOnce({ ok: failure !== 'wake' }).mockResolvedValue({ ok: true });
  const f = fixture({ resolveBook, wake }); await receive(f); await settle();
  const first = f.service.pending('portal');
  f.advance(1000); await receive(f, ISBN, 'rescan'); await settle();
  expect(f.service.pending('portal')).toMatchObject({ id: first.id, expiresAt: first.expiresAt, status: 'ready', error: null });
  expect(failure === 'lookup' ? resolveBook.execute : wake).toHaveBeenCalledTimes(2);
});

it('requires composition to supply the secure capability generator', () => {
  expect(() => fixture({ mintId: undefined })).toThrow('requires a secure intent id generator');
});
