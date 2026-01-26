/**
 * Transport barrel file - Legacy Re-export Shim
 *
 * MIGRATION: This file re-exports from the new infrastructure location.
 * Once all consumers are migrated, this file can be deleted.
 */

export { createConsoleTransport } from '../../../../src/0_system/logging/transports/console.js';
export { createLogglyTransport } from '../../../../src/0_system/logging/transports/loggly.js';
export { createFileTransport } from '../../../../src/0_system/logging/transports/file.js';
