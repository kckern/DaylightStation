import { describe, it, expect } from 'vitest';
import { LedgerPlayTimeGrants } from './LedgerPlayTimeGrants.mjs';

const quiet = { warn() {} };
const build = (grantedMs, isAdmin = async () => false) => new LedgerPlayTimeGrants({
  ledger: { forUserOn: async () => ({ grantedMs, entries: [] }) },
  isAdmin, today: () => '2026-09-11', logger: quiet,
});

describe('LedgerPlayTimeGrants', () => {
  it('gives an adult no ceiling', async () => {
    const g = await build(0, async () => true).forSession({ payerId: 'parent' });
    expect(g).toEqual({ grantedMs: null, grantRef: 'admin:parent' });
  });

  it('gives a child the time on their ledger', async () => {
    const g = await build(20 * 60_000).forSession({ payerId: 'child' });
    expect(g).toMatchObject({ grantedMs: 1_200_000 });
    expect(g.grantRef).toContain('2026-09-11');
  });

  it('gives NO grant rather than zero when nothing was granted', async () => {
    // Zero would expire the instant a game started; null means unmetered.
    expect(await build(0).forSession({ payerId: 'child' })).toBeNull();
  });

  it('charges the payer, not another participant', async () => {
    const g = await build(60_000).forSession({ payerId: 'payer', participants: ['sibling'] });
    expect(g.grantRef).toContain('payer');
  });

  it('does not assume adulthood when the check fails', async () => {
    const g = await build(0, async () => { throw new Error('profiles down'); }).forSession({ payerId: 'child' });
    expect(g).toBeNull();
  });

  it('gives no grant when the ledger cannot be read', async () => {
    const g = new LedgerPlayTimeGrants({
      ledger: { forUserOn: async () => { throw new Error('disk'); } },
      isAdmin: async () => false, logger: quiet,
    });
    expect(await g.forSession({ payerId: 'child' })).toBeNull();
  });
});
