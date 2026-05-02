/**
 * Lazy memoized factories for dscli command implementations.
 *
 * Each factory returns the same instance on repeated calls within one CLI
 * invocation. Commands import only the factories they need — `dscli ha state`
 * never pays the cost of constructing the content registry.
 *
 * To add a new factory: declare a module-level cache var, write an exported
 * async function that initializes once, and wire any cross-cutting deps from
 * the existing factories.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { initConfigService, getConfigService as getInstance, resetConfigService } from '#system/config/index.mjs';
import { HttpClient } from '#system/services/HttpClient.mjs';

const _isDocker = existsSync('/.dockerenv');

let _configService = null;
let _configInitPromise = null;
let _httpClient = null;

/**
 * Resolve the data directory the same way backend/index.js does:
 *   - /usr/src/app/data inside Docker (/.dockerenv present)
 *   - $DAYLIGHT_BASE_PATH/data otherwise
 */
function resolveDataDir() {
  if (_isDocker) {
    return '/usr/src/app/data';
  }
  return path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
}

/**
 * Get the initialized ConfigService singleton.
 * Initializes from DAYLIGHT_BASE_PATH on first call; subsequent calls return
 * the same instance.
 *
 * @returns {Promise<import('#system/config/ConfigService.mjs').ConfigService>}
 */
export async function getConfigService() {
  if (_configService) return _configService;
  if (_configInitPromise) return _configInitPromise;

  if (!_isDocker && !process.env.DAYLIGHT_BASE_PATH) {
    throw new Error(
      'DAYLIGHT_BASE_PATH not set. ' +
      'Set DAYLIGHT_BASE_PATH to the directory containing data/ and media/.'
    );
  }

  _configInitPromise = (async () => {
    try {
      // If a previous init left the singleton populated, reuse it.
      _configService = getInstance();
      return _configService;
    } catch {
      // Not initialized yet — do it now.
      const dataDir = resolveDataDir();
      _configService = await initConfigService(dataDir);
      return _configService;
    }
  })();

  return _configInitPromise;
}

/**
 * Get a memoized HTTP client.
 *
 * The returned object exposes the full IHttpClient API (get, post, put,
 * delete, downloadBuffer, postForm) plus a generic `request(method, url,
 * body, options)` dispatcher for callers that prefer a single entry point.
 *
 * @returns {{ request: Function, get: Function, post: Function, put: Function, delete: Function }}
 */
export function getHttpClient() {
  if (_httpClient) return _httpClient;

  const inner = new HttpClient();

  _httpClient = {
    get: inner.get.bind(inner),
    post: inner.post.bind(inner),
    put: inner.put.bind(inner),
    delete: inner.delete.bind(inner),
    downloadBuffer: inner.downloadBuffer.bind(inner),
    postForm: inner.postForm.bind(inner),
    /**
     * Generic dispatcher.
     * @param {string} method - HTTP verb (GET, POST, PUT, DELETE)
     * @param {string} url
     * @param {any} [body]
     * @param {object} [options]
     */
    request(method, url, body, options = {}) {
      const m = method.toLowerCase();
      if (m === 'get' || m === 'delete') {
        return inner[m](url, options);
      }
      return inner[m](url, body, options);
    },
  };

  return _httpClient;
}

/**
 * Reset all memoized state. For tests only.
 */
export function _resetForTests() {
  _configService = null;
  _configInitPromise = null;
  _httpClient = null;
  resetConfigService();
}
