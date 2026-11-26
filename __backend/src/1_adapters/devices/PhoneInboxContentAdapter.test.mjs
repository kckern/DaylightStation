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

  it('carries the install the person picked; a bad one is dropped', async () => {
    const inbox = inboxDouble(true);
    const adapter = new PhoneInboxContentAdapter({ deviceId: 'phone' }, { inbox, logger: {} });
    await adapter.load('/x', { play: 'plex:1', dispatchId: 'd3', installId: 'install-aaaa-1111' });
    expect(inbox.queued[0].envelope.installId).toBe('install-aaaa-1111');
    expect(inbox.queued[0].envelope.params.installId).toBeUndefined();
    await adapter.load('/x', { play: 'plex:1', dispatchId: 'd4', installId: 'x' });
    expect(inbox.queued[1].envelope.installId).toBeUndefined();
  });

  it('two phones live and none picked: a final refusal (nothing else can reach a phone)', async () => {
    const inbox = { isPresent: () => true, enqueue: () => { throw Object.assign(new Error('Two phones are connected: choose one'), { code: 'CHOOSE_PHONE', installs: [{ installId: 'install-aaaa-1111', model: 'SM-S921U' }] }); } };
    const r = await new PhoneInboxContentAdapter({ deviceId: 'phone' }, { inbox, logger: {} }).load('/x', { play: 'plex:1', dispatchId: 'd5' });
    expect(r).toMatchObject({ ok: false, final: true, code: 'CHOOSE_PHONE', installs: [{ model: 'SM-S921U' }] });
  });

  it('takes back a command no one collected', () => {
    const cancelled = [];
    const inbox = { isPresent: () => true, enqueue: () => {}, cancel: (id, commandId) => { cancelled.push([id, commandId]); return true; } };
    expect(new PhoneInboxContentAdapter({ deviceId: 'phone' }, { inbox, logger: {} }).cancelPending('d6')).toBe(true);
    expect(cancelled).toEqual([['phone', 'd6']]);
  });
});
