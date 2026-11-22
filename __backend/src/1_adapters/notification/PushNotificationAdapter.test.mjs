import { describe, it, expect } from 'vitest';
import { toHaNotifyData } from './PushNotificationAdapter.mjs';
import { NotificationIntent } from '#domains/notification/entities/NotificationIntent.mjs';

const publicUrl = p => `https://household.example${p}`;

describe('toHaNotifyData', () => {
  it('reproduces the DoNow approval payload, plus the unlock requirement', () => {
    const intent = new NotificationIntent({
      title: 'Approval needed', body: 'Garage kiosk — a grown-up\'s OK is needed to start.', category: 'approval', urgency: 'high',
      presentation: { tag: 'donow-7', alertOnce: true, ttlSeconds: 0, importance: 'high', channel: 'DoNow approvals' },
      actions: [
        { id: 'DONOW_APPROVE_7', label: 'Approve', requiresUnlock: true },
        { id: 'DONOW_DENY_7', label: 'Deny', destructive: true },
      ],
    });
    expect(toHaNotifyData(intent, { publicUrl })).toEqual({
      title: 'Approval needed',
      message: 'Garage kiosk — a grown-up\'s OK is needed to start.',
      data: {
        ttl: 0, priority: 'high', tag: 'donow-7', alert_once: true, channel: 'DoNow approvals', importance: 'high',
        actions: [
          { action: 'DONOW_APPROVE_7', title: 'Approve', authenticationRequired: true },
          { action: 'DONOW_DENY_7', title: 'Deny' },
        ],
      },
    });
  });
  it('makes image and tap target absolute and maps reply and open actions', () => {
    const intent = new NotificationIntent({
      title: 'T', body: 'B', category: 'school', urgency: 'normal',
      presentation: { imageUrl: '/api/v1/img/a.png', deepLink: '/school' },
      actions: [{ id: 'R1', label: 'Reply', kind: 'reply' }, { id: 'O1', label: 'Open', kind: 'open', deepLink: '/school/teacher' }],
    });
    expect(toHaNotifyData(intent, { publicUrl }).data).toEqual({
      image: 'https://household.example/api/v1/img/a.png',
      clickAction: 'https://household.example/school',
      actions: [
        { action: 'R1', title: 'Reply', behavior: 'textInput' },
        { action: 'URI', title: 'Open', uri: 'https://household.example/school/teacher' },
      ],
    });
  });
  it('sends no data block for a plain notification', () => {
    expect(toHaNotifyData({ title: 'T', body: 'B', metadata: {} }, { publicUrl })).toEqual({ title: 'T', message: 'B' });
  });
  it('keeps legacy pushData keys the model does not hold', () => {
    expect(toHaNotifyData({ title: 'T', body: 'B', metadata: { pushData: { tag: 'x', visibility: 'public' } } }, { publicUrl }).data)
      .toEqual({ tag: 'x', visibility: 'public' });
  });
  it('drops an image when there is no public base url', () => {
    const intent = new NotificationIntent({ title: 'T', body: 'B', category: 'school', urgency: 'normal', presentation: { imageUrl: '/x.png' } });
    expect(toHaNotifyData(intent, {})).toEqual({ title: 'T', message: 'B' });
  });
});

import { vi } from 'vitest';
import { PushNotificationAdapter } from './PushNotificationAdapter.mjs';
describe('PushNotificationAdapter HA target', () => {
  it('uses a producer-configured HA notify service over the profile lookup', async () => {
    const callService = vi.fn().mockResolvedValue({});
    const adapter = new PushNotificationAdapter({ haGateway: { callService }, resolveNotifyService: () => null });
    const r = await adapter.send({ title: 'T', body: 'B', recipient: { username: 'p' }, metadata: { haNotifyService: 'mobile_app_test_phone' } });
    expect(r.delivered).toBe(true);
    expect(callService).toHaveBeenCalledWith('notify', 'mobile_app_test_phone', { title: 'T', message: 'B' });
  });
});

describe('toHaNotifyData legacy passthrough', () => {
  it('sends a legacy pushData block byte-identical: no added priority, no rewritten clickAction', () => {
    const legacy = { tag: 'h-1', importance: 'high', channel: 'Household', clickAction: '/admin/harvest' };
    expect(toHaNotifyData({ title: 'T', body: 'B', metadata: { pushData: legacy } }, { publicUrl })).toEqual({ title: 'T', message: 'B', data: legacy });
  });
});
