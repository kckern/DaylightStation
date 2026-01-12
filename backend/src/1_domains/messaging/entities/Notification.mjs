/**
 * Notification Entity - Represents a notification to be sent
 */

export const NOTIFICATION_CHANNELS = ['telegram', 'email', 'push', 'sms'];
export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export class Notification {
  constructor({
    id,
    recipient,
    channel,
    title,
    body,
    priority = 'normal',
    sentAt = null,
    readAt = null,
    metadata = {}
  }) {
    this.id = id;
    this.recipient = recipient;
    this.channel = channel;
    this.title = title;
    this.body = body;
    this.priority = priority;
    this.sentAt = sentAt;
    this.readAt = readAt;
    this.metadata = metadata;
  }

  /**
   * Check if notification is sent
   */
  isSent() {
    return this.sentAt !== null;
  }

  /**
   * Check if notification is read
   */
  isRead() {
    return this.readAt !== null;
  }

  /**
   * Mark as sent
   */
  markSent(timestamp = new Date().toISOString()) {
    this.sentAt = timestamp;
  }

  /**
   * Mark as read
   */
  markRead(timestamp = new Date().toISOString()) {
    this.readAt = timestamp;
  }

  /**
   * Check if high priority
   */
  isHighPriority() {
    return ['high', 'urgent'].includes(this.priority);
  }

  toJSON() {
    return {
      id: this.id,
      recipient: this.recipient,
      channel: this.channel,
      title: this.title,
      body: this.body,
      priority: this.priority,
      sentAt: this.sentAt,
      readAt: this.readAt,
      metadata: this.metadata
    };
  }

  static fromJSON(data) {
    return new Notification(data);
  }
}

export default Notification;
