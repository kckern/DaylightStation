import { describe, it, expect } from 'vitest';
import { PhoneInboxContentAdapter } from './PhoneInboxContentAdapter.mjs';

function inboxDouble(present) {
  const queued = [];
  return { queued, isPresent: () => present, enqueue: (id, envelope) => queued.push({ id, envelope }) };
}

describe('PhoneInboxContentAdapter', () => {
  it('a phone that is not polling is "not connected" (the dispatch reads not delivered)', async () => {
    const inbox = inboxDouble(false);
    const r = await new PhoneInboxContentAdapter({ deviceId: 'phone' }, { inbox, logger: {} }).load('/screen/phone', { play: 'plex:1', dispatchId: 'd1' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not connected/i);
    expect(inbox.queued).toEqual([]);
  });

  it('queues the same queue envelope a screen gets, commandId = dispatchId', async () => {
    const inbox = inboxDouble(true);
    const adapter = new PhoneInboxContentAdapter({ deviceId: 'phone' }, { inbox, logger: {} });
    const r = await adapter.load('/screen/phone', { queue: 'plex:42', dispatchId: 'd2', shuffle: '1' });
    expect(r).toMatchObject({ ok: true, method: 'phone-inbox', commandId: 'd2' });
    const { id, envelope } = inbox.queued[0];
    expect(id).toBe('phone');
    expect(envelope).toMatchObject({ command: 'queue', commandId: 'd2', targetDevice: 'phone', params: { contentId: 'plex:42', op: 'play-now', shuffle: '1' } });
    expect(envelope.params.dispatchId).toBeUndefined();
    expect(adapter.wantsPrewarm()).toBe(false);
    expect(await adapter.prepareForContent()).toEqual({ ok: true });
  });

  it('refuses a load with no content id', async () => {
    const r = await new PhoneInboxContentAdapter({ deviceId: 'phone' }, { inbox: inboxDouble(true), logger: {} }).load('/x', {});
    expect(r.ok).toBe(false);
  });
});
