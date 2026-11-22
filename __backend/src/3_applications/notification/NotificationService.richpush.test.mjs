import { describe, it, expect } from 'vitest';
import { NotificationService } from './NotificationService.mjs';

const plain = { title: 'T', body: 'B', category: 'approval', urgency: 'high', metadata: { username: 'u', deliveryRequired: 'push' } };

describe('NotificationService rich push', () => {
  it('gives every notification an id before a channel sees it', async () => {
    const seen = [];
    const svc = new NotificationService({ adapters: [{ channel: 'push', send: async i => { seen.push(i.id); return { delivered: true }; } }], makeId: () => 'id-1' });
    await svc.send(plain);
    expect(seen).toEqual(['id-1']);
  });
  it('keeps a producer id', async () => {
    const seen = [];
    const svc = new NotificationService({ adapters: [{ channel: 'push', send: async i => { seen.push(i.id); return { delivered: true }; } }], makeId: () => 'id-1' });
    await svc.send({ ...plain, id: 'mine' });
    expect(seen).toEqual(['mine']);
  });
  it('holds an undelivered push in the pending list when every transport fails', async () => {
    const svc = new NotificationService({ adapters: [{ channel: 'push', send: async () => ({ delivered: false, error: 'ha down' }) }], makeId: () => 'id-1' });
    const results = await svc.send(plain);
    expect(results).toEqual([expect.objectContaining({ delivered: false, channel: 'push' })]);
    expect(svc.getPending()).toHaveLength(1);
  });
});

describe('NotificationService default recipient for house alerts', () => {
  it('addresses a household_alert with no username to the default recipient and keeps its presentation', async () => {
    const seen = [];
    const svc = new NotificationService({
      adapters: [{ channel: 'push', send: async i => { seen.push(i); return { delivered: true }; } }],
      makeId: () => 'id-1', resolveDefaultRecipient: () => 'head',
    });
    await svc.send({ title: 'TV did not wake', body: 'B', category: 'household_alert', urgency: 'high',
      presentation: { tag: 'tv-wake', importance: 'high' }, metadata: { deliveryRequired: 'push' } });
    expect(seen[0].recipient).toEqual({ username: 'head' });
    expect(seen[0].presentation.tag).toBe('tv-wake');
    expect(seen[0].id).toBe('id-1');
  });
});

describe('NotificationService pending list', () => {
  it('keeps at most 100 undelivered notifications', async () => {
    const svc = new NotificationService({ adapters: [{ channel: 'push', send: async () => ({ delivered: false }) }] });
    for (let i = 0; i < 105; i++) await svc.send({ ...plain, dedupeKey: `k${i}` });
    expect(svc.getPending()).toHaveLength(100);
  });
});
