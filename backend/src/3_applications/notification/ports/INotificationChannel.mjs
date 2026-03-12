/**
 * Port interface for notification channel adapters.
 * Each adapter delivers notifications via a specific transport (telegram, email, push, app).
 */
export class INotificationChannel {
  /**
   * @returns {string} Channel identifier (e.g., 'telegram', 'app')
   */
  get channel() {
    throw new Error('INotificationChannel.channel must be implemented');
  }

  /**
   * Send a notification via this channel.
   * @param {import('#domains/notification/entities/NotificationIntent.mjs').NotificationIntent} intent
   * @returns {Promise<{delivered: boolean, channelId?: string, error?: string}>}
   */
  async send(intent) {
    throw new Error('INotificationChannel.send must be implemented');
  }
}
