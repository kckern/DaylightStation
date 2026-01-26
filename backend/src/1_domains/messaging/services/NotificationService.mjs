/**
 * NotificationService - Notification sending and management
 */

import { Notification } from '../entities/Notification.mjs';
import { ValidationError, EntityNotFoundError } from '../../core/errors/index.mjs';

export class NotificationService {
  constructor({ notificationStore, channels = {} }) {
    this.notificationStore = notificationStore;
    this.channels = channels; // Map of channel name to sender adapter
  }

  /**
   * Send a notification
   * @param {Object} data - Notification data
   * @param {number} nowMs - Current time in milliseconds (required)
   * @param {string} timestamp - Formatted timestamp string (required)
   */
  async send(data, nowMs, timestamp) {
    if (typeof nowMs !== 'number') {
      throw new ValidationError('nowMs timestamp required', { code: 'MISSING_TIMESTAMP', field: 'nowMs' });
    }
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    const notification = new Notification({
      id: data.id || this.generateId(nowMs),
      ...data
    });

    // Get channel adapter and send
    const channelAdapter = this.channels[notification.channel];
    if (channelAdapter) {
      await channelAdapter.send(notification);
      notification.markSent(timestamp);
    }

    await this.notificationStore.save(notification);
    return notification;
  }

  /**
   * Get notification by ID
   */
  async getNotification(id) {
    const data = await this.notificationStore.findById(id);
    return data ? Notification.fromJSON(data) : null;
  }

  /**
   * Get notifications for recipient
   */
  async getNotificationsForRecipient(recipient) {
    const notifications = await this.notificationStore.findByRecipient(recipient);
    return notifications.map(n => Notification.fromJSON(n));
  }

  /**
   * Get unread notifications for recipient
   */
  async getUnreadNotifications(recipient) {
    const notifications = await this.getNotificationsForRecipient(recipient);
    return notifications.filter(n => !n.isRead());
  }

  /**
   * Mark notification as read
   * @param {string} id
   * @param {string} timestamp - Formatted timestamp string (required)
   */
  async markRead(id, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    const notification = await this.getNotification(id);
    if (!notification) throw new EntityNotFoundError('Notification', id);

    notification.markRead(timestamp);
    await this.notificationStore.save(notification);
    return notification;
  }

  /**
   * Mark all notifications read for recipient
   * @param {string} recipient
   * @param {string} timestamp - Formatted timestamp string (required)
   */
  async markAllRead(recipient, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    const unread = await this.getUnreadNotifications(recipient);
    for (const notification of unread) {
      notification.markRead(timestamp);
      await this.notificationStore.save(notification);
    }
    return unread.length;
  }

  /**
   * Register a channel adapter
   */
  registerChannel(name, adapter) {
    this.channels[name] = adapter;
  }

  /**
   * Generate a unique notification ID
   * @param {number} nowMs - Current time in milliseconds (required)
   * @returns {string}
   */
  generateId(nowMs) {
    if (typeof nowMs !== 'number') {
      throw new ValidationError('nowMs timestamp required for generateId', { code: 'MISSING_TIMESTAMP', field: 'nowMs' });
    }
    return `notif-${nowMs}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export default NotificationService;
