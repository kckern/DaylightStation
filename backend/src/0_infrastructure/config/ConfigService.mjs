/**
 * ConfigService - Pure Configuration Accessor
 *
 * Receives pre-loaded, validated config via constructor.
 * All methods are simple property lookups - no I/O, no fallbacks.
 */

export class ConfigService {
  #config;

  constructor(config) {
    this.#config = Object.freeze(config);
  }

  // ─── Secrets ───────────────────────────────────────────────

  getSecret(key) {
    return this.#config.secrets?.[key] ?? null;
  }

  // ─── Households ────────────────────────────────────────────

  getDefaultHouseholdId() {
    return this.#config.system?.defaultHouseholdId ?? 'default';
  }

  getHeadOfHousehold(householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households?.[hid]?.head ?? null;
  }

  getHouseholdUsers(householdId) {
    return this.#config.households?.[householdId]?.users ?? [];
  }

  getHouseholdTimezone(householdId) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households?.[hid]?.timezone
        ?? this.#config.system?.timezone ?? 'UTC';
  }

  getUserHouseholdId(username) {
    const profile = this.getUserProfile(username);
    return profile?.household_id ?? this.getDefaultHouseholdId();
  }

  // ─── Users ─────────────────────────────────────────────────

  getUserProfile(username) {
    return this.#config.users?.[username] ?? null;
  }

  getAllUserProfiles() {
    return new Map(Object.entries(this.#config.users ?? {}));
  }

  resolveUsername(platform, platformId) {
    return this.#config.identityMappings?.[platform]?.[String(platformId)] ?? null;
  }

  // ─── Auth ──────────────────────────────────────────────────

  getUserAuth(service, username = null) {
    const user = username ?? this.getHeadOfHousehold();
    if (!user) return null;
    return this.#config.auth?.users?.[user]?.[service] ?? null;
  }

  getHouseholdAuth(service, householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.auth?.households?.[hid]?.[service] ?? null;
  }

  // ─── Apps ──────────────────────────────────────────────────

  getAppConfig(appName, pathStr = null) {
    const config = this.#config.apps?.[appName] ?? null;
    if (!pathStr || !config) return config;
    return resolvePath(config, pathStr);
  }

  // ─── Paths ─────────────────────────────────────────────────

  getDataDir() {
    return this.#config.system?.dataDir ?? './data';
  }

  getMediaDir() {
    return this.#config.system?.paths?.media
      ?? this.#config.system?.mediaDir
      ?? `${this.getDataDir()}/media`;
  }

  getUserDir(username) {
    return `${this.getDataDir()}/users/${username}`;
  }

  getConfigDir() {
    return this.#config.system?.configDir ?? './config';
  }

  getPath(name) {
    return this.#config.system?.paths?.[name] ?? null;
  }

  // ─── System Config ──────────────────────────────────────────

  get(pathStr) {
    return resolvePath(this.#config.system, pathStr);
  }

  getEnv() {
    return this.#config.system?.env ?? process.env.DAYLIGHT_ENV ?? 'default';
  }

  getTimezone() {
    return this.#config.system?.timezone ?? 'America/Los_Angeles';
  }

  getPort() {
    return this.#config.system?.server?.port ?? 3111;
  }

  isSchedulerEnabled() {
    return this.#config.system?.scheduler?.enabled ?? false;
  }

  // ─── Convenience ───────────────────────────────────────────

  isReady() {
    return true;
  }
}

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
