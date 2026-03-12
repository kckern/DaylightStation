/**
 * Push notification adapter — skeleton.
 * Returns not-configured until push transport is implemented.
 */
export class PushNotificationAdapter {
  get channel() { return 'push'; }

  async send(_intent) {
    return { delivered: false, error: 'not configured' };
  }
}
