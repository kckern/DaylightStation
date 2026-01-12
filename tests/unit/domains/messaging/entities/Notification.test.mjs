// tests/unit/domains/messaging/entities/Notification.test.mjs
import { Notification } from '../../../../../backend/src/1_domains/messaging/entities/Notification.mjs';

describe('Notification', () => {
  let notification;

  beforeEach(() => {
    notification = new Notification({
      id: 'notif-001',
      recipient: 'john',
      channel: 'telegram',
      title: 'Alert',
      body: 'Something happened',
      priority: 'normal'
    });
  });

  describe('constructor', () => {
    test('creates notification with properties', () => {
      expect(notification.id).toBe('notif-001');
      expect(notification.channel).toBe('telegram');
    });

    test('defaults sentAt and readAt to null', () => {
      expect(notification.sentAt).toBeNull();
      expect(notification.readAt).toBeNull();
    });
  });

  describe('isSent/isRead', () => {
    test('isSent returns false when not sent', () => {
      expect(notification.isSent()).toBe(false);
    });

    test('isRead returns false when not read', () => {
      expect(notification.isRead()).toBe(false);
    });
  });

  describe('markSent', () => {
    test('sets sentAt timestamp', () => {
      notification.markSent('2026-01-11T10:00:00Z');
      expect(notification.sentAt).toBe('2026-01-11T10:00:00Z');
      expect(notification.isSent()).toBe(true);
    });
  });

  describe('markRead', () => {
    test('sets readAt timestamp', () => {
      notification.markRead('2026-01-11T11:00:00Z');
      expect(notification.readAt).toBe('2026-01-11T11:00:00Z');
      expect(notification.isRead()).toBe(true);
    });
  });

  describe('isHighPriority', () => {
    test('returns true for high priority', () => {
      notification.priority = 'high';
      expect(notification.isHighPriority()).toBe(true);
    });

    test('returns true for urgent', () => {
      notification.priority = 'urgent';
      expect(notification.isHighPriority()).toBe(true);
    });

    test('returns false for normal', () => {
      expect(notification.isHighPriority()).toBe(false);
    });
  });

  describe('toJSON/fromJSON', () => {
    test('round-trips notification data', () => {
      notification.markSent();
      const json = notification.toJSON();
      const restored = Notification.fromJSON(json);
      expect(restored.id).toBe(notification.id);
      expect(restored.sentAt).toBe(notification.sentAt);
    });
  });
});
