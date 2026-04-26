import { describe, it, expect } from 'vitest';
import { NotificationChannel } from '#domains/notification/value-objects/NotificationChannel.mjs';
import { NotificationUrgency } from '#domains/notification/value-objects/NotificationUrgency.mjs';
import { NotificationCategory } from '#domains/notification/value-objects/NotificationCategory.mjs';

describe('NotificationChannel', () => {
  it('defines valid channels', () => {
    expect(NotificationChannel.TELEGRAM).toBe('telegram');
    expect(NotificationChannel.EMAIL).toBe('email');
    expect(NotificationChannel.PUSH).toBe('push');
    expect(NotificationChannel.APP).toBe('app');
  });

  it('validates known channels', () => {
    expect(NotificationChannel.isValid('telegram')).toBe(true);
    expect(NotificationChannel.isValid('app')).toBe(true);
    expect(NotificationChannel.isValid('carrier_pigeon')).toBe(false);
  });

  it('returns all channels', () => {
    expect(NotificationChannel.values()).toEqual(['telegram', 'email', 'push', 'app']);
  });
});

describe('NotificationUrgency', () => {
  it('defines urgency levels', () => {
    expect(NotificationUrgency.LOW).toBe('low');
    expect(NotificationUrgency.NORMAL).toBe('normal');
    expect(NotificationUrgency.HIGH).toBe('high');
    expect(NotificationUrgency.CRITICAL).toBe('critical');
  });

  it('validates known urgencies', () => {
    expect(NotificationUrgency.isValid('high')).toBe(true);
    expect(NotificationUrgency.isValid('panic')).toBe(false);
  });

  it('returns all urgencies', () => {
    expect(NotificationUrgency.values()).toEqual(['low', 'normal', 'high', 'critical']);
  });
});

describe('NotificationCategory', () => {
  it('defines categories', () => {
    expect(NotificationCategory.CEREMONY).toBe('ceremony');
    expect(NotificationCategory.DRIFT_ALERT).toBe('drift_alert');
    expect(NotificationCategory.GOAL_UPDATE).toBe('goal_update');
    expect(NotificationCategory.SYSTEM).toBe('system');
  });

  it('validates known categories', () => {
    expect(NotificationCategory.isValid('ceremony')).toBe(true);
    expect(NotificationCategory.isValid('random')).toBe(false);
  });

  it('returns all categories', () => {
    expect(NotificationCategory.values()).toEqual(['ceremony', 'drift_alert', 'goal_update', 'system']);
  });
});
