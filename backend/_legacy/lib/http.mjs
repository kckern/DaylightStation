import axios from 'axios';
import { createLogger } from './logging/logger.js';

const httpLogger = createLogger({
  source: 'backend',
  app: 'http'
});

// Build a concise, 1-2 line description of an axios error
export function formatAxiosError(error) {
  try {
    const cfg = error?.config || {};
    const method = (cfg.method || 'GET').toUpperCase();
    const url = (cfg.baseURL ? cfg.baseURL.replace(/\/$/, '') : '') + (cfg.url || '');

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

export default axios;
