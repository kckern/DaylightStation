/**
 * Test Configuration Helper
 *
 * Provides ConfigService instances for tests without touching real config files.
 * Uses DAYLIGHT_DATA_PATH if available, otherwise uses mock config.
 */

import {
  createTestConfigService,
  initConfigService,
  resetConfigService,
  configService
} from '#backend/src/0_infrastructure/config/index.mjs';
import { defaultMockConfig } from './mockConfigs.mjs';

/**
 * Initialize ConfigService for integration tests.
 * Uses DAYLIGHT_DATA_PATH env var to find real config.
 *
 * @returns {ConfigService}
 * @throws {Error} If DAYLIGHT_DATA_PATH not set
 */
export function initTestConfigService() {
  const dataDir = process.env.DAYLIGHT_DATA_PATH;
  if (!dataDir) {
    throw new Error(
      'DAYLIGHT_DATA_PATH not set. Required for integration tests.\n' +
      'Set it in .env or use createMockConfigService() for unit tests.'
    );
  }

  if (configService.isReady()) {
    resetConfigService();
  }

  return initConfigService(dataDir);
}

/**
 * Create a mock ConfigService for unit tests.
 * No file I/O - uses provided config or defaults.
 *
 * @param {object} overrides - Config overrides merged with defaults
 * @returns {ConfigService}
 */
export function createMockConfigService(overrides = {}) {
  const config = deepMerge(defaultMockConfig, overrides);
  return createTestConfigService(config);
}

/**
 * Reset ConfigService singleton.
 * Call in afterEach() to ensure test isolation.
 */
export { resetConfigService };

/**
 * Get the ConfigService singleton proxy.
 * Throws if not initialized.
 */
export { configService };

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] ?? {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
