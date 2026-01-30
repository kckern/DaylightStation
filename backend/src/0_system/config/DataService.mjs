/**
 * DataService - Hierarchical Data Access API
 *
 * Provides a clean, path-first API for reading and writing data files
 * with optional scope identifiers (username, householdId).
 *
 * Usage:
 *   dataService.user.read('lifelog/nutrition', username?)
 *   dataService.user.write('lifelog/nutrition', data, username?)
 *   dataService.household.read('shared/weather', hid?)
 *   dataService.household.write('shared/weather', data, hid?)
 *   dataService.system.read('state/cron-runtime')
 *   dataService.system.write('state/cron-runtime', data)
 *
 * Paths:
 *   - user: {dataDir}/users/{username}/{relativePath}.yml
 *   - household: {dataDir}/household[-{hid}]/{relativePath}.yml
 *   - system: {dataDir}/system/{relativePath}.yml
 *
 * Location: backend/src/0_system/config/DataService.mjs
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

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
    return false;
  }
};

/**
 * Append .yml extension if no extension is present
 * @param {string} filePath - Path that may or may not have extension
 * @returns {string} Path with extension
 */
const ensureExtension = (filePath) => {
  if (!path.extname(filePath)) {
    return `${filePath}.yml`;
  }
  return filePath;
};

/**
 * DataService - Hierarchical data access with path-first API
 */
export class DataService {
  #configService;

  /**
   * @param {object} options
   * @param {ConfigService} options.configService - ConfigService instance for path resolution
   */
  constructor(options = {}) {
    const { configService } = options;

    if (!configService) {
      throw new InfrastructureError(
        'DataService requires configService',
        { code: 'MISSING_CONFIG_SERVICE' }
      );
    }

    this.#configService = configService;

    // Build sub-objects for each scope
    this.user = this.#createUserScope();
    this.household = this.#createHouseholdScope();
    this.system = this.#createSystemScope();
  }

  /**
   * Create the user-scoped data accessor
   * @returns {object} { read, write, resolvePath }
   */
  #createUserScope() {
    const self = this;

    return {
      /**
       * Resolve full path for user data file
       * @param {string} relativePath - Path relative to user directory
       * @param {string} [username] - Username (defaults to head of household)
       * @returns {string} Full absolute path
       */
      resolvePath(relativePath, username = null) {
        const user = username ?? self.#configService.getHeadOfHousehold();
        const dataDir = self.#configService.getDataDir();
        const fullPath = path.join(dataDir, 'users', user, relativePath);
        return ensureExtension(fullPath);
      },

      /**
       * Read user data file
       * @param {string} relativePath - Path relative to user directory (e.g., 'lifelog/nutrition')
       * @param {string} [username] - Username (defaults to head of household)
       * @returns {object|null} Parsed data or null
       */
      read(relativePath, username = null) {
        const fullPath = this.resolvePath(relativePath, username);
        return readYamlFile(fullPath);
      },

      /**
       * Write user data file
       * @param {string} relativePath - Path relative to user directory
       * @param {object} data - Data to write
       * @param {string} [username] - Username (defaults to head of household)
       * @returns {boolean} Success status
       */
      write(relativePath, data, username = null) {
        const fullPath = this.resolvePath(relativePath, username);
        return writeYamlFile(fullPath, data);
      },
    };
  }

  /**
   * Create the household-scoped data accessor
   * @returns {object} { read, write, resolvePath }
   */
  #createHouseholdScope() {
    const self = this;

    return {
      /**
       * Resolve full path for household data file
       * Uses ConfigService.getHouseholdPath for proper folder name resolution
       * @param {string} relativePath - Path relative to household directory
       * @param {string} [householdId] - Household ID (defaults to default household)
       * @returns {string} Full absolute path
       */
      resolvePath(relativePath, householdId = null) {
        const fullPath = self.#configService.getHouseholdPath(relativePath, householdId);
        return ensureExtension(fullPath);
      },

      /**
       * Read household data file
       * @param {string} relativePath - Path relative to household directory (e.g., 'shared/weather')
       * @param {string} [householdId] - Household ID (defaults to default household)
       * @returns {object|null} Parsed data or null
       */
      read(relativePath, householdId = null) {
        const fullPath = this.resolvePath(relativePath, householdId);
        return readYamlFile(fullPath);
      },

      /**
       * Write household data file
       * @param {string} relativePath - Path relative to household directory
       * @param {object} data - Data to write
       * @param {string} [householdId] - Household ID (defaults to default household)
       * @returns {boolean} Success status
       */
      write(relativePath, data, householdId = null) {
        const fullPath = this.resolvePath(relativePath, householdId);
        return writeYamlFile(fullPath, data);
      },
    };
  }

  /**
   * Create the system-scoped data accessor
   * @returns {object} { read, write, resolvePath }
   */
  #createSystemScope() {
    const self = this;

    return {
      /**
       * Resolve full path for system data file
       * @param {string} relativePath - Path relative to system directory
       * @returns {string} Full absolute path
       */
      resolvePath(relativePath) {
        const dataDir = self.#configService.getDataDir();
        const fullPath = path.join(dataDir, 'system', relativePath);
        return ensureExtension(fullPath);
      },

      /**
       * Read system data file
       * @param {string} relativePath - Path relative to system directory (e.g., 'state/cron-runtime')
       * @returns {object|null} Parsed data or null
       */
      read(relativePath) {
        const fullPath = this.resolvePath(relativePath);
        return readYamlFile(fullPath);
      },

      /**
       * Write system data file
       * @param {string} relativePath - Path relative to system directory
       * @param {object} data - Data to write
       * @returns {boolean} Success status
       */
      write(relativePath, data) {
        const fullPath = this.resolvePath(relativePath);
        return writeYamlFile(fullPath, data);
      },
    };
  }
}

export default DataService;
