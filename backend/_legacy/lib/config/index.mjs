/**
 * DEPRECATED: Legacy Config Re-export Shim
 *
 * This module re-exports from the new location for backwards compatibility.
 * All new code should import from:
 *   #backend/src/0_system/config/index.mjs
 *
 * This shim will be removed in a future release.
 */

console.warn(
  '[DEPRECATION] Importing from #backend/_legacy/lib/config is deprecated.\n' +
  'Update imports to: #backend/src/0_system/config/index.mjs'
);

export {
  ConfigService,
  configService,
  createConfigService,
  initConfigService,
  getConfigService,
  resetConfigService,
  createTestConfigService,
  ConfigValidationError,
  configSchema,
  loadConfig,
  validateConfig
} from '../../../src/0_system/config/index.mjs';

import { configService as _configService } from '../../../src/0_system/config/index.mjs';

// Hydrate process.env with config values for legacy code compatibility.
// Legacy code uses patterns like process.env.path.data, process.env.tv.host, etc.
// This is a temporary compat layer - legacy code should migrate to ConfigService.
const safeConfig = _configService.getSafeConfig?.() || {};
const systemConfig = safeConfig.system || {};

// Spread all system config keys into process.env for legacy compatibility
for (const [key, value] of Object.entries(systemConfig)) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    process.env[key] = value;
  }
}

// NOTE: process.env.path is set by the main config module via Object.defineProperty
// This ensures legacy code using process.env.path.data still works.
// The main module sets individual DAYLIGHT_*_PATH env vars as a fallback.

export { default } from '../../../src/0_system/config/index.mjs';
