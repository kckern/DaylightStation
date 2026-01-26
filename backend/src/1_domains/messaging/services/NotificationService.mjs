/**
 * NotificationService - Notification sending and management
 */

import { Notification } from '../entities/Notification.mjs';
import { nowTs24 } from '../../../0_infrastructure/utils/index.mjs';

export class NotificationService {
  constructor({ notificationStore, channels = {} }) {
    this.notificationStore = notificationStore;
    this.channels = channels; // Map of channel name to sender adapter
  }

  /**
   * Send a notification
   */
  async send(data) {
    const notification = new Notification({
      id: data.id || this.generateId(),
      ...data
    });

    // Get channel adapter and send
    const channelAdapter = this.channels[notification.channel];
    if (channelAdapter) {
      await channelAdapter.send(notification);
      notification.markSent(nowTs24());
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
   */
  async markRead(id) {
    const notification = await this.getNotification(id);
    if (!notification) throw new Error(`Notification not found: ${id}`);

    notification.markRead(nowTs24());
    await this.notificationStore.save(notification);
    return notification;
  }

  /**
   * Mark all notifications read for recipient
   */
  async markAllRead(recipient) {
    const unread = await this.getUnreadNotifications(recipient);
    const timestamp = nowTs24();
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

  generateId() {
    return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export default NotificationService;
