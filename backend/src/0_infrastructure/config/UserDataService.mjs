/**
 * UserDataService - User-Namespaced Data Management
 * 
 * Handles all user-specific data operations with proper namespacing:
 * - All user data stored under data/users/{username}/
 * - Auth tokens, lifelog, app data isolated per-user
 * - Legacy path support with deprecation warnings
 * 
 * Works alongside ConfigService for configuration management.
 * 
 * Location: backend/src/0_infrastructure/config/UserDataService.mjs
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { configService } from './index.mjs';
import { createLogger } from '../logging/logger.js';

const logger = createLogger({
  source: 'backend',
  app: 'user-data-service'
});

/**
 * Read YAML file and parse contents
 * @param {string} absolutePath - Full path to YAML file
 * @returns {object|null}
 */
const readYamlFile = (absolutePath) => {
  try {
    if (!fs.existsSync(absolutePath)) return null;
    const content = fs.readFileSync(absolutePath, 'utf8');
    return yaml.load(content) || null;
  } catch (err) {
    logger.warn('yaml.read.error', { path: absolutePath, error: err.message });
    return null;
  }
};

/**
 * Write data to YAML file with directory creation
 * @param {string} absolutePath - Full path to YAML file
 * @param {object} data - Data to write
 * @returns {boolean}
 */
const writeYamlFile = (absolutePath, data) => {
  try {
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = yaml.dump(data, { lineWidth: -1, quotingType: '"' });
    fs.writeFileSync(absolutePath, content, 'utf8');
    return true;
  } catch (err) {
    logger.error('yaml.write.error', { path: absolutePath, error: err.message });
    return false;
  }
};

/**
 * Read YAML file (wrapper for readYamlFile)
 */
const readYaml = (absolutePath) => {
  return readYamlFile(absolutePath);
};

/**
 * Write YAML file (wrapper for writeYamlFile)
 */
const writeYaml = (absolutePath, data) => {
  return writeYamlFile(absolutePath, data);
};

/**
 * Ensure directory exists
 */
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

class UserDataService {
  #dataDir = null;
  #initialized = false;

  constructor() {
    // Will be initialized on first use
  }

  /**
   * Ensure service is initialized
   */
  #ensureInitialized() {
    if (this.#initialized) return true;
    
    // Get data dir from ConfigService or process.env
    this.#dataDir = configService.getDataDir() || process.env.path?.data;
    
    if (this.#dataDir) {
      this.#initialized = true;
      return true;
    }
    
    logger.warn('user-data.not-initialized', { 
      message: 'Data directory not configured - user data operations will fail' 
    });
    return false;
  }

  /**
   * Get the base data directory
   */
  getDataDir() {
    this.#ensureInitialized();
    return this.#dataDir;
  }

  /**
   * Get the users directory path
   */
  getUsersDir() {
    this.#ensureInitialized();
    return path.join(this.#dataDir, 'users');
  }

  /**
   * Get the base path for a user's data directory
   * @param {string} username - User identifier
   */
  getUserDir(username) {
    if (!username) {
      logger.warn('user-data.missing-username');
      return null;
    }
    this.#ensureInitialized();
    return path.join(this.#dataDir, 'users', username);
  }

  /**
   * Get full path for user data file
   * @param {string} username - User identifier
   * @param {...string} segments - Path segments (e.g., 'lifelog', 'fitness.yml')
   */
  getUserDataPath(username, ...segments) {
    const userDir = this.getUserDir(username);
    if (!userDir) return null;
    
    // Handle segments that may include nested paths
    const flatSegments = segments.flatMap(s => s.split('/').filter(Boolean));
    return path.join(userDir, ...flatSegments);
  }

  /**
   * Check if a user directory exists
   * @param {string} username - User identifier
   */
  userExists(username) {
    const userDir = this.getUserDir(username);
    return userDir && fs.existsSync(userDir);
  }

  /**
   * Create user directory structure
   * @param {string} username - User identifier
   */
  createUserDirectory(username) {
    const userDir = this.getUserDir(username);
    if (!userDir) return false;

    const subdirs = [
      '',                    // user root
      'auth',                // oauth tokens
      'lifelog',             // activity data
      'lifelog/nutrition',   // nutrition data
      'lifelog/journal',     // journal entries
      'apps',                // app-specific data
      'gratitude'            // gratitude data
    ];

    for (const subdir of subdirs) {
      ensureDir(path.join(userDir, subdir));
    }

    logger.info('user-data.directory-created', { username });
    return true;
  }

  /**
   * List all users with data directories
   * @returns {string[]} Array of usernames
   */
  listUsers() {
    const usersDir = this.getUsersDir();
    if (!fs.existsSync(usersDir)) return [];

    return fs.readdirSync(usersDir).filter(name => {
      if (name.startsWith('.') || name.startsWith('_') || name === 'example') {
        return false;
      }
      const stat = fs.statSync(path.join(usersDir, name));
      return stat.isDirectory();
    });
  }

  // ============================================================
  // HOUSEHOLD SUPPORT (Phase H1)
  // ============================================================

  /**
   * Get the households directory path
   * @returns {string|null}
   */
  getHouseholdsDir() {
    this.#ensureInitialized();
    if (!this.#dataDir) return null;
    return path.join(this.#dataDir, 'households');
  }

  /**
   * Get the base path for a household's data directory
   * @param {string} householdId - Household identifier
   * @returns {string|null}
   */
  getHouseholdDir(householdId) {
    if (!householdId) {
      logger.warn('user-data.missing-household-id');
      return null;
    }
    this.#ensureInitialized();
    if (!this.#dataDir) return null;
    return path.join(this.#dataDir, 'households', householdId);
  }

  /**
   * Get household shared data path (for household-level data stores)
   * @param {string} householdId - Household identifier
   * @param {...string} segments - Path segments (e.g., 'gratitude', 'options.gratitude')
   * @returns {string|null}
   */
  getHouseholdSharedPath(householdId, ...segments) {
    const householdDir = this.getHouseholdDir(householdId);
    if (!householdDir) return null;
    const flatSegments = segments.flatMap(s => s.split('/').filter(Boolean));
    return path.join(householdDir, 'shared', ...flatSegments);
  }

  /**
   * Get household app data path (for household-level app config/data)
   * @param {string} householdId - Household identifier
   * @param {string} appName - App name (e.g., 'fitness')
   * @param {...string} segments - Additional path segments
   * @returns {string|null}
   */
  getHouseholdAppPath(householdId, appName, ...segments) {
    const householdDir = this.getHouseholdDir(householdId);
    if (!householdDir) return null;
    const flatSegments = segments.flatMap(s => s.split('/').filter(Boolean));
    return path.join(householdDir, 'apps', appName, ...flatSegments);
  }

  /**
   * Read household shared data file
   * @param {string} householdId - Household identifier
   * @param {string} dataPath - Relative path within shared directory
   * @returns {object|null}
   */
  readHouseholdSharedData(householdId, dataPath) {
    let fullPath = this.getHouseholdSharedPath(householdId, dataPath);
    if (!fullPath) return null;

    if (!fullPath.match(/\.(ya?ml|json)$/)) {
      fullPath += '.yml';
    }

    return readYaml(fullPath);
  }

  /**
   * Write household shared data file
   * @param {string} householdId - Household identifier
   * @param {string} dataPath - Relative path within shared directory
   * @param {object} data - Data to write
   * @returns {boolean}
   */
  writeHouseholdSharedData(householdId, dataPath, data) {
    let fullPath = this.getHouseholdSharedPath(householdId, dataPath);
    if (!fullPath) return false;

    if (!fullPath.match(/\.(ya?ml|json)$/)) {
      fullPath += '.yml';
    }

    return writeYaml(fullPath, data);
  }

  /**
   * Read household app data file
   * @param {string} householdId - Household identifier
   * @param {string} appName - App name
   * @param {string} dataPath - Relative path within app directory
   * @returns {object|null}
   */
  readHouseholdAppData(householdId, appName, dataPath) {
    let fullPath = this.getHouseholdAppPath(householdId, appName, dataPath);
    if (!fullPath) return null;

    if (!fullPath.match(/\.(ya?ml|json)$/)) {
      fullPath += '.yml';
    }

    return readYaml(fullPath);
  }

  /**
   * Write household app data file
   * @param {string} householdId - Household identifier
   * @param {string} appName - App name
   * @param {string} dataPath - Relative path within app directory
   * @param {object} data - Data to write
   * @returns {boolean}
   */
  writeHouseholdAppData(householdId, appName, dataPath, data) {
    let fullPath = this.getHouseholdAppPath(householdId, appName, dataPath);
    if (!fullPath) return false;

    if (!fullPath.match(/\.(ya?ml|json)$/)) {
      fullPath += '.yml';
    }

    return writeYaml(fullPath, data);
  }

  /**
   * Check if a household directory exists
   * @param {string} householdId - Household identifier
   * @returns {boolean}
   */
  householdExists(householdId) {
    const householdDir = this.getHouseholdDir(householdId);
    return householdDir && fs.existsSync(householdDir);
  }

  /**
   * Create household directory structure
   * @param {string} householdId - Household identifier
   * @returns {boolean}
   */
  createHouseholdDirectory(householdId) {
    const householdDir = this.getHouseholdDir(householdId);
    if (!householdDir) return false;

    const subdirs = [
      '',                        // household root
      'shared',                  // shared data stores
      'shared/gratitude',        // gratitude bank/options
      'apps',                    // app-specific data
      'apps/fitness'             // fitness runtime config
    ];

    for (const subdir of subdirs) {
      ensureDir(path.join(householdDir, subdir));
    }

    logger.info('user-data.household-directory-created', { householdId });
    return true;
  }

  // ============================================================
  // USER DATA READ/WRITE
  // ============================================================

  /**
   * Read user data file
   * @param {string} username - User identifier
   * @param {string} dataPath - Relative path within user directory (e.g., 'lifelog/fitness')
   * @returns {object|null} Parsed data or null
   */
  readUserData(username, dataPath) {
    let fullPath = this.getUserDataPath(username, dataPath);
    if (!fullPath) return null;

    if (!fullPath.match(/\.(ya?ml|json)$/)) {
      fullPath += '.yml';
    }

    return readYaml(fullPath);
  }

  /**
   * Write user data file
   * @param {string} username - User identifier
   * @param {string} dataPath - Relative path within user directory
   * @param {object} data - Data to write
   * @returns {boolean} Success status
   */
  writeUserData(username, dataPath, data) {
    let fullPath = this.getUserDataPath(username, dataPath);
    if (!fullPath) return false;

    if (!fullPath.match(/\.(ya?ml|json)$/)) {
      fullPath += '.yml';
    }

    return writeYaml(fullPath, data);
  }

  /**
   * Check if user data file exists
   * @param {string} username - User identifier
   * @param {string} dataPath - Relative path within user directory
   */
  userDataExists(username, dataPath) {
    let fullPath = this.getUserDataPath(username, dataPath);
    if (!fullPath) return false;

    if (!fullPath.match(/\.(ya?ml|json)$/)) {
      return fs.existsSync(fullPath + '.yml') || fs.existsSync(fullPath + '.yaml');
    }
    return fs.existsSync(fullPath);
  }

  // ============================================================
  // AUTH TOKENS
  // ============================================================

  /**
   * Get auth token for a user and provider
   * @param {string} username - User identifier
   * @param {string} provider - Provider name (withings, strava, fitbit, etc.)
   */
  getAuthToken(username, provider) {
    return this.readUserData(username, `auth/${provider}`);
  }

  /**
   * Save auth token for a user and provider
   * @param {string} username - User identifier
   * @param {string} provider - Provider name
   * @param {object} tokenData - Token data to save
   */
  saveAuthToken(username, provider, tokenData) {
    return this.writeUserData(username, `auth/${provider}`, tokenData);
  }

  /**
   * Check if user has auth token for provider
   * @param {string} username - User identifier
   * @param {string} provider - Provider name
   */
  hasAuthToken(username, provider) {
    return this.userDataExists(username, `auth/${provider}`);
  }

  // ============================================================
  // LIFELOG DATA
  // ============================================================

  /**
   * Get lifelog data for a user
   * @param {string} username - User identifier
   * @param {string} category - Lifelog category (fitness, nutrition, weight, etc.)
   * @param {string} [subcategory] - Optional subcategory
   */
  getLifelogData(username, category, subcategory = null) {
    const segments = ['lifelog', category];
    if (subcategory) segments.push(subcategory);
    return this.readUserData(username, segments.join('/'));
  }

  /**
   * Save lifelog data for a user
   * @param {string} username - User identifier
   * @param {string} category - Lifelog category
   * @param {object} data - Data to save
   * @param {string} [subcategory] - Optional subcategory
   */
  saveLifelogData(username, category, data, subcategory = null) {
    const segments = ['lifelog', category];
    if (subcategory) segments.push(subcategory);
    return this.writeUserData(username, segments.join('/'), data);
  }

  // ============================================================
  // APP-SPECIFIC DATA
  // ============================================================

  /**
   * Get app-specific data for a user
   * @param {string} username - User identifier
   * @param {string} appName - App name (fitness, gratitude, etc.)
   * @param {string} dataKey - Data key within app
   */
  getAppData(username, appName, dataKey) {
    return this.readUserData(username, `apps/${appName}/${dataKey}`);
  }

  /**
   * Save app-specific data for a user
   * @param {string} username - User identifier
   * @param {string} appName - App name
   * @param {string} dataKey - Data key within app
   * @param {object} data - Data to save
   */
  saveAppData(username, appName, dataKey, data) {
    return this.writeUserData(username, `apps/${appName}/${dataKey}`, data);
  }

  // ============================================================
  // LEGACY SUPPORT / MIGRATION
  // ============================================================

  /**
   * Read from legacy path with deprecation warning
   * Falls back to user-namespaced path if available
   * @param {string} legacyPath - Legacy data path (e.g., 'lifelog/fitness')
   * @param {string} [username] - Username for new path lookup
   */
  readLegacyData(legacyPath, username = null) {
    // Try user-namespaced first if username provided
    if (username) {
      const userData = this.readUserData(username, legacyPath);
      if (userData !== null) {
        return userData;
      }
    }

    // Fall back to legacy path directly
    this.#ensureInitialized();
    let fullPath = path.join(this.#dataDir, legacyPath);
    if (!fullPath.match(/\.(ya?ml|json)$/)) {
      fullPath += '.yml';
    }
    return readYaml(fullPath);
  }

  /**
   * Migrate data from legacy path to user-namespaced path
   * @param {string} legacyPath - Legacy data path
   * @param {string} username - Target username
   * @param {boolean} [deleteOriginal=false] - Delete original after migration
   */
  migrateData(legacyPath, username, deleteOriginal = false) {
    this.#ensureInitialized();

    const legacyFullPath = path.join(this.#dataDir, legacyPath);
    const extensions = ['.yml', '.yaml', ''];
    let sourcePath = null;

    for (const ext of extensions) {
      const tryPath = legacyFullPath + ext;
      if (fs.existsSync(tryPath)) {
        sourcePath = tryPath;
        break;
      }
    }

    if (!sourcePath) {
      logger.warn('user-data.migrate-source-not-found', { legacyPath });
      return false;
    }

    // Read legacy data
    const data = readYaml(sourcePath);
    if (data === null) {
      logger.warn('user-data.migrate-empty-source', { legacyPath });
      return false;
    }

    // Write to user-namespaced location
    const success = this.writeUserData(username, legacyPath, data);
    if (!success) {
      logger.error('user-data.migrate-write-failed', { legacyPath, username });
      return false;
    }

    // Optionally delete original
    if (deleteOriginal) {
      try {
        fs.unlinkSync(sourcePath);
        logger.info('user-data.migrate-deleted-original', { sourcePath });
      } catch (err) {
        logger.warn('user-data.migrate-delete-failed', { sourcePath, message: err?.message });
      }
    }

    logger.info('user-data.migrated', {
      from: legacyPath,
      to: `users/${username}/${legacyPath}`,
      deletedOriginal: deleteOriginal
    });
    return true;
  }

  /**
   * Batch migrate multiple legacy paths for a user
   * @param {string} username - Target username
   * @param {string[]} legacyPaths - Array of legacy paths to migrate
   * @param {boolean} [deleteOriginals=false] - Delete originals after migration
   */
  batchMigrate(username, legacyPaths, deleteOriginals = false) {
    const results = {
      success: [],
      failed: [],
      skipped: []
    };

    for (const legacyPath of legacyPaths) {
      // Check if already migrated
      if (this.userDataExists(username, legacyPath)) {
        results.skipped.push(legacyPath);
        continue;
      }

      const success = this.migrateData(legacyPath, username, deleteOriginals);
      if (success) {
        results.success.push(legacyPath);
      } else {
        results.failed.push(legacyPath);
      }
    }

    logger.info('user-data.batch-migrate-complete', {
      username,
      success: results.success.length,
      failed: results.failed.length,
      skipped: results.skipped.length
    });

    return results;
  }

  /**
   * Check service initialization status
   */
  isReady() {
    return this.#initialized || this.#ensureInitialized();
  }
}

// Singleton instance
export const userDataService = new UserDataService();

export default userDataService;
