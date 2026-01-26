/**
 * Logging Utilities - Legacy Re-export Shim
 *
 * MIGRATION: This file re-exports from the new infrastructure location.
 * Once all consumers are migrated, this file can be deleted.
 */

export { serializeError, extractHttpErrorDetails } from '../../../src/0_system/logging/utils.js';
