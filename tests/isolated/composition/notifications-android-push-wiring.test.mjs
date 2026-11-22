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
