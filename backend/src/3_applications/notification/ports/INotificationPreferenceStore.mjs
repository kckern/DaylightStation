/**
 * Port interface for loading/saving notification preferences.
 */
export class INotificationPreferenceStore {
  /**
   * Load preferences for a user.
   * @param {string} username
   * @returns {Promise<import('#domains/notification/entities/NotificationPreference.mjs').NotificationPreference>}
   */
  async load(username) {
    throw new Error('INotificationPreferenceStore.load must be implemented');
  }

  /**
   * Save preferences for a user.
   * @param {string} username
   * @param {import('#domains/notification/entities/NotificationPreference.mjs').NotificationPreference} preference
   */
  async save(username, preference) {
    throw new Error('INotificationPreferenceStore.save must be implemented');
  }
}
