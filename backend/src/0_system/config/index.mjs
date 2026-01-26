/**
 * Config Service Entry Point
 * 
 * Factory, singleton, and exports for the config system.
 *
 * Usage at startup:
 *   import { initConfigService } from './0_infrastructure/config/index.mjs';
 *   initConfigService(dataDir);
 *
 * Usage in modules:
 *   import { configService } from './0_infrastructure/config/index.mjs';
 *   const key = configService.getSecret('API_KEY');
 *
 * Usage in tests:
 *   import { createTestConfigService } from './0_infrastructure/config/index.mjs';
 *   const svc = createTestConfigService({ ... });
 */

import { ConfigService } from './ConfigService.mjs';
import { loadConfig } from './configLoader.mjs';
import { validateConfig, ConfigValidationError } from './configValidator.mjs';

let instance = null;

/**
 * Create a ConfigService from files on disk.
 * Loads config, validates against schema, returns service instance.
 *
 * @param {string} dataDir - Path to data directory
 * @returns {ConfigService}
 * @throws {ConfigValidationError} If config is invalid
 */
export function createConfigService(dataDir) {
  const config = loadConfig(dataDir);
  validateConfig(config, dataDir);
  return new ConfigService(config);
}

/**
 * Set resolved paths in environment variables.
 *
 * @param {ConfigService} svc - Initialized ConfigService instance
 */
function setEnvPaths(svc) {
  process.env.DAYLIGHT_DATA_PATH = svc.getDataDir();
  process.env.DAYLIGHT_MEDIA_PATH = svc.getMediaDir();
}

/**
 * Initialize the singleton instance.
 * Call once at application startup.
 *
 * @param {string} dataDir - Path to data directory
 * @returns {ConfigService}
 * @throws {Error} If already initialized
 * @throws {ConfigValidationError} If config is invalid
 */
export function initConfigService(dataDir) {
  if (instance) {
    throw new Error('ConfigService already initialized');
  }
  instance = createConfigService(dataDir);
  setEnvPaths(instance);
  return instance;
}

/**
 * Get the singleton instance.
 *
 * @returns {ConfigService}
 * @throws {Error} If not yet initialized
 */
export function getConfigService() {
  if (!instance) {
    throw new Error(
      'ConfigService not initialized. Call initConfigService(dataDir) at startup.'
    );
  }
  return instance;
}

/**
 * Convenience proxy for direct import.
 *
 * Usage:
 *   import { configService } from './config/index.mjs';
 *   const key = configService.getSecret('API_KEY');
 */
export const configService = new Proxy({}, {
  get(_, prop) {
    // Special handling for isReady() - safe to call before initialization
    if (prop === 'isReady') {
      return () => instance !== null;
    }
    
    // Get the instance (throws if not initialized)
    const svc = getConfigService();
    const value = svc[prop];
    
    // If it's a function, bind it to the correct instance
    if (typeof value === 'function') {
      return value.bind(svc);
    }
    
    return value;
  }
});

/**
 * Reset singleton instance.
 * For testing only - allows re-initialization.
 */
export function resetConfigService() {
  instance = null;
}

/**
 * Create ConfigService directly from config object.
 * For testing - skips file I/O and validation.
 *
 * @param {object} config - Pre-built config object
 * @returns {ConfigService}
 */
export function createTestConfigService(config) {
  return new ConfigService(config);
}

// Re-exports
export { ConfigService } from './ConfigService.mjs';
export { ConfigValidationError } from './configValidator.mjs';
export { configSchema } from './configSchema.mjs';
export { loadConfig } from './configLoader.mjs';
export { validateConfig } from './configValidator.mjs';
export { userDataService, default as UserDataService } from './UserDataService.mjs';
export { userService, UserService } from './UserService.mjs';

export default configService;
