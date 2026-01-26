/**
 * Log Ingestion - Legacy Re-export Shim
 *
 * MIGRATION: This file re-exports from the new infrastructure location.
 * Once all consumers are migrated, this file can be deleted.
 */

export { ingestFrontendLogs } from '../../../src/0_system/logging/ingestion.js';
export { default } from '../../../src/0_system/logging/ingestion.js';
