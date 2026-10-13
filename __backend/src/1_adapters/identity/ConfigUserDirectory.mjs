/**
 * UserService - User Profile and Resolution
 *
 * Handles:
 * - Loading user profiles from data/users/{id}/profile.yml
 * - Platform identity resolution
 */

export class ConfigUserDirectory {
  #configService = null;
  #logger;

  constructor(cfgService, { logger = console } = {}) {
    if (!cfgService) throw new TypeError('ConfigUserDirectory requires configService');
    this.#configService = cfgService;
    this.#logger = logger;
  }

  /**
   * Get a user profile by username
   * @param {string} username
   * @returns {object|null}
   */
  getProfile(username) {
    return this.#configService.getUserProfile(username);
  }

  /**
   * Get all user profiles
   * @returns {Map<string, object>}
   */
  getAllProfiles() {
    return this.#configService.getAllUserProfiles();
  }

  /**
   * The household roster, in household order — the SINGLE source of truth for
   * both who is in the household and what order they appear in.
   *
   * The order lives in `household.yml → users` because it is a fact about the
   * family, not about any one app. Every picker in the system must agree: a
   * child learns where their own face is and reaches for that position, so two
   * apps disagreeing is not a cosmetic difference, it is a misclick.
   *
   * Apps that serve a SUBSET (fitness, say) filter this list rather than
   * restating it — filtering preserves the household order for free, whereas a
   * second list silently redefines it. That is exactly how Piano and School
   * drifted: Piano restated the roster as `piano.yml → users.primary` and
   * School re-derived it alphabetically from display names it never rendered.
   *
   * @param {string|null} [householdId]
   * @param {{only?: string[]}} [opts] - restrict to these usernames, in
   *        household order. Unknown names are dropped, not appended.
   * @returns {Array<object>} hydrated profiles, household order
   */
  getHouseholdRoster(householdId = null, { only = null } = {}) {
    const ordered = this.#configService.getHouseholdUsers(householdId) || [];
    const allow = only ? new Set(only.map(String)) : null;
    return ordered
      .map((entry) => (typeof entry === 'object' && entry !== null ? entry.id ?? entry.name : entry))
      .filter((id) => id && (!allow || allow.has(String(id))))
      .map((id) => {
        const profile = this.getProfile(String(id));
        if (!profile) {
          this.#logger.warn?.('user.roster_profile_missing', { username: id });
          return null;
        }
        return {
          id: profile.username ?? String(id),
          name: profile.display_name || profile.username || String(id),
          group_label: profile.group_label ?? null,
          birthyear: profile.birthyear ?? null,
        };
      })
      .filter(Boolean);
  }

  /**
   * Resolve a username from a platform identity
   * @param {string} platform - Platform name (telegram, garmin, etc.)
   * @param {string} platformId - Platform user ID
   * @returns {string|null}
   */
  resolveFromPlatform(platform, platformId) {
    return this.#configService.resolveUsername(platform, platformId);
  }

  /**
   * Resolve a userId to a display name
   * @param {string} userId - User ID / username
   * @returns {string} Display name or userId if not found
   */
  resolveDisplayName(userId) {
    if (!userId) return 'Unknown';
    const profile = this.getProfile(userId);
    return profile?.display_name || profile?.username || userId;
  }

  /**
   * Resolve a userId to its group label (e.g. "Mom", "Dad")
   * Falls back to display name if no group label is set.
   * @param {string} userId - User ID / username
   * @returns {string} Group label, display name, or userId if not found
   */
  resolveGroupLabel(userId) {
    if (!userId) return 'Unknown';
    const profile = this.getProfile(userId);
    return profile?.group_label || profile?.display_name || profile?.username || userId;
  }
}

export { ConfigUserDirectory as UserService };
export default ConfigUserDirectory;
