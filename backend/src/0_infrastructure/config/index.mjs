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
 * Global paths object for application-wide access.
 * This is NOT on process.env because process.env only stores strings.
 *
 * Code can access paths via:
 * 1. global.__daylightPaths.data / global.__daylightPaths.media (preferred)
 * 2. process.env.DAYLIGHT_DATA_PATH / process.env.DAYLIGHT_MEDIA_PATH
 */
const globalPaths = {};

/**
 * Set resolved paths in environment and global object.
 *
 * NOTE: process.env only stores strings, so we can't use process.env.path = {...}
 * Instead we set individual env vars and a global object.
 *
 * @param {ConfigService} svc - Initialized ConfigService instance
 */
function setEnvPaths(svc) {
  const data = svc.getDataDir();
  const media = svc.getMediaDir();

  // Set individual string env vars
  process.env.DAYLIGHT_DATA_PATH = data;
  process.env.DAYLIGHT_MEDIA_PATH = media;

  // Also set on global object for code that needs an object
  globalPaths.data = data;
  globalPaths.media = media;

  // Make available globally for legacy code using process.env.path pattern
  global.__daylightPaths = globalPaths;
}

/**
 * Get paths object. Used by code that previously accessed process.env.path
 */
export function getPaths() {
  return global.__daylightPaths || globalPaths;
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
