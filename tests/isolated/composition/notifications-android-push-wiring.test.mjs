import { describe, it, expect, vi } from 'vitest';
import { bootstrapNotifications } from '#composition/modules/notifications.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function fakeBus() {
  const msg = [], disc = [], sent = [];
  return {
    sent,
    publish() {}, broadcast() {},
    onClientMessage: cb => msg.push(cb),
    onClientDisconnection: cb => disc.push(cb),
    message: (id, m) => msg.forEach(cb => cb(id, m)),
    sendToClient(connectionId, m) {
      sent.push({ connectionId, m });
      if (m.type === 'push.notification') setTimeout(() => msg.forEach(cb => cb(connectionId, { type: 'push.ack', id: m.notification.id })), 5);
      return true;
    },
  };
}

describe('bootstrapNotifications Android push wiring', () => {
  it('a phone that said hello gets the push, and Home Assistant is not called', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'notif-'));
    try {
      const eventBus = fakeBus();
      const callService = vi.fn().mockResolvedValue({});
      const cfg = { quiet_hours: { enabled: false }, cooldowns: {} };
      const { notificationService } = bootstrapNotifications({
        eventBus, haGateway: { callService }, resolveNotifyService: () => 'mobile_app_test',
        configService: { getHouseholdAppConfig: () => cfg, reloadHouseholdAppConfig: () => cfg },
        dataPath: dir, logger: { debug() {}, warn() {}, info() {}, child: () => ({ debug() {}, warn() {}, info() {} }) },
      });
      eventBus.message('c1', { type: 'push.hello', username: 'u', deviceId: 'phone' });
      const results = await notificationService.send({ title: 'Approval needed', body: 'b', category: 'approval', urgency: 'high', metadata: { username: 'u', deliveryRequired: 'push' } });
      expect(results[0]).toMatchObject({ delivered: true, channel: 'push', transport: 'android' });
      expect(callService).not.toHaveBeenCalled();
      expect(eventBus.sent[0]).toMatchObject({ connectionId: 'c1', m: { type: 'push.notification' } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('without a phone the push goes to Home Assistant', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'notif-'));
    try {
      const callService = vi.fn().mockResolvedValue({});
      const cfg = { quiet_hours: { enabled: false }, cooldowns: {} };
      const { notificationService } = bootstrapNotifications({
        eventBus: fakeBus(), haGateway: { callService }, resolveNotifyService: () => 'mobile_app_test',
        configService: { getHouseholdAppConfig: () => cfg, reloadHouseholdAppConfig: () => cfg },
        dataPath: dir, logger: { debug() {}, warn() {}, info() {}, child: () => ({ debug() {}, warn() {}, info() {} }) },
      });
      const results = await notificationService.send({ title: 'T', body: 'b', category: 'approval', urgency: 'high', metadata: { username: 'u', deliveryRequired: 'push' } });
      expect(results[0]).toMatchObject({ channel: 'push', transport: 'ha' });
      expect(callService).toHaveBeenCalledWith('notify', 'mobile_app_test', { title: 'T', message: 'b' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('bootstrapNotifications action presses', () => {
  it('exposes a registry that apps register action handlers into', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'notif-'));
    try {
      const cfg = { quiet_hours: { enabled: false }, cooldowns: {} };
      const { notificationActions } = bootstrapNotifications({
        eventBus: fakeBus(), configService: { getHouseholdAppConfig: () => cfg, reloadHouseholdAppConfig: () => cfg },
        dataPath: dir, logger: { debug() {}, warn() {}, info() {}, child: () => ({ debug() {}, warn() {}, info() {} }) },
      });
      const press = { notificationId: 'n1', actionId: 'DONOW_APPROVE_7', reply: null, username: 'u' };
      expect(await notificationActions.execute(press)).toEqual({ ok: false, code: 'ACTION_UNKNOWN' });
      notificationActions.register({ matches: id => id.startsWith('DONOW_'), handle: async () => ({ ok: true }) });
      expect(await notificationActions.execute(press)).toEqual({ ok: true });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

import { createNotifyServiceRecipientResolver } from '#composition/modules/notifications.mjs';
describe('createNotifyServiceRecipientResolver', () => {
  const resolve = createNotifyServiceRecipientResolver({
    listUsernames: () => ['a', 'b'],
    profileNotifyService: u => (u === 'b' ? 'mobile_app_b_phone' : null),
    headOfHousehold: () => 'head',
  });
  it('finds the user whose profile names the target, with or without the notify. prefix', () => {
    expect(resolve('notify.mobile_app_b_phone')).toBe('b');
    expect(resolve('mobile_app_b_phone')).toBe('b');
  });
  it('falls back to the head of household', () => {
    expect(resolve('mobile_app_other')).toBe('head');
  });
  it('is null for no target', () => {
    expect(resolve(null)).toBeNull();
  });
});

import { createPushSender } from '#composition/modules/notifications.mjs';
describe('createPushSender', () => {
  it('turns a {title, message, data} push into one required push intent', async () => {
    const send = vi.fn().mockResolvedValue([{ delivered: true }]);
    const push = createPushSender({ notificationService: { send }, category: 'household_alert', urgency: 'high', source: 'harvester-health', recipient: () => 'head', haNotifyService: () => 'mobile_app_x' });
    await push({ title: 'T', message: 'M', data: { tag: 'h-1' } });
    const [intent] = send.mock.calls[0];
    expect(intent).toMatchObject({ title: 'T', body: 'M', category: 'household_alert', urgency: 'high', recipient: { username: 'head' },
      metadata: { username: 'head', deliveryRequired: 'push', pushData: { tag: 'h-1' }, haNotifyService: 'mobile_app_x', source: 'harvester-health' } });
    expect(intent.dedupeKey).toMatch(/^harvester-health:/);
  });
  it('omits the HA target when none is configured', async () => {
    const send = vi.fn().mockResolvedValue([]);
    await createPushSender({ notificationService: { send }, category: 'household_alert', source: 's', recipient: () => 'head' })({ title: 'T', message: 'M' });
    expect(send.mock.calls[0][0].metadata).not.toHaveProperty('haNotifyService');
  });
  it('is a no-op that says so when there is no notification service', async () => {
    expect(await createPushSender({ notificationService: null, category: 'household_alert', source: 's' })({ title: 'T', message: 'M' })).toEqual({ ok: false, results: [] });
  });
});

describe('createPushSender per-call target', () => {
  it('a per-call haNotifyService wins over the configured one', async () => {
    const send = vi.fn().mockResolvedValue([]);
    await createPushSender({ notificationService: { send }, category: 'household_alert', source: 's', recipient: () => 'head', haNotifyService: () => 'a' })({ title: 'T', message: 'M', haNotifyService: 'notify.mobile_app_tv_owner' });
    expect(send.mock.calls[0][0].metadata.haNotifyService).toBe('mobile_app_tv_owner');
  });
});

describe('review fixes: governed sends', () => {
  it('a createPushSender alert is delivered inside quiet hours and reports ok', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'notif-'));
    try {
      const callService = vi.fn().mockResolvedValue({});
      const cfg = { quiet_hours: { enabled: true, start: '00:00', end: '23:59' }, cooldowns: {} };
      const { notificationService } = bootstrapNotifications({
        eventBus: fakeBus(), haGateway: { callService }, resolveNotifyService: () => null,
        configService: { getHouseholdAppConfig: () => cfg, reloadHouseholdAppConfig: () => cfg, getHouseholdTimezone: () => 'UTC' },
        dataPath: dir, clock: { now: () => new Date('2026-11-21T12:00:00Z') },
        logger: { debug() {}, warn() {}, info() {}, child: () => ({ debug() {}, warn() {}, info() {} }) },
      });
      const push = createPushSender({ notificationService, category: 'household_alert', source: 'tv', recipient: () => 'head' });
      const res = await push({ title: "📺 TV didn't turn on", message: 'm', haNotifyService: 'mobile_app_x' });
      expect(res.ok).toBe(true);
      expect(callService).toHaveBeenCalledTimes(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('reports ok:false when nothing delivered', async () => {
    const push = createPushSender({ notificationService: { send: async () => [{ delivered: false, channel: 'push' }] }, category: 'household_alert', source: 's', recipient: () => 'h' });
    expect(await push({ title: 'T', message: 'M' })).toMatchObject({ ok: false });
  });
});
