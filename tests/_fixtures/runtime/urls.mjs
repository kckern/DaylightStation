// tests/_fixtures/runtime/urls.mjs
/**
 * Runtime Test URL Configuration
 *
 * Provides consistent URL configuration for Playwright runtime tests.
 * Uses environment variables with sensible defaults matching playwright.config.js.
 *
 * Usage:
 *   import { FRONTEND_URL, BACKEND_URL, WS_URL, getWsUrl } from '#fixtures/runtime/urls.mjs';
 */

// Frontend URL - where the built frontend is served
// Default matches playwright.config.js baseURL
export const FRONTEND_URL = process.env.TEST_FRONTEND_URL || 'http://localhost:3111';

// Backend API URL - for direct API calls (bypassing frontend)
// Default is the dev server port
export const BACKEND_URL = process.env.TEST_BACKEND_URL || 'http://localhost:3112';

// WebSocket URL - derived from frontend URL by default
export const WS_URL = process.env.TEST_WS_URL || FRONTEND_URL.replace(/^http/, 'ws') + '/ws';

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
export function getTestUrls() {
  return {
    frontend: FRONTEND_URL,
    backend: BACKEND_URL,
    ws: WS_URL
  };
}
