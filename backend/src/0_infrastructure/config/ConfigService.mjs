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

  // ─── Adapters ────────────────────────────────────────────

  /**
   * Get adapter configuration by name
   * @param {string} adapterName - Adapter identifier (plex, immich, mqtt, etc.)
   * @returns {object|null}
   */
  getAdapterConfig(adapterName) {
    return this.#config.adapters?.[adapterName] ?? null;
  }

  /**
   * Get all adapter configurations
   * @returns {object}
   */
  getAllAdapterConfigs() {
    return this.#config.adapters ?? {};
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

  // ─── Debug/Status ─────────────────────────────────────────

  /**
   * Get config safe for exposure via status endpoint.
   * Excludes secrets, auth, identity mappings (PII), and credential-like fields.
   * @returns {object}
   */
  getSafeConfig() {
    const { secrets, auth, identityMappings, ...safe } = this.#config;

    // Deep filter sensitive fields from remaining config
    return filterSensitive(safe);
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

// ─── Sensitivity Registry ─────────────────────────────────────
// Central registry for field sensitivity classification

// REDACTED: Completely hidden - credentials and secrets
const REDACTED_PATTERNS = [
  'token', 'secret', 'password', 'api_key', 'apikey', 'credential',
  'access_token', 'refresh_token', 'private_key', 'bearer', 'ssn'
];

// MASKED: Show first char + asterisks - PII and identifiers
const MASKED_PATTERNS = [
  'username', 'user', 'email', 'phone', 'address',
  'display_name', 'name'
];

// User ID patterns (masked) - but not client/household IDs
const MASKED_ID_PATTERN = /^(?!.*(client|household)).*_id$/i;

function getSensitivity(key) {
  const lower = key.toLowerCase();

  // Check redacted patterns first (highest priority)
  if (REDACTED_PATTERNS.some(p => lower.includes(p))) {
    return 'redacted';
  }

  // Check masked patterns
  if (MASKED_PATTERNS.some(p => lower === p || lower.endsWith('_' + p))) {
    return 'masked';
  }

  // Check *_id but not *_client_id or *_household_id
  if (MASKED_ID_PATTERN.test(key)) {
    return 'masked';
  }

  return 'public';
}

function maskValue(value) {
  if (value === null || value === undefined) return value;
  const str = String(value);
  if (str.length <= 1) return '*';
  return str[0] + '*'.repeat(Math.min(str.length - 1, 5));
}

function filterSensitive(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(filterSensitive);

  const filtered = {};
  for (const [key, value] of Object.entries(obj)) {
    const sensitivity = getSensitivity(key);

    if (sensitivity === 'redacted') {
      filtered[key] = '[REDACTED]';
    } else if (sensitivity === 'masked') {
      filtered[key] = typeof value === 'object' ? filterSensitive(value) : maskValue(value);
    } else if (typeof value === 'object' && value !== null) {
      filtered[key] = filterSensitive(value);
    } else {
      filtered[key] = value;
    }
  }
  return filtered;
}

export default ConfigService;
