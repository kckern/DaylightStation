import { describe, it, expect, vi } from 'vitest';
import { ApprovalNotifier } from "../../../../__app_modules/household/donow/server/adapters/ApprovalNotifier.mjs";
import { DoNowActionHandler } from "../../../../__app_modules/household/donow/server/adapters/DoNowActionHandler.mjs";
import { toHaNotifyData } from '#adapters/notification/PushNotificationAdapter.mjs';
import { NotificationIntent } from '#domains/notification/entities/NotificationIntent.mjs';
import { findPushTextDefects } from '#domains/notification/push/pushText.mjs';

// Article-free, lowercase — the real shape a surface adapter's `label()`
// returns. The notifier is the one place a label starts a sentence.
const record = () => ({ id: 'dnr_test1', surface: 'garage-fitness', label: 'dance video in the garage' });
const setup = () => {
  const notificationService = { send: vi.fn().mockResolvedValue([{ delivered: true, channel: 'push' }]) };
  const notifier = new ApprovalNotifier({ notificationService, notifyService: 'notify.mobile_app_test_phone', recipient: 'parent' });
  return { notificationService, notifier };
};

describe('ApprovalNotifier.notify', () => {
  it('sends one approval push to the approver with both action ids', async () => {
    const { notificationService, notifier } = setup();
    await notifier.notify(record());
    expect(notificationService.send).toHaveBeenCalledTimes(1);
    const [intent] = notificationService.send.mock.calls[0];
    expect(intent).toMatchObject({
      title: 'Approval needed', category: 'approval', urgency: 'critical', recipient: { username: 'parent' },
      presentation: { tag: 'donow-dnr_test1', alertOnce: true, ttlSeconds: 0, importance: 'high', channel: 'DoNow approvals' },
      metadata: { username: 'parent', deliveryRequired: 'push', haNotifyService: 'mobile_app_test_phone' },
    });
    expect(intent.actions).toEqual([
      { id: 'DONOW_APPROVE_dnr_test1', label: 'Approve', requiresUnlock: true },
      { id: 'DONOW_DENY_dnr_test1', label: 'Deny', destructive: true },
    ]);
    expect(intent.body).toMatch(/^Dance video in the garage/);
  });
  it('capitalizes an article-free label at the start of the message', async () => {
    const { notificationService, notifier } = setup();
    await notifier.notify({ ...record(), label: 'garage fitness kiosk' });
    expect(notificationService.send.mock.calls[0][0].body).toBe("Garage fitness kiosk — a grown-up's OK is needed to start.");
  });
  it('gives every send its own dedupe key so a re-send is never swallowed by the cooldown', async () => {
    const { notificationService, notifier } = setup();
    await notifier.notify(record()); await notifier.notify(record());
    const [a, b] = notificationService.send.mock.calls.map(c => c[0].dedupeKey);
    expect(a).toMatch(/^donow:dnr_test1:/);
    expect(a).not.toBe(b);
  });
  it('on Home Assistant it is the same payload the companion automation already keys on, plus the unlock', async () => {
    const { notificationService, notifier } = setup();
    await notifier.notify(record());
    const ha = toHaNotifyData(new NotificationIntent(notificationService.send.mock.calls[0][0]), {});
    expect(ha.data).toMatchObject({ ttl: 0, priority: 'high', tag: 'donow-dnr_test1', alert_once: true, channel: 'DoNow approvals', importance: 'high' });
    expect(ha.data.actions).toEqual([
      { action: 'DONOW_APPROVE_dnr_test1', title: 'Approve', authenticationRequired: true },
      { action: 'DONOW_DENY_dnr_test1', title: 'Deny' },
    ]);
  });
  it('passes the push text standard', async () => {
    const { notificationService, notifier } = setup();
    await notifier.notify(record());
    const { title, body } = notificationService.send.mock.calls[0][0];
    expect(findPushTextDefects(title)).toEqual([]);
    expect(findPushTextDefects(body)).toEqual([]);
  });
  it('requires a notification service and an approver', () => {
    expect(() => new ApprovalNotifier({ recipient: 'p' })).toThrow(/notificationService/);
    expect(() => new ApprovalNotifier({ notificationService: { send() {} } })).toThrow(/recipient/);
  });
});

describe('DoNowActionHandler', () => {
  const approvals = () => ({ approve: vi.fn().mockResolvedValue({ decision: 'dispatched' }), deny: vi.fn().mockResolvedValue({ decision: 'denied' }) });
  it('claims only DoNow approve and deny ids', () => {
    const h = new DoNowActionHandler({ approvals: approvals() });
    expect(h.matches('DONOW_APPROVE_x')).toBe(true);
    expect(h.matches('DONOW_DENY_x')).toBe(true);
    expect(h.matches('SUPERVISION_APPROVE_x')).toBe(false);
  });
  it('approves and denies the request named in the action id', async () => {
    const a = approvals(), h = new DoNowActionHandler({ approvals: a });
    expect(await h.handle({ actionId: 'DONOW_APPROVE_dnr_1' })).toEqual({ ok: true });
    expect(a.approve).toHaveBeenCalledWith({ id: 'dnr_1' });
    expect(await h.handle({ actionId: 'DONOW_DENY_dnr_1' })).toEqual({ ok: true });
    expect(a.deny).toHaveBeenCalledWith({ id: 'dnr_1' });
  });
  it('an expired request is ALREADY_DECIDED', async () => {
    const a = approvals(); a.approve.mockResolvedValue({ decision: 'expired' });
    expect(await new DoNowActionHandler({ approvals: a }).handle({ actionId: 'DONOW_APPROVE_dnr_1' })).toEqual({ ok: false, code: 'ALREADY_DECIDED' });
  });
});
