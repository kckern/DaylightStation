import { describe, it, expect, vi } from 'vitest';
import { CompositePushChannel } from './CompositePushChannel.mjs';

const intent = { id: 'n1', recipient: { username: 'u' }, category: 'approval' };
const clock = { now: () => new Date(100_000) };
const registry = phone => ({ currentFor: () => phone });
const channel = result => ({ send: vi.fn().mockResolvedValue(result) });

describe('CompositePushChannel', () => {
  it('is the push channel', () => {
    expect(new CompositePushChannel({}).channel).toBe('push');
  });
  it('uses only the Android app when the phone is fresh and acks', async () => {
    const android = channel({ delivered: true, channelId: 'android-phone' }), ha = channel({ delivered: true });
    const c = new CompositePushChannel({ android, ha, registry: registry({ connectionId: 'c1', lastSeenMs: 99_000 }), clock });
    expect(await c.send(intent)).toEqual({ delivered: true, channelId: 'android-phone', transport: 'android', fellBack: false });
    expect(ha.send).not.toHaveBeenCalled();
  });
  it('falls back to Home Assistant when the phone does not ack', async () => {
    const android = channel({ delivered: false, error: 'ack timeout' }), ha = channel({ delivered: true, channelId: 'ha-x' });
    const logger = { info: vi.fn() };
    const c = new CompositePushChannel({ android, ha, registry: registry({ connectionId: 'c1', lastSeenMs: 99_000 }), clock, logger });
    expect(await c.send(intent)).toEqual({ delivered: true, channelId: 'ha-x', transport: 'ha', fellBack: true });
    expect(logger.info).toHaveBeenCalledWith('notification.push.route', expect.objectContaining({ transport: 'ha', fellBack: true }));
  });
  it('uses only Home Assistant when the phone is stale', async () => {
    const android = channel({ delivered: true }), ha = channel({ delivered: true });
    const c = new CompositePushChannel({ android, ha, registry: registry({ connectionId: 'c1', lastSeenMs: 1 }), clock });
    expect((await c.send(intent)).transport).toBe('ha');
    expect(android.send).not.toHaveBeenCalled();
  });
  it('reports not delivered when both fail', async () => {
    const c = new CompositePushChannel({ android: channel({ delivered: false }), ha: channel({ delivered: false, error: 'ha down' }),
      registry: registry({ connectionId: 'c1', lastSeenMs: 99_000 }), clock });
    expect(await c.send(intent)).toMatchObject({ delivered: false, error: 'ha down' });
  });
  it('passes an accepted-but-unconfirmed HA result through', async () => {
    const c = new CompositePushChannel({ android: channel({ delivered: false }), ha: channel({ accepted: true, delivered: null }), registry: registry(null), clock });
    expect(await c.send(intent)).toMatchObject({ accepted: true, delivered: null, transport: 'ha' });
  });
});

describe('CompositePushChannel approvals', () => {
  it('sends a push with Approve/Deny through Home Assistant only, even with a fresh phone', async () => {
    const { NotificationIntent } = await import('#domains/notification/entities/NotificationIntent.mjs');
    const withButtons = new NotificationIntent({ id: 'n2', title: 'T', body: 'B', category: 'approval', urgency: 'critical', recipient: { username: 'u' },
      actions: [{ id: 'DONOW_APPROVE_1', label: 'Approve' }] });
    const android = channel({ delivered: true }), ha = channel({ delivered: true });
    const c = new CompositePushChannel({ android, ha, registry: registry({ connectionId: 'c1', lastSeenMs: 99_000 }), clock });
    expect((await c.send(withButtons)).transport).toBe('ha');
    expect(android.send).not.toHaveBeenCalled();
  });
  it('an open-page action alone does not keep a push off the app', async () => {
    const { NotificationIntent } = await import('#domains/notification/entities/NotificationIntent.mjs');
    const openOnly = new NotificationIntent({ id: 'n3', title: 'T', body: 'B', category: 'school', urgency: 'normal', recipient: { username: 'u' },
      actions: [{ id: 'OPEN', label: 'Open', kind: 'open', deepLink: '/school' }] });
    const android = channel({ delivered: true }), ha = channel({ delivered: true });
    const c = new CompositePushChannel({ android, ha, registry: registry({ connectionId: 'c1', lastSeenMs: 99_000 }), clock });
    expect((await c.send(openOnly)).transport).toBe('android');
  });
});
