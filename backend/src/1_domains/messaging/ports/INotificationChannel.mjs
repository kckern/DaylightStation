/**
 * INotificationChannel - Port interface for notification channels
 */

export const INotificationChannel = {
  /**
   * Send a notification through this channel
   * @param {Notification} notification - Notification to send
   * @returns {Promise<void>}
   */
  async send(notification) {}
};

export default INotificationChannel;
