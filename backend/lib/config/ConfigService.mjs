/**
 * ConfigService - Pure Configuration Accessor
 * @module lib/config/ConfigService
 *
 * Receives pre-loaded, validated config via constructor.
 * All methods are simple property lookups - no I/O, no fallbacks.
 */

/**
 * Pure configuration accessor.
 * Receives pre-loaded, validated config via constructor.
 * All methods are simple property lookups - no I/O, no fallbacks.
 */
export class ConfigService {
  #config;

  constructor(config) {
    this.#config = Object.freeze(config);
  }

  // ─── Secrets ───────────────────────────────────────────────

  /**
   * Get a secret value by key.
   * @param {string} key - Secret key name
   * @returns {string|null}
   */
  getSecret(key) {
    return this.#config.secrets?.[key] ?? null;
  }

  // ─── Households ────────────────────────────────────────────

  /**
   * Get the default household ID.
   * @returns {string}
   */
  getDefaultHouseholdId() {
    return this.#config.system.defaultHouseholdId;
  }

  /**
   * Get the head of a household.
   * @param {string} [householdId] - Household ID (defaults to default household)
   * @returns {string|null}
   */
  getHeadOfHousehold(householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households[hid]?.head ?? null;
  }

  /**
   * Get users in a household.
   * @param {string} householdId - Household ID
   * @returns {string[]}
   */
  getHouseholdUsers(householdId) {
    return this.#config.households[householdId]?.users ?? [];
  }

  /**
   * Get timezone for a household.
   * @param {string} [householdId] - Household ID (defaults to default household)
   * @returns {string}
   */
  getHouseholdTimezone(householdId) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households[hid]?.timezone
        ?? this.#config.system.timezone;
  }

  /**
   * Get household ID for a user.
   * @param {string} username - Username
   * @returns {string} Household ID (falls back to default)
   */
  getUserHouseholdId(username) {
    const profile = this.getUserProfile(username);
    return profile?.household_id ?? this.getDefaultHouseholdId();
  }

  // ─── Users ─────────────────────────────────────────────────

  /**
   * Get a user profile by username.
   * @param {string} username - Username
   * @returns {object|null}
   */
  getUserProfile(username) {
    return this.#config.users[username] ?? null;
  }

  /**
   * Get all user profiles.
   * @returns {Map<string, object>}
   */
  getAllUserProfiles() {
    return new Map(Object.entries(this.#config.users));
  }

  /**
   * Resolve username from platform identity.
   * @param {string} platform - Platform name (e.g., 'telegram', 'garmin')
   * @param {string|number} platformId - Platform-specific user ID
   * @returns {string|null}
   */
  resolveUsername(platform, platformId) {
    return this.#config.identityMappings?.[platform]?.[String(platformId)] ?? null;
  }

  // ─── Auth ──────────────────────────────────────────────────

  /**
   * Get auth credentials for a user service.
   * @param {string} service - Service name (e.g., 'strava', 'withings')
   * @param {string} [username] - Username (defaults to head of household)
   * @returns {object|null}
   */
  getUserAuth(service, username = null) {
    const user = username ?? this.getHeadOfHousehold();
    if (!user) return null;
    return this.#config.auth.users?.[user]?.[service] ?? null;
  }

  /**
   * Get auth credentials for a household service.
   * @param {string} service - Service name (e.g., 'plex', 'homeassistant')
   * @param {string} [householdId] - Household ID (defaults to default household)
   * @returns {object|null}
   */
  getHouseholdAuth(service, householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.auth.households?.[hid]?.[service] ?? null;
  }

  // ─── Apps ──────────────────────────────────────────────────

  /**
   * Get app configuration.
   * @param {string} appName - App name (e.g., 'chatbots', 'fitness')
   * @param {string} [pathStr] - Dot-notation path within app config
   * @returns {*}
   */
  getAppConfig(appName, pathStr = null) {
    const config = this.#config.apps[appName] ?? null;
    if (!pathStr || !config) return config;
    return resolvePath(config, pathStr);
  }

  // ─── Paths ─────────────────────────────────────────────────

  /**
   * Get the data directory path.
   * @returns {string}
   */
  getDataDir() {
    return this.#config.system.dataDir;
  }

  /**
   * Get a user's directory path.
   * @param {string} username - Username
   * @returns {string}
   */
  getUserDir(username) {
    return `${this.#config.system.dataDir}/users/${username}`;
  }

  /**
   * Get the config directory path.
   * @returns {string}
   */
  getConfigDir() {
    return this.#config.system.configDir;
  }

  // ─── Convenience ───────────────────────────────────────────

  /**
   * Check if service is ready.
   * Always returns true - validated at construction.
   * @returns {boolean}
   */
  isReady() {
    return true;
  }
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Resolve a dot-notation path in an object.
 * @param {object} obj - Object to traverse
 * @param {string} pathStr - Dot-notation path (e.g., 'bots.nutribot.token')
 * @returns {*}
 */
function resolvePath(obj, pathStr) {
  const parts = pathStr.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return null;
    current = current[part];
  }
  return current ?? null;
}

export default ConfigService;
