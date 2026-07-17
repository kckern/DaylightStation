// tests/isolated/domain/notification/notification-policy.test.mjs
import { describe, it, expect } from 'vitest';
import { NotificationPolicy } from '#domains/notification/services/NotificationPolicy.mjs';
import { QuietHours } from '#domains/notification/value-objects/QuietHours.mjs';

const policy = new NotificationPolicy();
const at = (h) => new Date(2026, 6, 17, h, 0, 0);
const quiet = new QuietHours({ enabled: true, start: '21:00', end: '07:00' });
const HOUR = 3600_000;

describe('NotificationPolicy.evaluate', () => {
  it('sends when no prior send and outside quiet hours', () => {
    expect(policy.evaluate({ intent: { urgency: 'normal' }, lastSentAt: null, now: at(12), quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: true, reason: 'ok' });
  });
  it('suppresses within the cooldown window', () => {
    const now = at(12);
    expect(policy.evaluate({ intent: { urgency: 'normal' }, lastSentAt: now.getTime() - 10 * 60_000, now, quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: false, reason: 'cooldown' });
  });
  it('sends once the cooldown has elapsed', () => {
    const now = at(12);
    expect(policy.evaluate({ intent: { urgency: 'normal' }, lastSentAt: now.getTime() - 2 * HOUR, now, quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: true, reason: 'ok' });
  });
  it('suppresses a non-critical notification during quiet hours', () => {
    expect(policy.evaluate({ intent: { urgency: 'high' }, lastSentAt: null, now: at(23), quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: false, reason: 'quiet_hours' });
  });
  it('lets a critical notification through quiet hours (but still respects cooldown)', () => {
    expect(policy.evaluate({ intent: { urgency: 'critical' }, lastSentAt: null, now: at(23), quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: true, reason: 'ok' });
    const now = at(23);
    expect(policy.evaluate({ intent: { urgency: 'critical' }, lastSentAt: now.getTime() - 60_000, now, quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: false, reason: 'cooldown' });
  });
  it('quiet-hours reason wins over an also-active cooldown', () => {
    const now = at(23);
    expect(policy.evaluate({ intent: { urgency: 'normal' }, lastSentAt: now.getTime() - 60_000, now, quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: false, reason: 'quiet_hours' });
  });
});
