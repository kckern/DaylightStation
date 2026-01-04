/**
 * ConfigService - Unified Configuration Management
 *
 * Config now lives in data/system/ directory (flattened).
 * Supports both new file names (app.yml) and legacy names (config.app.yml).
 *
 * Directory structure:
 * - data/system/        - System-wide config & state (system.yml, secrets.yml, cron.yml)
 *   - apps/             - App-specific system configs
 * - data/apps/          - App default configs (inherited by households)
 * - data/households/{hid}/ - Household-specific data
 *   - state/            - Household state (overrides system)
 *   - apps/{app}/       - Household app data & config overrides
 * - data/users/         - User profiles
 * - data/content/       - Shared content
 *
 * Initialization:
 * - init({ dataDir }) - Config at dataDir/system/
 * - init(baseDir) - Legacy: config at baseDir root (deprecated)
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';
import createLogger from '../logging/logger.js';

const logger = createLogger({ app: 'config' });

// Safe YAML reader with error handling
const safeReadYaml = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return parse(raw) || {};
    }
  } catch (err) {
    console.error(`[ConfigService] Failed to read ${filePath}:`, err?.message || err);
  }
  return null;
};

// Deep merge utility (later values override earlier)
const deepMerge = (target, source) => {
  if (!source) return target;
  if (!target) return source;
  
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
};

// Resolve nested path like "paths.data" from object
const resolvePath = (obj, pathStr) => {
  if (!obj || !pathStr) return undefined;
  const parts = pathStr.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
};

class ConfigService {
  #baseDir = null;
  #configDir = null;          // Config directory (data/config/)
  #dataDir = null;
  #legacyConfig = null;       // Merged config (app + secrets + local)
  #systemConfig = null;       // system.yml
  #appConfigs = new Map();    // apps/*.yml
  #userProfiles = new Map();  // data/users/*/profile.yml (cached)
  #householdConfigs = new Map(); // data/households/*/household.yml (cached)
  #initialized = false;
  #initWarningLogged = false;

  constructor() {
    // Will be initialized on first use or explicit init()
  }

  /**
   * Ensure service is initialized, auto-initializing from process.env if needed
   */
  #ensureInitialized() {
    if (this.#initialized) return true;

    // Try to get data path from process.env (set by index.js from config files)
    const dataPath = process.env.path?.data;
    if (dataPath) {
      this.#dataDir = dataPath;
      this.#initialized = true;
      return true;
    }

    // Log warning once
    if (!this.#initWarningLogged) {
      logger.warn('config.not_initialized_process_env_missing');
      logger.warn('config.user_profile_lookups_disabled');
      this.#initWarningLogged = true;
    }
    return false;
  }

  /**
   * Check if service is properly initialized
   */
  isReady() {
    return this.#initialized || this.#ensureInitialized();
  }

  /**
   * Initialize the config service
   *
   * @param {string|object} options - Either baseDir string (legacy) or options object
   * @param {string} options.dataDir - Data directory path (config at dataDir/config/)
   * @param {string} options.configDir - Config directory path (optional, derived from dataDir)
   * @param {string} options.baseDir - Codebase root (legacy fallback)
   */
  init(options) {
    // Support legacy init(baseDir) signature
    if (typeof options === 'string') {
      options = { baseDir: options };
    }

    const { dataDir, configDir, baseDir } = options;

    // Determine config and data directories
    if (dataDir) {
      // New approach: config at dataDir/system/
      this.#dataDir = dataDir;
      // Check for new structure (system/) first, fall back to legacy (config/)
      const newConfigDir = path.join(dataDir, 'system');
      const legacyConfigDir = path.join(dataDir, 'config');
      if (configDir) {
        this.#configDir = configDir;
      } else if (fs.existsSync(path.join(newConfigDir, 'system.yml')) || fs.existsSync(path.join(newConfigDir, 'app.yml'))) {
        this.#configDir = newConfigDir;
      } else if (fs.existsSync(legacyConfigDir)) {
        this.#configDir = legacyConfigDir;
      } else {
        // Default to new structure
        this.#configDir = newConfigDir;
      }
      this.#baseDir = baseDir || path.dirname(dataDir);
    } else if (baseDir) {
      // Legacy approach: config at codebase root
      this.#baseDir = baseDir;
      // Check locations in priority order: system, config, root
      const newConfigDir = path.join(baseDir, 'data', 'system');
      const legacyDataConfigDir = path.join(baseDir, 'data', 'config');
      if (fs.existsSync(path.join(newConfigDir, 'system.yml')) || fs.existsSync(path.join(newConfigDir, 'app.yml'))) {
        this.#configDir = newConfigDir;
        this.#dataDir = path.join(baseDir, 'data');
      } else if (fs.existsSync(legacyDataConfigDir)) {
        this.#configDir = legacyDataConfigDir;
        this.#dataDir = path.join(baseDir, 'data');
      } else {
        // Legacy: config files at root level
        this.#configDir = baseDir;
        this.#dataDir = path.join(baseDir, 'data');
      }
    } else {
      throw new Error('ConfigService.init() requires dataDir or baseDir');
    }

    if (this.#initialized && this.#dataDir === dataDir) return this;

    this.#loadConfigs();
    this.#loadSystemConfig();
    this.#loadAppConfigs();
    this.#resolveDataDir();
    this.#initialized = true;

    return this;
  }

  /**
   * Load config file with fallback from new name to legacy name
   */
  #loadConfigFile(newName, legacyName) {
    const newPath = path.join(this.#configDir, newName);
    const legacyPath = path.join(this.#configDir, legacyName);

    if (fs.existsSync(newPath)) {
      return safeReadYaml(newPath);
    }
    if (fs.existsSync(legacyPath)) {
      return safeReadYaml(legacyPath);
    }
    return null;
  }

  /**
   * Load main config files (system.yml, secrets.yml, system-local.yml)
   */
  #loadConfigs() {
    const appConfig = this.#loadConfigFile('system.yml', 'app.yml') || {};
    const secretsConfig = this.#loadConfigFile('secrets.yml', 'config.secrets.yml') || {};
    const localConfig = this.#loadConfigFile('system-local.yml', 'app-local.yml') || {};

    this.#legacyConfig = { ...appConfig, ...secretsConfig, ...localConfig };
  }

  /**
   * Load system config (system.yml)
   */
  #loadSystemConfig() {
    this.#systemConfig = safeReadYaml(path.join(this.#configDir, 'system.yml'));
  }

  /**
   * Load all app configs from apps/*.yml
   * Checks both data/system/apps/ and data/apps/ for backwards compatibility
   */
  #loadAppConfigs() {
    // Check both locations: system/apps/ (new) and apps/ at data root (legacy)
    const appsDirs = [
      path.join(this.#configDir, 'apps'),  // data/system/apps/
      path.join(this.#dataDir, 'apps')      // data/apps/
    ];

    for (const appsDir of appsDirs) {
      if (!fs.existsSync(appsDir)) continue;

      const files = fs.readdirSync(appsDir).filter(f =>
        (f.endsWith('.yml') || f.endsWith('.yaml')) &&
        !f.startsWith('.') &&
        !f.startsWith('_') &&
        !f.includes('.example.')
      );

      for (const file of files) {
        const appName = file.replace(/\.(yml|yaml)$/, '');
        // Only load if not already loaded (first location takes priority)
        if (!this.#appConfigs.has(appName)) {
          const config = safeReadYaml(path.join(appsDir, file));
          if (config) {
            this.#appConfigs.set(appName, config);
          }
        }
      }
    }
  }

  /**
   * Resolve the data directory path
   */
  #resolveDataDir() {
    // If dataDir was explicitly set, use it
    if (this.#dataDir) return;

    // Priority: system config > process.env > legacy config > default
    this.#dataDir =
      this.#systemConfig?.paths?.data ||
      process.env.path?.data ||
      this.#legacyConfig?.path?.data ||
      path.join(this.#baseDir, 'data');
  }

  /**
   * Get the config directory path (system/config/)
   * Alias for getSystemConfigDir() for backwards compatibility
   */
  getConfigDir() {
    return this.#configDir;
  }

  /**
   * Get the system config directory (data/system/config/)
   */
  getSystemConfigDir() {
    return this.#configDir;
  }

  /**
   * Get the system state directory (data/system/ - same as config, flattened)
   */
  getSystemStateDir() {
    return this.#configDir;
  }

  /**
   * Get the app defaults directory (data/apps/)
   * @param {string} [appName] - Optional app name to get specific app dir
   */
  getAppsDefaultsDir(appName) {
    this.#ensureInitialized();
    if (!this.#dataDir) return null;
    const appsDir = path.join(this.#dataDir, 'apps');
    return appName ? path.join(appsDir, appName) : appsDir;
  }

  /**
   * Get a household's directory (data/households/{hid}/)
   * @param {string} householdId - Household ID
   */
  getHouseholdDir(householdId) {
    this.#ensureInitialized();
    if (!this.#dataDir || !householdId) return null;
    return path.join(this.#dataDir, 'households', householdId);
  }

  /**
   * Get a household's state directory (data/households/{hid}/state/)
   * @param {string} householdId - Household ID
   */
  getHouseholdStateDir(householdId) {
    const hhDir = this.getHouseholdDir(householdId);
    return hhDir ? path.join(hhDir, 'state') : null;
  }

  /**
   * Get a household's app directory (data/households/{hid}/apps/{app}/)
   * @param {string} householdId - Household ID
   * @param {string} appName - App name
   */
  getHouseholdAppDir(householdId, appName) {
    const hhDir = this.getHouseholdDir(householdId);
    if (!hhDir || !appName) return null;
    return path.join(hhDir, 'apps', appName);
  }

  /**
   * Get the content directory (data/content/)
   */
  getContentDir() {
    this.#ensureInitialized();
    if (!this.#dataDir) return null;
    return path.join(this.#dataDir, 'content');
  }

  /**
   * Get a user's directory (data/users/{uid}/)
   * @param {string} userId - User ID
   */
  getUserDir(userId) {
    this.#ensureInitialized();
    if (!this.#dataDir || !userId) return null;
    return path.join(this.#dataDir, 'users', userId);
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  /**
   * Get the full legacy config (for backwards compatibility)
   */
  getLegacyConfig() {
    return this.#legacyConfig;
  }

  /**
   * Get system configuration
   * @param {string} [pathStr] - Dot-notation path (e.g., "paths.data")
   */
  getSystem(pathStr) {
    if (!pathStr) return this.#systemConfig;
    return resolvePath(this.#systemConfig, pathStr);
  }

  /**
   * Get app-specific configuration
   * @param {string} appName - App name (e.g., "fitness", "chatbots")
   * @param {string} [pathStr] - Dot-notation path within app config
   */
  getAppConfig(appName, pathStr) {
    const config = this.#appConfigs.get(appName);
    if (!pathStr) return config;
    return resolvePath(config, pathStr);
  }

  /**
   * Get a secret value
   * @param {string} key - Secret key name
   */
  getSecret(key) {
    return this.#legacyConfig?.[key] || process.env[key];
  }

  /**
   * Get data directory path
   */
  getDataDir() {
    this.#ensureInitialized();
    return this.#dataDir;
  }

  /**
   * Load a user profile from data/users/{username}/profile.yml
   * @param {string} username - User ID
   * @param {boolean} [forceReload=false] - Force reload from disk
   * @returns {object|null} User profile or null if not found/not initialized
   */
  getUserProfile(username, forceReload = false) {
    if (!username) return null;
    
    if (!this.#ensureInitialized()) {
      return null;  // Not ready, warning already logged
    }
    
    // Return cached if available
    if (!forceReload && this.#userProfiles.has(username)) {
      return this.#userProfiles.get(username);
    }

    if (!this.#dataDir) {
      return null;  // Safety check
    }

    const profilePath = path.join(this.#dataDir, 'users', username, 'profile.yml');
    const profile = safeReadYaml(profilePath);
    
    if (profile) {
      this.#userProfiles.set(username, profile);
    }
    
    return profile;
  }

  /**
   * Get all user profiles from data/users/
   * @returns {Map<string, object>} Map of username -> profile
   */
  getAllUserProfiles() {
    if (!this.#ensureInitialized()) {
      return new Map();
    }
    if (!this.#dataDir) return new Map();
    
    const usersDir = path.join(this.#dataDir, 'users');
    if (!fs.existsSync(usersDir)) return new Map();

    const userDirs = fs.readdirSync(usersDir).filter(d => {
      const stat = fs.statSync(path.join(usersDir, d));
      return stat.isDirectory() && !d.startsWith('.') && !d.startsWith('_') && d !== 'example';
    });

    for (const username of userDirs) {
      if (!this.#userProfiles.has(username)) {
        this.getUserProfile(username);
      }
    }

    return this.#userProfiles;
  }

  /**
   * Get effective user config for an app (merges app defaults with user overrides)
   * @param {string} username - User ID
   * @param {string} appName - App name
   * @param {string} [pathStr] - Specific config path
   */
  getUserAppConfig(username, appName, pathStr) {
    const appDefaults = this.getAppConfig(appName, pathStr ? `defaults.${pathStr}` : 'defaults');
    const userProfile = this.getUserProfile(username);
    const userAppConfig = userProfile?.apps?.[appName];
    
    if (pathStr && userAppConfig) {
      const userValue = resolvePath(userAppConfig, pathStr);
      if (userValue !== undefined) {
        return deepMerge(appDefaults, userValue);
      }
    }
    
    return deepMerge(appDefaults, userAppConfig);
  }

  /**
   * Resolve username from platform identity
   * @param {string} platform - Platform name (telegram, garmin, etc.)
   * @param {string} platformId - Platform-specific user ID
   */
  resolveUsername(platform, platformId) {
    // Check chatbots identity mappings first
    const chatbotsMapping = this.getAppConfig('chatbots', `identity_mappings.${platform}.${platformId}`);
    if (chatbotsMapping) return chatbotsMapping;

    // Check other app configs for identity mappings
    for (const [appName, config] of this.#appConfigs) {
      const mapping = config?.identity_mappings?.[platform]?.[platformId];
      if (mapping) return mapping;
    }

    // Legacy fallback
    const legacyMapping = this.#legacyConfig?.chatbots?.users;
    if (legacyMapping) {
      for (const [username, userData] of Object.entries(legacyMapping)) {
        if (userData?.telegram_user_id?.toString() === platformId?.toString()) {
          return username;
        }
      }
    }

    return null;
  }

  /**
   * Check if service is initialized
   */
  isInitialized() {
    return this.#initialized;
  }

  /**
   * Clear all caches (useful for testing)
   */
  clearCache() {
    this.#userProfiles.clear();
    this.#householdConfigs.clear();
  }

  // ============================================================
  // HOUSEHOLD SUPPORT (Phase H1)
  // ============================================================

  /**
   * Get the default household ID from system config or env
   * @returns {string} Default household ID (falls back to 'default')
   */
  getDefaultHouseholdId() {
    return process.env.HOUSEHOLD_ID ||
           this.getSystem('households.default') ||
           'default';
  }

  /**
   * Get households directory path
   * @returns {string|null}
   */
  getHouseholdsDir() {
    this.#ensureInitialized();
    if (!this.#dataDir) return null;
    return path.join(this.#dataDir, 'households');
  }

  /**
   * Load a household config from data/households/{householdId}/household.yml
   * @param {string} householdId - Household ID
   * @param {boolean} [forceReload=false] - Force reload from disk
   * @returns {object|null} Household config or null if not found
   */
  getHouseholdConfig(householdId, forceReload = false) {
    if (!householdId) return null;
    if (!this.#ensureInitialized()) return null;

    // Return cached if available
    if (!forceReload && this.#householdConfigs.has(householdId)) {
      return this.#householdConfigs.get(householdId);
    }

    if (!this.#dataDir) return null;

    const configPath = path.join(this.#dataDir, 'households', householdId, 'household.yml');
    const config = safeReadYaml(configPath);

    if (config) {
      this.#householdConfigs.set(householdId, config);
    }

    return config;
  }

  /**
   * Get default household config (convenience method)
   * @returns {object|null}
   */
  getDefaultHouseholdConfig() {
    return this.getHouseholdConfig(this.getDefaultHouseholdId());
  }

  /**
   * List all household IDs
   * @returns {string[]} Array of household IDs
   */
  listHouseholds() {
    const householdsDir = this.getHouseholdsDir();
    if (!householdsDir || !fs.existsSync(householdsDir)) return [];

    return fs.readdirSync(householdsDir).filter(name => {
      if (name.startsWith('.') || name.startsWith('_') || name === 'example') {
        return false;
      }
      const stat = fs.statSync(path.join(householdsDir, name));
      return stat.isDirectory();
    });
  }

  /**
   * Get household ID for a user (Option A: read from user profile)
   * @param {string} username - User ID
   * @returns {string} Household ID (falls back to default)
   */
  getUserHouseholdId(username) {
    const profile = this.getUserProfile(username);
    return profile?.household_id || this.getDefaultHouseholdId();
  }

  /**
   * Get users belonging to a household
   * @param {string} householdId - Household ID
   * @param {boolean} [forceReload=false] - Force reload from disk
   * @returns {string[]} Array of usernames
   */
  getHouseholdUsers(householdId, forceReload = false) {
    const config = this.getHouseholdConfig(householdId, forceReload);
    return config?.users || [];
  }

  /**
   * Get household app config from household.yml (e.g., fitness.primary_users)
   * Note: For merged config (app defaults + household overrides), use getMergedHouseholdAppConfig()
   * @param {string} householdId - Household ID
   * @param {string} appName - App name
   * @param {string} [pathStr] - Dot-notation path
   * @returns {*}
   */
  getHouseholdAppConfig(householdId, appName, pathStr) {
    const config = this.getHouseholdConfig(householdId);
    const appConfig = config?.apps?.[appName];
    if (!pathStr) return appConfig;
    return resolvePath(appConfig, pathStr);
  }

  // ============================================================
  // INHERITANCE-BASED CONFIG LOADING
  // ============================================================

  /**
   * Get state with inheritance (system defaults → household overrides)
   * Loads from system/state/{stateName}.yml, merged with households/{hid}/state/{stateName}.yml
   * @param {string} stateName - State file name (without .yml)
   * @param {string} [householdId] - Household ID (defaults to default household)
   * @returns {object|null} Merged state or null if not found
   */
  getState(stateName, householdId) {
    if (!this.#ensureInitialized()) return null;
    const hid = householdId || this.getDefaultHouseholdId();

    // Load system defaults
    const systemStateDir = this.getSystemStateDir();
    const systemState = systemStateDir ? safeReadYaml(path.join(systemStateDir, `${stateName}.yml`)) : null;

    // Load household overrides
    const hhStateDir = this.getHouseholdStateDir(hid);
    const hhState = hhStateDir ? safeReadYaml(path.join(hhStateDir, `${stateName}.yml`)) : null;

    // Merge: household overrides system
    if (!systemState && !hhState) return null;
    return deepMerge(systemState || {}, hhState || {});
  }

  /**
   * Get merged app config (app defaults → household overrides)
   * Loads from apps/{appName}/config.yml, merged with households/{hid}/apps/{appName}/config.yml
   * @param {string} appName - App name
   * @param {string} [householdId] - Household ID (defaults to default household)
   * @returns {object|null} Merged config or null if not found
   */
  getMergedHouseholdAppConfig(appName, householdId) {
    if (!this.#ensureInitialized()) return null;
    const hid = householdId || this.getDefaultHouseholdId();

    // Load app defaults from data/apps/{appName}/config.yml
    const appDefaultsDir = this.getAppsDefaultsDir(appName);
    const appDefaults = appDefaultsDir ? safeReadYaml(path.join(appDefaultsDir, 'config.yml')) : null;

    // Load household overrides from data/households/{hid}/apps/{appName}/config.yml
    const hhAppDir = this.getHouseholdAppDir(hid, appName);
    const hhOverrides = hhAppDir ? safeReadYaml(path.join(hhAppDir, 'config.yml')) : null;

    // Also include system-level app config from system/config/apps/{appName}.yml
    const systemAppConfig = this.getAppConfig(appName);

    // Merge order: system app config → app defaults → household overrides
    if (!systemAppConfig && !appDefaults && !hhOverrides) return null;
    return deepMerge(deepMerge(systemAppConfig || {}, appDefaults || {}), hhOverrides || {});
  }

  /**
   * Write state to household state directory
   * @param {string} stateName - State file name (without .yml)
   * @param {object} data - Data to write
   * @param {string} [householdId] - Household ID (defaults to default household)
   * @returns {boolean} Success
   */
  writeHouseholdState(stateName, data, householdId) {
    if (!this.#ensureInitialized()) return false;
    const hid = householdId || this.getDefaultHouseholdId();
    const stateDir = this.getHouseholdStateDir(hid);

    if (!stateDir) return false;

    // Ensure directory exists
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    const filePath = path.join(stateDir, `${stateName}.yml`);
    try {
      const { stringify } = require('yaml');
      fs.writeFileSync(filePath, stringify(data), 'utf8');
      return true;
    } catch (err) {
      logger.error('config.write_household_state_failed', { stateName, householdId: hid, error: err.message });
      return false;
    }
  }

  /**
   * Get timezone for a household
   * Falls back to system config, then environment, then default
   * @param {string} householdId - Household ID
   * @returns {string} Timezone string (e.g., 'America/Los_Angeles')
   */
  getHouseholdTimezone(householdId) {
    const config = this.getHouseholdConfig(householdId);
    return config?.timezone 
      || this.getSystem('timezone') 
      || process.env.TZ 
      || 'America/Los_Angeles';
  }

  // ============================================================
  // LIFELOG USER-AWARE HELPERS (Phase 1 of lifelog restructure)
  // ============================================================

  /**
   * Get the head of household (default user for single-user operations)
   * @param {string} [householdId] - Optional household ID (defaults to default household)
   * @returns {string|null} Username of head of household
   */
  getHeadOfHousehold(householdId = null) {
    const hid = householdId || this.getDefaultHouseholdId();
    
    // Check household config for head
    const householdConfig = this.getHouseholdConfig(hid);
    if (householdConfig?.head) {
      return householdConfig.head;
    }
    
    // Check system config for primary user
    const primary = this.getSystem('household.head') || this.getSystem('primary_user');
    if (primary) return primary;
    
    // Fallback: find first user with head_of_household: true in profile
    const profiles = this.getAllUserProfiles();
    for (const [username, profile] of profiles) {
      if (profile.household?.role === 'head' || profile.head_of_household === true) {
        return username;
      }
    }
    
    // Fallback: first user in household users list
    if (householdConfig?.users?.length > 0) {
      return householdConfig.users[0];
    }
    
    // Fallback: first user alphabetically
    const firstUser = profiles.keys().next().value;
    return firstUser || null;
  }

  /**
   * Get the lifelog path for a user and service
   * @param {string} username - The username
   * @param {string} service - The service name (e.g., 'fitness', 'nutrition/nutriday')
   * @returns {string} The full relative path
   */
  getLifelogPath(username, service) {
    if (!username) {
      logger.warn('config.get_lifelog_path_missing_username', { service });
      return `lifelog/${service}`;  // Fallback to legacy path
    }
    return `lifelog/${username}/${service}`;
  }

  /**
   * Get user auth token path
   * @param {string} username - The username
   * @param {string} service - The auth service (e.g., 'strava', 'withings')
   * @returns {string} The full relative path
   */
  getUserAuthPath(username, service) {
    if (!username) {
      logger.warn('config.get_user_auth_path_missing_username', { service });
      return `auth/${service}`;  // Fallback to legacy path
    }
    return `users/${username}/auth/${service}`;
  }

  /**
   * List all usernames
   * @returns {string[]} Array of usernames
   */
  listUsers() {
    const profiles = this.getAllUserProfiles();
    return Array.from(profiles.keys());
  }
}

// Singleton instance
export const configService = new ConfigService();

export default configService;
