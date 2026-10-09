/** Ordered user projection shared by household-facing applications. */
export class HouseholdUserProjection {
  #directory;
  constructor({householdDirectory}) { this.#directory=householdDirectory; }
  /**
   * Resolve display name for a user
   * @param {string} userId
   * @returns {string} Display name
   */
  resolveDisplayName(userId) {
    if (!userId) return 'Unknown';
    const profile = this.#directory.userProfile?.(userId);
    return profile?.group_label
      || profile?.display_name
      || profile?.name
      || userId.charAt(0).toUpperCase() + userId.slice(1);
  }

  /**
   * Get household users from config
   * @param {string} householdId
   * @returns {Array<{id: string, name: string, group_label: string|null}>}
   */
  getHouseholdUsers(householdId) {
    const usernames = this.#directory.userIds?.(householdId) || [];
    return usernames.map(username => {
      const profile = this.#directory.userProfile?.(username);
      return {
        id: username,
        name: profile?.display_name || profile?.name ||
          username.charAt(0).toUpperCase() + username.slice(1),
        group_label: profile?.group_label || null
      };
    });
  }
}
