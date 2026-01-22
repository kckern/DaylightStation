/**
 * DEPRECATED: Legacy Config Re-export Shim
 *
 * This module re-exports from the new location for backwards compatibility.
 * All new code should import from:
 *   #backend/src/0_infrastructure/config/index.mjs
 *
 * This shim will be removed in a future release.
 */

console.warn(
  '[DEPRECATION] Importing from #backend/_legacy/lib/config is deprecated.\n' +
  'Update imports to: #backend/src/0_infrastructure/config/index.mjs'
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
} from '../../../src/0_infrastructure/config/index.mjs';

export { default } from '../../../src/0_infrastructure/config/index.mjs';
