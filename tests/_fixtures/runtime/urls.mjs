// tests/_fixtures/runtime/urls.mjs
/**
 * Runtime Test URL Configuration
 *
 * Reads port configuration from system YAML (SSOT).
 * Environment variables can override for CI/special environments.
 *
 * Usage:
 *   import { FRONTEND_URL, BACKEND_URL, WS_URL, getWsUrl } from '#fixtures/runtime/urls.mjs';
 */

import { getTestUrls } from '#testlib/configHelper.mjs';

// Load URLs from system config
const urls = getTestUrls();

// Frontend URL - where the frontend is served (Vite in dev, backend in prod)
// Can be overridden via TEST_FRONTEND_URL env var
export const FRONTEND_URL = process.env.TEST_FRONTEND_URL || urls.frontend;

// Backend API URL - for direct API calls (bypassing frontend proxy)
// Can be overridden via TEST_BACKEND_URL env var
export const BACKEND_URL = process.env.TEST_BACKEND_URL || urls.backend;

// WebSocket URL - derived from frontend URL
// Can be overridden via TEST_WS_URL env var
export const WS_URL = process.env.TEST_WS_URL || urls.ws;

/**
 * Get WebSocket URL from a base URL
 * @param {string} baseUrl - HTTP base URL
 * @returns {string} WebSocket URL
 */
export function getWsUrl(baseUrl = FRONTEND_URL) {
  return baseUrl.replace(/^http/, 'ws') + '/ws';
}

/**
 * Get all URLs as an object (useful for logging)
 */
export { getTestUrls };
