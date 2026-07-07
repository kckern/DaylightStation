// backend/src/0_system/utils/errors/vendorError.mjs
const CODE_MAP = { 400: 'INVALID_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 429: 'RATE_LIMITED', 500: 'SERVICE_ERROR', 502: 'SERVICE_UNAVAILABLE', 503: 'SERVICE_UNAVAILABLE', 504: 'SERVICE_UNAVAILABLE' };

export function isTransientStatus(err) {
  if (err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' || err?.code === 'ECONNREFUSED') return true;
  const s = err?.status ?? err?.response?.status;
  return s === 429 || (s >= 500 && s <= 599);
}

/**
 * Wrap a vendor/HTTP error into a generic error safe to throw upward.
 * Vendor specifics belong in the adapter's log line, not in this error.
 * @param {Object} err - caught vendor error ({status?, code?, message?})
 * @param {Object} ctx - { op } operation name for the message
 */
export function translateVendorError(err, { op = 'request' } = {}) {
  const status = err?.status ?? err?.response?.status;
  const wrapped = new Error(`Operation failed: ${op}`);
  wrapped.code = CODE_MAP[status] || (err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' ? 'NETWORK_ERROR' : 'UNKNOWN_ERROR');
  wrapped.isTransient = isTransientStatus(err);
  wrapped.status = status;
  return wrapped;
}
