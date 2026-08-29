export class NotificationOperations {
  constructor({ notifications = null, preferences = null }) {
    this.notifications = notifications;
    this.preferences = preferences;
  }
  async readPreferences(username) {
    return (await this.preferences?.load(username))?.configuration || {};
  }
  async savePreferences(username, configuration) {
    await this.preferences?.save(username, configuration);
  }
  pending() { return this.notifications?.getPending() || []; }
  dismiss(index) { return this.notifications?.dismiss(index) || false; }
}
