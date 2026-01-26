/**
 * HTTP Client - Legacy Re-export Shim
 *
 * MIGRATION: This file re-exports from the new location.
 * Import from '#backend/src/0_system/http/httpClient.mjs' instead.
 *
 * Example:
 *   // Old (deprecated):
 *   import axios from '#backend/_legacy/lib/http.mjs';
 *
 *   // New (preferred):
 *   import axios from '#backend/src/0_system/http/httpClient.mjs';
 */

export * from '../../src/0_system/http/httpClient.mjs';
export { default } from '../../src/0_system/http/httpClient.mjs';
