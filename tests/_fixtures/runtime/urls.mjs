// tests/_fixtures/runtime/urls.mjs
/**
 * Runtime Test URL Configuration
 *
 * All URLs point to the app port - same topology as prod.
 * Tests don't know about internal backend port.
 */

import { getAppPort, getTestUrls } from '#testlib/configHelper.mjs';

// Load URLs from system config
const urls = getTestUrls();

// All URLs point to the public-facing app port
// In dev: Vite proxies API calls to backend
// In prod: Backend serves everything
export const FRONTEND_URL = process.env.TEST_FRONTEND_URL || urls.frontend;
export const BACKEND_URL = process.env.TEST_BACKEND_URL || urls.backend;
export const WS_URL = process.env.TEST_WS_URL || urls.ws;

/**
 * Get WebSocket URL from a base URL
 */
export function getWsUrl(baseUrl = FRONTEND_URL) {
  return baseUrl.replace(/^http/, 'ws') + '/ws';
}

export { getAppPort, getTestUrls };
