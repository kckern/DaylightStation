/**
 * LogDispatcher - Legacy Re-export Shim
 *
 * MIGRATION: This file re-exports from the new infrastructure location.
 * Once all consumers are migrated, this file can be deleted.
 */

export {
  LogDispatcher,
  LEVEL_PRIORITY,
  getDispatcher,
  isLoggingInitialized,
  initializeLogging,
  resetLogging
} from '../../../src/0_infrastructure/logging/dispatcher.js';

export { default } from '../../../src/0_infrastructure/logging/dispatcher.js';
