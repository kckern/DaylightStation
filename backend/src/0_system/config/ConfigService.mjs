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

  /**
   * Get a secret by legacy key name.
   * Maps old SCREAMING_CASE keys to new systemAuth structure.
   * @deprecated Use getSystemAuth(platform, key) directly
   */
  getSecret(key) {
    // Check legacy secrets.yml first (backwards compat)
    const legacyValue = this.#config.secrets?.[key];
    if (legacyValue) return legacyValue;

    // Map legacy keys to systemAuth structure
    const mapping = {
      OPENAI_API_KEY: ['openai', 'api_key'],
      ANTHROPIC_API_KEY: ['anthropic', 'api_key'],
      GOOGLE_CLIENT_ID: ['google', 'client_id'],
      GOOGLE_CLIENT_SECRET: ['google', 'client_secret'],
      GOOGLE_REDIRECT_URI: ['google', 'redirect_uri'],
      GOOGLE_API_KEY: ['google', 'api_key'],
      GOOGLE_CSE_ID: ['google', 'cse_id'],
      STRAVA_CLIENT_ID: ['strava', 'client_id'],
      STRAVA_CLIENT_SECRET: ['strava', 'client_secret'],
      LOGGLY_TOKEN: ['loggly', 'token'],
      LOGGLY_SUBDOMAIN: ['loggly', 'subdomain'],
      LOGGLY_API_TOKEN: ['loggly', 'api_token'],
      CLICKUP_PK: ['clickup', 'pk'],
      TODOIST_KEY: ['todoist', 'api_key'],
      IFTTT_KEY: ['ifttt', 'key'],
      OPEN_WEATHER_API_KEY: ['weather', 'openweather_api_key'],
      LAST_FM_API_KEY: ['lastfm', 'api_key'],
      PLEX_TOKEN: ['plex', 'token'],
      IMMICH_API_KEY: ['immich', 'api_key'],
      AUDIOBOOKSHELF_TOKEN: ['audiobookshelf', 'token'],
      FRESHRSS_USERNAME: ['freshrss', 'username'],
      FRESHRSS_PASSWORD: ['freshrss', 'password'],
      FRESHRSS_API_KEY: ['freshrss', 'api_key'],
      WITHINGS_CLIENT: ['withings', 'client_id'],
      WITHINGS_SECRET: ['withings', 'client_secret'],
      WITHINGS_REDIRECT: ['withings', 'redirect_uri'],
      FITSYNC_CLIENT_ID: ['fitsync', 'client_id'],
      FITSYNC_CLIENT_SECRET: ['fitsync', 'client_secret'],
      ED_APP_ID: ['food', 'edamam_app_id'],
      ED_APP_KEY: ['food', 'edamam_app_key'],
      UPCITE: ['food', 'upcitemdb_key'],
    };

    const mapped = mapping[key];
    if (mapped) {
      return this.getSystemAuth(mapped[0], mapped[1]);
    }

    return null;
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

  getIdentityMappings() {
    return this.#config.identityMappings ?? {};
  }

  resolveUsername(platform, platformId) {
    return this.#config.identityMappings?.[platform]?.[String(platformId)] ?? null;
  }

  resolvePlatformId(platform, username) {
    const mappings = this.#config.identityMappings?.[platform];
    if (!mappings) return null;
    for (const [platformId, user] of Object.entries(mappings)) {
      if (user === username) return platformId;
    }
    return null;
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
   * Get raw integrations config for a household.
   * Returns the entire integrations.yml content for parsing.
   * Used by IntegrationLoader for config-driven adapter loading.
   *
   * @param {string} [householdId]
   * @returns {object} Raw integrations config
   */
  getIntegrationsConfig(householdId) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households?.[hid]?.integrations ?? {};
  }

  /**
   * Get specific integration config for a household
   * Falls back to default household if the requested household doesn't have the integration
   * @param {string|null} householdId - Household ID, defaults to default household
   * @param {string} serviceName - Service name (plex, homeassistant, etc.)
   * @returns {object|null}
   */
  getHouseholdIntegration(householdId, serviceName) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    const integration = this.#config.households?.[hid]?.integrations?.[serviceName];
    if (integration) return integration;

    // Fall back to default household if different from requested
    const defaultHid = this.getDefaultHouseholdId();
    if (hid !== defaultHid) {
      return this.#config.households?.[defaultHid]?.integrations?.[serviceName] ?? null;
    }
    return null;
  }

  /**
   * Get devices config for a household
   * @param {string|null} householdId - Household ID, defaults to default household
   * @returns {object}
   */
  getHouseholdDevices(householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households?.[hid]?.devices ?? {};
  }

  /**
   * Get a specific device config
   * @param {string} deviceId - Device ID (e.g., 'office-tv', 'piano')
   * @param {string|null} householdId - Household ID, defaults to default household
   * @returns {object|null}
   */
  getDeviceConfig(deviceId, householdId = null) {
    const devices = this.getHouseholdDevices(householdId);
    return devices?.devices?.[deviceId] ?? null;
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
   * @deprecated Use getHouseholdAppPath() for app data
   * @param {string} relativePath - Path relative to household dir (e.g., 'apps/fitness', 'history/menu_memory')
   * @param {string} [householdId] - Household ID, defaults to default household
   * @returns {string} Full path: data/household[-{id}]/relativePath
   */
  getHouseholdPath(relativePath, householdId = null) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    const household = this.#config.households?.[hid];

    if (!household) {
      throw new Error(`Household not found: ${hid}`);
    }

    const folderName = household._folderName || hid;
    const dataDir = this.getDataDir();

    // Flat structure: data/household[-{id}]/
    const basePath = `${dataDir}/${folderName}`;
    return relativePath ? `${basePath}/${relativePath}` : basePath;
  }

  /**
   * Get canonical household app path following households/apps/{appName}/ pattern
   * @param {string} appName - App name (fitness, nutribot, journalist, etc.)
   * @param {string} [relativePath] - Path relative to app dir (e.g., 'sessions', 'conversations')
   * @param {string} [householdId] - Household ID (ignored - kept for API compatibility)
   * @returns {string} Full path: data/households/apps/{appName}/{relativePath}
   */
  getHouseholdAppPath(appName, relativePath = '', householdId = null) {
    const dataDir = this.getDataDir();
    const basePath = `${dataDir}/households/apps/${appName}`;
    return relativePath ? `${basePath}/${relativePath}` : basePath;
  }

  /**
   * Get canonical household app media path
   * @param {string} appName - App name (fitness, etc.)
   * @param {string} [relativePath] - Path relative to app media dir
   * @param {string} [householdId] - Household ID (ignored - kept for API compatibility)
   * @returns {string} Full path: media/apps/{appName}/households/{relativePath}
   */
  getHouseholdAppMediaPath(appName, relativePath = '', householdId = null) {
    const mediaDir = this.getMediaDir();
    const basePath = `${mediaDir}/apps/${appName}/households`;
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
   * Resolve service URL for current environment
   * @param {string} serviceName - Service name (plex, homeassistant, mqtt, etc.)
   * @returns {string|null} Full URL or null if not found
   */
  resolveServiceUrl(serviceName) {
    const service = this.#config.services?.[serviceName];
    if (!service) return null;

    const env = this.getEnv();

    // Direct env lookup - all values are full URLs
    if (env in service) {
      return service[env];
    }

    // Fall back to default
    return service.default ?? null;
  }

  /**
   * Resolve browser-accessible URL for a service.
   * Looks for a `webUrl` key in the service config; falls back to resolveServiceUrl().
   * @param {string} serviceName - Service name (komga, plex, etc.)
   * @returns {string|null} Browser-facing URL or null if not found
   */
  resolveServiceWebUrl(serviceName) {
    const service = this.#config.services?.[serviceName];
    return service?.webUrl || this.resolveServiceUrl(serviceName);
  }

  /**
   * Get integration config for a capability from household integrations
   * @param {string|null} householdId - Household ID, defaults to default household
   * @param {string} capability - Capability name (media, ai, home_automation)
   * @returns {Array} Array of provider configs or empty array
   */
  getCapabilityIntegrations(householdId, capability) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    return this.#config.households?.[hid]?.integrations?.[capability] ?? [];
  }

  // ─── System Config ──────────────────────────────────────────

  /**
   * Get system-level config by name (e.g., 'bots' returns system/bots.yml content)
   * @param {string} name - Config name (bots, etc.)
   * @returns {object|null}
   */
  getSystemConfig(name) {
    // Map config names to their locations in the config object
    const configMap = {
      bots: this.#config.systemBots,
      // Add other system configs here as needed
    };
    return configMap[name] ?? null;
  }

  /**
   * Get system-level auth credentials
   * @param {string} platform - Platform name (telegram, discord, etc.)
   * @param {string} key - Auth key (bot name, service name, etc.)
   * @returns {string|null} The auth token/credential
   */
  getSystemAuth(platform, key) {
    return this.#config.systemAuth?.[platform]?.[key] ?? null;
  }

  /**
   * Get the first messaging platform configured for a household app
   * @param {string|null} householdId - Household ID, defaults to default household
   * @param {string} appName - App name (nutribot, journalist, etc.)
   * @returns {string|null} Platform name (telegram, discord, etc.)
   */
  getHouseholdMessagingPlatform(householdId, appName) {
    const hid = householdId ?? this.getDefaultHouseholdId();
    const integrations = this.#config.households?.[hid]?.integrations;
    const messaging = integrations?.messaging?.[appName];
    if (!messaging || !Array.isArray(messaging) || messaging.length === 0) {
      return null;
    }
    return messaging[0]?.platform ?? null;
  }

  get(pathStr) {
    return resolvePath(this.#config.system, pathStr);
  }

  /**
   * Get service configuration from system config
   * @deprecated Use resolveServiceUrl() for per-household services or getAdapterConfig() for shared services
   * @param {string} serviceName - Service identifier (home_assistant, plex, mqtt, etc.)
   * @returns {object|null} Service config with host and port
   */
  getServiceConfig(serviceName) {
    return this.#config.system?.[serviceName] ?? null;
  }

  /**
   * Get service credentials combining URL with auth (token)
   * @deprecated Use resolveServiceUrl() + getHouseholdAuth() separately
   * @param {string} serviceName - Service identifier (plex, home_assistant, etc.)
   * @param {string} [householdId] - Household to get auth from (defaults to default household)
   * @returns {object|null} Combined {host, token, ...} or null if incomplete
   */
  getServiceCredentials(serviceName, householdId = null) {
    const url = this.resolveServiceUrl(serviceName);
    const auth = this.getHouseholdAuth(serviceName, householdId);
    const integration = this.getHouseholdIntegration(householdId, serviceName);

    // Require both URL and token
    if (!url || !auth?.token) return null;

    return {
      host: url,
      token: auth.token,
      // Include integration config fields (protocol, platform, etc.)
      ...integration,
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
   *
   * Supports environment-based format (like services.yml):
   *   app:
   *     ports:
   *       default: 3111
   *       docker: 3111
   *       kckern-server: 3112
   */
  getAppPort() {
    const app = this.#config.system?.app;
    if (!app) return 3111;

    // New format: app.ports.{env}
    if (app.ports && typeof app.ports === 'object') {
      const env = this.getEnv();
      if (env in app.ports) {
        return app.ports[env];
      }
      return app.ports.default ?? 3111;
    }

    // Legacy format: app.port (single value)
    return app.port ?? 3111;
  }

  /**
   * Check if scheduler is enabled for current environment.
   * Supports environment-based format:
   *   scheduler:
   *     enabled:
   *       default: false
   *       docker: true
   */
  isSchedulerEnabled() {
    const scheduler = this.#config.system?.scheduler;
    if (!scheduler) return false;

    const enabled = scheduler.enabled;

    // New format: scheduler.enabled.{env}
    if (enabled && typeof enabled === 'object') {
      const env = this.getEnv();
      if (env in enabled) {
        return !!enabled[env];
      }
      return !!enabled.default;
    }

    // Legacy format: scheduler.enabled (boolean)
    return !!enabled;
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
