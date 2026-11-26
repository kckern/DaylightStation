/**
 * HTTP Client - Centralized Axios instance with logging interceptors
 *
 * Provides a pre-configured axios instance with:
 * - Request timing (elapsed time on errors)
 * - Error formatting with concise, structured messages
 * - Automatic logging of failed requests
 *
 * Usage:
 *   import axios from '#backend/src/0_system/http/httpClient.mjs';
 *   // or
 *   import { httpClient, formatAxiosError } from '#backend/src/0_system/http/index.mjs';
 */

import axios from 'axios';
import { createLogger } from '../logging/logger.mjs';

const httpLogger = createLogger({
  source: 'backend',
  app: 'http'
});

/**
 * Build a concise, 1-2 line description of an axios error
 * @param {Error} error - Axios error object
 * @returns {string} Formatted error message
 */
/** Query parameters whose values are credentials: never written to a log. */
const SECRET_PARAMS = /^(password|passwd|pass|pw|token|access_token|refresh_token|x-plex-token|api_?key|apikey|key|secret|client_secret|signature|sig|auth|authorization)$/i;

/** {@code url} with the values of credential parameters replaced by ***; unchanged otherwise. */
export function redactUrl(url) {
  if (typeof url !== 'string' || !url.includes('?')) return url;
  const q = url.indexOf('?');
  const [query, hash = null] = url.slice(q + 1).split('#');
  const kept = query.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return pair;
    let name = pair.slice(0, eq);
    try { name = decodeURIComponent(name); } catch { /* keep as written */ }
    return SECRET_PARAMS.test(name) ? `${pair.slice(0, eq)}=***` : pair;
  });
  return `${url.slice(0, q)}?${kept.join('&')}${hash === null ? '' : `#${hash}`}`;
}

export function formatAxiosError(error) {
  try {
    const cfg = error?.config || {};
    const method = (cfg.method || 'GET').toUpperCase();
    // Credentials in a query string (a kiosk's password, a token) never reach the log store.
    const url = redactUrl((cfg.baseURL ? cfg.baseURL.replace(/\/$/, '') : '') + (cfg.url || ''));

    const res = error?.response;
    const status = res?.status;
    const statusText = res?.statusText;
    const code = error?.code;

    const rid = res?.headers?.['x-request-id'] || res?.headers?.['x-correlation-id'] || cfg.headers?.['x-request-id'];

    const started = cfg?.metadata?.startTime || 0;
    const elapsed = started ? `${Date.now() - started}ms` : undefined;

    let msg = '';
    const data = res?.data;
    if (typeof data === 'string') {
      msg = data.trim();
    } else if (data && typeof data === 'object') {
      // Try a few common fields or fallback to a compact JSON snippet
      msg = data.message || data.error || data.error_message || data.description || JSON.stringify(data);
    } else if (error?.message) {
      msg = error.message;
    }
    msg = (msg || '').replace(/\s+/g, ' ').slice(0, 200);

    const parts = [
      method && url ? `${method} ${url}` : url || method || 'REQUEST',
      status ? `-> ${status}${statusText ? ' ' + statusText : ''}` : (code ? `-> ${code}` : ''),
      elapsed ? `(${elapsed})` : '',
      msg ? `- ${msg}` : '',
      rid ? `(req id: ${rid})` : ''
    ].filter(Boolean);

    return parts.join(' ');
  } catch (_) {
    // In case formatting fails, fallback
    return error?.message || 'HTTP request failed';
  }
}

// Attach interceptors once for the default axios instance
let interceptorsInstalled = false;
function ensureInterceptors() {
  if (interceptorsInstalled) return;
  interceptorsInstalled = true;

  axios.interceptors.request.use((config) => {
    // Record start time to compute elapsed on error
    config.metadata = config.metadata || {};
    config.metadata.startTime = Date.now();
    return config;
  });

  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      // Build a short, single-line log and attach to the error
      const line = formatAxiosError(error);
      // Prefer warn to reduce noise level while still surfacing
      httpLogger.warn('http.request.failed', { message: line });
      error.shortMessage = line;
      return Promise.reject(error);
    }
  );
}

ensureInterceptors();

/**
 * Pre-configured axios instance with logging interceptors
 */
export const httpClient = axios;

export default axios;
