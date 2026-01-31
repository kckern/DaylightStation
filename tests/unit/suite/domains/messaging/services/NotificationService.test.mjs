// tests/unit/domains/messaging/services/NotificationService.test.mjs
import { jest } from '@jest/globals';
import { NotificationService } from '#domains/messaging/services/NotificationService.mjs';

describe('NotificationService', () => {
  let service;
  let mockStore;
  let mockChannel;

  beforeEach(() => {
    mockStore = {
      save: jest.fn(),
      findById: jest.fn(),
      findByRecipient: jest.fn()
    };
    mockChannel = {
      send: jest.fn()
    };
    service = new NotificationService({
      notificationStore: mockStore,
      channels: { telegram: mockChannel }
    });
  });

  describe('send', () => {
    test('sends and saves notification', async () => {
      const nowMs = Date.now();
      const notification = await service.send({
        recipient: 'john',
        channel: 'telegram',
        title: 'Test',
        body: 'Message'
      }, nowMs);

      expect(mockChannel.send).toHaveBeenCalled();
      expect(mockStore.save).toHaveBeenCalled();
      expect(notification.isSent()).toBe(true);
    });

    test('saves without sending if no channel adapter', async () => {
      const nowMs = Date.now();
      const notification = await service.send({
        recipient: 'john',
        channel: 'email',
        title: 'Test',
        body: 'Message'
      }, nowMs);

      expect(notification.isSent()).toBe(false);
      expect(mockStore.save).toHaveBeenCalled();
    });

    test('throws if nowMs not provided', async () => {
      await expect(service.send({
        recipient: 'john',
        channel: 'telegram',
        title: 'Test',
        body: 'Message'
      })).rejects.toThrow('nowMs timestamp required');
    });
  });

  describe('getNotification', () => {
    test('returns notification by ID', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'n1',
        recipient: 'john',
        channel: 'telegram',
        title: 'Test',
        body: 'Message'
      });

      const notification = await service.getNotification('n1');
      expect(notification.id).toBe('n1');
    });
  });

  describe('getUnreadNotifications', () => {
    test('returns only unread', async () => {
      mockStore.findByRecipient.mockResolvedValue([
        { id: 'n1', recipient: 'john', channel: 'telegram', title: 'T', body: 'B', readAt: null },
        { id: 'n2', recipient: 'john', channel: 'telegram', title: 'T', body: 'B', readAt: '2026-01-11' }
      ]);

      const unread = await service.getUnreadNotifications('john');
      expect(unread).toHaveLength(1);
      expect(unread[0].id).toBe('n1');
    });
  });

  describe('markRead', () => {
    test('marks notification as read', async () => {
      mockStore.findById.mockResolvedValue({
        id: 'n1',
        recipient: 'john',
        channel: 'telegram',
        title: 'Test',
        body: 'Message',
        readAt: null
      });

      const notification = await service.markRead('n1');
      expect(notification.isRead()).toBe(true);
      expect(mockStore.save).toHaveBeenCalled();
    });
  });

  describe('registerChannel', () => {
    test('adds channel adapter', () => {
      const emailAdapter = { send: jest.fn() };
      service.registerChannel('email', emailAdapter);
      expect(service.channels.email).toBe(emailAdapter);
    });
  });
});
