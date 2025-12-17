/**
 * Service Initialization
 * 
 * Explicit initialization of config-dependent services.
 * Must be called AFTER config is loaded into process.env.
 * 
 * Usage:
 *   // In index.js, after loading config
 *   await initializeServices({ logger });
 */

import { configService } from './ConfigService.mjs';
import { userService } from './UserService.mjs';

let initialized = false;
let initializationError = null;

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
  initializeServices,
  getServiceStatus,
  isInitialized,
  resetInitialization
};
