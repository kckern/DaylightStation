/**
 * Service Initialization
 *
 * Provides initialization for config-dependent services.
 * Supports both server context and standalone CLI/test context.
 *
 * Directory structure:
 * - data/system/config/ - System configuration
 * - data/system/state/  - System state (cron defaults)
 * - data/apps/          - App default configs
 * - data/households/    - Household-specific data
 * - data/users/         - User profiles
 * - data/content/       - Shared content
 *
 * Usage:
 *   // In server (index.js), after loading config into process.env:
 *   await initializeServices({ logger });
 *
 *   // In CLI tools or tests (standalone, no process.env needed):
 *   import { initStandalone } from './init.mjs';
 *   const { configService, dataDir } = await initStandalone();
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { configService } from './ConfigService.mjs';
import { userService } from './UserService.mjs';

let initialized = false;
let initializationError = null;

/**
 * Auto-detect data directory from environment or well-known locations
 * @returns {string|null} Data directory path or null if not found
 */
export function detectDataDir() {
  // 1. Environment variable (primary)
  if (process.env.DAYLIGHT_DATA_PATH) {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (fs.existsSync(dataPath)) {
      return dataPath;
    }
  }

  // 2. Check if running in Docker
  if (fs.existsSync('/.dockerenv')) {
    return '/usr/src/app/data';
  }

  // 3. Well-known Dropbox locations (macOS)
  const dropboxPaths = [
    path.join(process.env.HOME || '', 'Library/CloudStorage/Dropbox/Apps/DaylightStation/data'),
    path.join(process.env.HOME || '', 'Dropbox/Apps/DaylightStation/data'),
  ];
  for (const p of dropboxPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // 4. Relative to codebase (for tests)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const codebaseData = path.resolve(__dirname, '..', '..', '..', 'data');
  if (fs.existsSync(codebaseData)) {
    return codebaseData;
  }

  return null;
}

/**
 * Initialize ConfigService standalone (for CLI tools and tests)
 * Does not require process.env to be populated.
 *
 * @param {object} options
 * @param {string} options.dataDir - Data directory path (auto-detected if not provided)
 * @param {boolean} options.verbose - Log initialization details
 * @returns {object} - { configService, dataDir, configDir }
 */
export function initStandalone(options = {}) {
  const { verbose = false } = options;
  let { dataDir } = options;

  // Auto-detect data directory if not provided
  if (!dataDir) {
    dataDir = detectDataDir();
    if (!dataDir) {
      throw new Error(
        'Could not detect data directory. Set DAYLIGHT_DATA_PATH environment variable.'
      );
    }
    if (verbose) {
      console.log(`[ConfigInit] Auto-detected dataDir: ${dataDir}`);
    }
  }

  // Initialize ConfigService with dataDir
  configService.init({ dataDir });

  if (verbose) {
    console.log(`[ConfigInit] ConfigService initialized`);
    console.log(`[ConfigInit] configDir: ${configService.getConfigDir()}`);
    console.log(`[ConfigInit] dataDir: ${configService.getDataDir()}`);
  }

  return {
    configService,
    dataDir: configService.getDataDir(),
    configDir: configService.getConfigDir()
  };
}

/**
 * Initialize all config-dependent services
 * 
 * @param {object} options
 * @param {object} options.logger - Logger instance (optional)
 * @param {boolean} options.verbose - Log detailed info
 * @returns {object} - { success, services, error }
 */
export async function initializeServices(options = {}) {
  const { logger, verbose = false } = options;
  
  const log = (level, msg, data) => {
    if (logger && typeof logger[level] === 'function') {
      logger[level](msg, data);
    } else if (verbose || level === 'error') {
      console.log(`[ServiceInit] ${msg}`, data || '');
    }
  };

  if (initialized) {
    log('debug', 'services.already-initialized');
    return { success: true, services: getServiceStatus() };
  }

  try {
    log('debug', 'services.initializing');

    // Verify process.env has required config
    const dataDir = process.env.path?.data;
    if (!dataDir) {
      throw new Error('process.env.path.data not set - cannot initialize services');
    }

    // ConfigService auto-initializes from process.env on first use
    // Just verify it's ready
    const configReady = configService.isReady();
    if (!configReady) {
      log('warn', 'services.configService.not-ready', { dataDir });
    }

    // UserService depends on ConfigService - verify it works
    // Try to get all profiles (will use ConfigService internally)
    const profiles = configService.getAllUserProfiles();
    const userCount = profiles?.size || 0;

    initialized = true;
    
    const status = getServiceStatus();
    log('info', 'services.initialized', {
      configReady,
      userCount,
      dataDir
    });

    return { success: true, services: status };

  } catch (err) {
    initializationError = err;
    log('error', 'services.init-failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Get current service initialization status
 */
export function getServiceStatus() {
  return {
    initialized,
    configService: {
      ready: configService.isReady(),
      dataDir: configService.getDataDir()
    },
    error: initializationError?.message || null
  };
}

/**
 * Check if services are initialized
 */
export function isInitialized() {
  return initialized;
}

/**
 * Reset initialization state (for testing)
 */
export function resetInitialization() {
  initialized = false;
  initializationError = null;
  configService.clearCache();
}

export default {
  initStandalone,
  initializeServices,
  getServiceStatus,
  isInitialized,
  resetInitialization,
  detectDataDir
};
