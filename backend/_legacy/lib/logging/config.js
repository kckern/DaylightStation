/**
 * Logging Configuration - Legacy Re-export Shim
 *
 * MIGRATION: This file re-exports from the new infrastructure location.
 * Once all consumers are migrated, this file can be deleted.
 */

export {
  loadLoggingConfig,
  resetLoggingConfig,
  resolveLoggerLevel,
  getLoggingTags,
  resolveLogglyToken,
  resolveLogglySubdomain,
  hydrateProcessEnvFromConfigs
} from '../../../src/0_infrastructure/logging/config.js';

export { default } from '../../../src/0_infrastructure/logging/config.js';
