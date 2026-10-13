/**
 * Email notification adapter — skeleton.
 * Returns not-configured until email transport is implemented.
 */
export class EmailNotificationAdapter {
  get channel() { return 'email'; }

  async send(_intent) {
    return { delivered: false, error: 'not configured' };
  }
}
