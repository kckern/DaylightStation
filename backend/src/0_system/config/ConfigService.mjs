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

  /**
   * Get app configuration scoped to a household
   * @param {string|null} householdId - Household ID, defaults to default household
   * @param {string} appName - App name (e.g., 'chatbots', 'fitness')
   * @returns {object|null}
   */
  getHouseholdAppConfig(householdId, appName) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households?.[hid]?.apps?.[appName] ?? null;
  }

  /**
   * Get all integrations for a household
   * @param {string|null} householdId - Household ID, defaults to default household
   * @returns {object}
   */
  getHouseholdIntegrations(householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households?.[hid]?.integrations ?? {};
  }

  /**
   * Get specific integration config for a household
   * @param {string|null} householdId - Household ID, defaults to default household
   * @param {string} serviceName - Service name (plex, homeassistant, etc.)
   * @returns {object|null}
   */
  getHouseholdIntegration(householdId, serviceName) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households?.[hid]?.integrations?.[serviceName] ?? null;
  }

  // ─── Paths ─────────────────────────────────────────────────

  getDataDir() {
    return this.#config.system?.dataDir ?? './data';
  }

  getMediaDir() {
    return this.#config.system?.paths?.media
      ?? this.#config.system?.mediaDir
      ?? `${this.#config.system?.baseDir ?? '.'}/media`;
  }

  getUserDir(username) {
    return `${this.getDataDir()}/users/${username}`;
  }

  getConfigDir() {
    return this.#config.system?.configDir ?? './config';
  }

  /**
   * Get household-scoped path for state/history files
   * @param {string} relativePath - Path relative to household dir (e.g., 'apps/fitness', 'history/menu_memory')
   * @param {string} [householdId] - Household ID, defaults to default household
   * @returns {string} Full path using correct structure (flat or legacy)
   */
  getHouseholdPath(relativePath, householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    const household = this.#config.households?.[hid];

    if (!household) {
      throw new Error(`Household not found: ${hid}`);
    }

    const folderName = household._folderName || hid;
    const dataDir = this.getDataDir();

    // Legacy structure: data/households/{id}/
    if (household._legacyPath) {
      const basePath = `${dataDir}/households/${folderName}`;
      return relativePath ? `${basePath}/${relativePath}` : basePath;
    }

    // New flat structure: data/household[-{id}]/
    const basePath = `${dataDir}/${folderName}`;
    return relativePath ? `${basePath}/${relativePath}` : basePath;
  }

  /**
   * Check if a household exists
   * @param {string} householdId - Household ID to check
   * @returns {boolean}
   */
  householdExists(householdId) {
    return householdId in (this.#config.households || {});
  }

  /**
   * Get the primary household ID
   * @returns {string}
   */
  getPrimaryHouseholdId() {
    return this.#config.system?.defaultHouseholdId ?? 'default';
  }

  /**
   * Get all household IDs
   * @returns {string[]}
   */
  getAllHouseholdIds() {
    return Object.keys(this.#config.households || {});
  }

  getPath(name) {
    // Check explicit path config first
    const explicitPath = this.#config.system?.paths?.[name];
    if (explicitPath) return explicitPath;

    // Derive standard media subdirectories
    const mediaDir = this.getMediaDir();
    const standardPaths = {
      img: `${mediaDir}/img`,
      font: `${mediaDir}/fonts`,
      icons: `${mediaDir}/img/icons`
    };

    return standardPaths[name] ?? null;
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

  /**
   * Get all service host mappings
   * @returns {object}
   */
  getAllServices() {
    return this.#config.services ?? {};
  }

  /**
   * Resolve service name to host for current environment
   * @param {string} serviceName - Logical service name (plex, homeassistant, mqtt, etc.)
   * @returns {string|null} Host for current environment or null if not found
   */
  resolveServiceHost(serviceName) {
    const serviceMapping = this.#config.services?.[serviceName];
    if (!serviceMapping) return null;

    const env = this.getEnv();
    return serviceMapping[env] ?? null;
  }

  // ─── System Config ──────────────────────────────────────────

  get(pathStr) {
    return resolvePath(this.#config.system, pathStr);
  }

  /**
   * Get service configuration with services_host override
   * @param {string} serviceName - Service identifier (home_assistant, plex, mqtt, etc.)
   * @returns {object|null} Service config with host and port
   */
  getServiceConfig(serviceName) {
    const serviceConfig = this.#config.system?.[serviceName];
    if (!serviceConfig) return null;

    const servicesHost = this.#config.system?.services_host;
    let host = serviceConfig.host;

    // If services_host is defined (typically in local config), override the hostname
    // Handle both full URLs (http://plex:32400) and plain hostnames (homeassistant)
    if (servicesHost && host) {
      try {
        const url = new URL(host);
        // Replace hostname in URL, keeping protocol and port
        url.hostname = servicesHost;
        host = url.toString().replace(/\/$/, ''); // Remove trailing slash
      } catch {
        // Not a valid URL, just replace the entire host
        host = servicesHost;
      }
    }

    return {
      ...serviceConfig,
      host
    };
  }

  /**
   * Get service credentials combining system config (host) with auth (token)
   * @param {string} serviceName - Service identifier (plex, home_assistant, etc.)
   * @param {string} [householdId] - Household to get auth from (defaults to default household)
   * @returns {object|null} Combined {host, token, ...} or null if incomplete
   */
  getServiceCredentials(serviceName, householdId = null) {
    const systemConfig = this.getServiceConfig(serviceName);
    const auth = this.getHouseholdAuth(serviceName, householdId);

    // Require both host and token
    if (!systemConfig?.host || !auth?.token) return null;

    return {
      host: systemConfig.host,
      token: auth.token,
      // Include other system config fields (protocol, platform, etc.)
      ...systemConfig,
      // Include other auth fields if present
      ...auth
    };
  }

  getEnv() {
    return this.#config.system?.env ?? process.env.DAYLIGHT_ENV ?? 'default';
  }

  getTimezone() {
    return this.#config.system?.timezone ?? 'America/Los_Angeles';
  }

  /**
   * Get the public-facing app port (what users/tests hit)
   * In dev: Vite runs here, backend on +1
   * In prod: Backend serves everything here
   */
  getAppPort() {
    return this.#config.system?.app?.port ?? 3111;
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
