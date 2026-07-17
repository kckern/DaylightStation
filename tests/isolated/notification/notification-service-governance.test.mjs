import { describe, it, expect, vi } from 'vitest';
import { NotificationService } from '#apps/notification/NotificationService.mjs';
import { NotificationPolicy } from '#domains/notification/services/NotificationPolicy.mjs';
import { QuietHours } from '#domains/notification/value-objects/QuietHours.mjs';

function makeService({ ledgerStore, quietHours = null, cooldowns = { default: 60 }, now }) {
  const appSends = [];
  const appAdapter = { channel: 'app', send: async (i) => { appSends.push(i); return { delivered: true, channelId: 'app' }; } };
  const svc = new NotificationService({
    adapters: [appAdapter],
    preferenceLoader: () => ({ getChannelsFor: () => ['app'] }),
    policy: new NotificationPolicy(),
    ledgerStore,
    configLoader: () => ({ quietHours, cooldowns }),
    clock: { now: () => now },
    logger: { debug() {}, warn() {} },
  });
  return { svc, appSends };
}
const intent = (over = {}) => ({ title: 'Set your intention', body: 'b', category: 'ceremony', urgency: 'normal', metadata: { username: 'kckern' }, dedupeKey: 'ceremony:unit_intention:2026-07-17', ...over });

describe('NotificationService governance', () => {
  it('suppresses a 2nd identical intent within cooldown and does not hit the adapter', async () => {
    const state = { last: null, suppressed: [] };
    const ledgerStore = {
      getLastSent: () => state.last,
      recordSent: ({ atMs }) => { state.last = atMs; },
      recordSuppressed: (e) => state.suppressed.push(e),
    };
    const now = new Date(2026, 6, 17, 12, 0, 0);
    const { svc, appSends } = makeService({ ledgerStore, cooldowns: { default: 60 }, now });
    const r1 = await svc.send(intent());
    expect(r1[0].delivered).toBe(true);
    expect(appSends.length).toBe(1);
    const r2 = await svc.send(intent());               // same key, same minute
    expect(r2[0]).toMatchObject({ delivered: false, suppressed: true, reason: 'cooldown' });
    expect(appSends.length).toBe(1);                    // adapter NOT hit again
    expect(state.suppressed[0]).toMatchObject({ reason: 'cooldown', dedupeKey: 'ceremony:unit_intention:2026-07-17' });
  });

  it('suppresses non-critical during quiet hours but delivers critical', async () => {
    const ledgerStore = { getLastSent: () => null, recordSent() {}, recordSuppressed() {} };
    const q = new QuietHours({ enabled: true, start: '21:00', end: '07:00' });
    const now = new Date(2026, 6, 17, 23, 0, 0);
    const { svc, appSends } = makeService({ ledgerStore, quietHours: q, now });
    const r = await svc.send(intent({ urgency: 'high', dedupeKey: 'k1' }));
    expect(r[0]).toMatchObject({ delivered: false, suppressed: true, reason: 'quiet_hours' });
    expect(appSends.length).toBe(0);
    const rc = await svc.send(intent({ urgency: 'critical', dedupeKey: 'k2' }));
    expect(rc[0].delivered).toBe(true);
    expect(appSends.length).toBe(1);
  });

  it('degrades open when the ledger store throws', async () => {
    const ledgerStore = { getLastSent: () => { throw new Error('disk gone'); }, recordSent() {}, recordSuppressed() {} };
    const now = new Date(2026, 6, 17, 12, 0, 0);
    const { svc, appSends } = makeService({ ledgerStore, now });
    const r = await svc.send(intent());
    expect(r[0].delivered).toBe(true);   // delivered despite governance error
    expect(appSends.length).toBe(1);
  });
});
