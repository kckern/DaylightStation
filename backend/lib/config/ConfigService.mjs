/**
 * ConfigService - Unified Configuration Management
 * 
 * Loads configuration from multiple sources with proper layering:
 * 1. Legacy: config.app.yml, config.secrets.yml, config.app-local.yml
 * 2. New: config/system.yml, config/apps/*.yml
 * 3. User profiles: data/users/{id}/profile.yml
 * 
 * Maintains backwards compatibility while enabling new modular config.
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
  #dataDir = null;
  #legacyConfig = null;      // Merged legacy config (app + secrets + local)
  #systemConfig = null;       // config/system.yml
  #appConfigs = new Map();    // config/apps/*.yml
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
   * @param {string} baseDir - Project root directory
   */
  init(baseDir) {
    if (this.#initialized && this.#baseDir === baseDir) return this;
    
    this.#baseDir = baseDir;
    this.#loadLegacyConfigs();
    this.#loadSystemConfig();
    this.#loadAppConfigs();
    this.#resolveDataDir();
    this.#initialized = true;
    
    return this;
  }

  /**
   * Load legacy config files (config.app.yml, etc.)
   */
  #loadLegacyConfigs() {
    const appConfig = safeReadYaml(path.join(this.#baseDir, 'config.app.yml')) || {};
    const secretsConfig = safeReadYaml(path.join(this.#baseDir, 'config.secrets.yml')) || {};
    const localConfig = safeReadYaml(path.join(this.#baseDir, 'config.app-local.yml')) || {};
    
    this.#legacyConfig = { ...appConfig, ...secretsConfig, ...localConfig };
  }

  /**
   * Load new system config (config/system.yml)
   */
  #loadSystemConfig() {
    this.#systemConfig = safeReadYaml(path.join(this.#baseDir, 'config', 'system.yml'));
  }

  /**
   * Load all app configs from config/apps/*.yml
   */
  #loadAppConfigs() {
    const appsDir = path.join(this.#baseDir, 'config', 'apps');
    if (!fs.existsSync(appsDir)) return;

    const files = fs.readdirSync(appsDir).filter(f => 
      (f.endsWith('.yml') || f.endsWith('.yaml')) && 
      !f.startsWith('.') && 
      !f.startsWith('_') &&
      !f.includes('.example.')
    );

    for (const file of files) {
      const appName = file.replace(/\.(yml|yaml)$/, '');
      const config = safeReadYaml(path.join(appsDir, file));
      if (config) {
        this.#appConfigs.set(appName, config);
      }
    }
  }

  /**
   * Resolve the data directory path
   */
  #resolveDataDir() {
    // Priority: system config > process.env > legacy config > default
    // We prefer process.env because it's populated by index.js which handles 
    // external config directories and local overrides correctly.
    this.#dataDir = 
      this.#systemConfig?.paths?.data ||
      process.env.path?.data ||
      this.#legacyConfig?.path?.data ||
      path.join(this.#baseDir, 'data');
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
   * Get household app config (e.g., fitness.primary_users)
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
