import { describe, expect, it, vi } from 'vitest';
import { LibbyStreamLeaseService } from './LibbyStreamLeaseService.mjs';

const loan = { cardId: '123456789', titleId: '9999999', expiresAt: 2_000_000 };
const part = { key: 'part-a', upstreamUrl: 'https://listen.libbyapp.com/a.mp3', headers: {} };

describe('LibbyStreamLeaseService', () => {
  it('stores only a hash of the issued handle and scopes it to one part', () => {
    const service = new LibbyStreamLeaseService({ now: () => 1_000_000, randomBytes: () => Buffer.from('0123456789abcdef0123456789abcdef') });
    const issued = service.issue({ loan, part });
    expect(issued.handle).toBeTruthy();
    expect(JSON.stringify(service.inspect())).not.toContain(issued.handle);
    expect(service.resolve(issued.handle)).toMatchObject({ kind: 'found', lease: { cardId: '123456789', titleId: '9999999', partKey: 'part-a' } });
  });

  it('expires leases at the earliest of idle, absolute, and loan deadlines', () => {
    let now = 1_000;
    const service = new LibbyStreamLeaseService({ now: () => now, idleMs: 100, absoluteMs: 1_000, randomBytes: () => Buffer.alloc(32, 1) });
    const { handle } = service.issue({ loan: { ...loan, expiresAt: 5_000 }, part });
    now = 1_101;
    expect(service.resolve(handle)).toEqual({ kind: 'gone', reason: 'expired' });
  });

  it('aborts active upstream work when a lease is revoked', () => {
    const service = new LibbyStreamLeaseService({ now: () => 1_000, randomBytes: () => Buffer.alloc(32, 2) });
    const { handle } = service.issue({ loan, part });
    const controller = new AbortController();
    service.attachAbort(handle, controller);
    expect(service.revoke(handle)).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(service.resolve(handle)).toEqual({ kind: 'gone', reason: 'absent' });
  });

  it('revokes every sibling handle and active request for a loan', () => {
    let byte = 3;
    const service = new LibbyStreamLeaseService({ now: () => 1_000, randomBytes: () => Buffer.alloc(32, byte++) });
    const first = service.issue({ loan, part }).handle;
    const second = service.issue({ loan, part: { ...part, key: 'part-b' } }).handle;
    const a = new AbortController();
    const b = new AbortController();
    service.attachAbort(first, a);
    service.attachAbort(second, b);

    expect(service.revokeLoan(loan.cardId, loan.titleId)).toBe(2);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
  });

  it('prunes expired leases without resolving their original handles', () => {
    let now = 1_000;
    const service = new LibbyStreamLeaseService({ now: () => now, absoluteMs: 100, randomBytes: () => Buffer.alloc(32, 9) });
    service.issue({ loan, part });
    now = 1_101;
    expect(service.prune()).toBe(1);
    expect(service.inspect()).toEqual([]);
  });
});
