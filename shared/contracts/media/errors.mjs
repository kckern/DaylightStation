export const ERROR_CODES = Object.freeze({
  CONTENT_NOT_FOUND: 'CONTENT_NOT_FOUND',
  SEARCH_TEXT_TOO_SHORT: 'SEARCH_TEXT_TOO_SHORT',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  DEVICE_REFUSED: 'DEVICE_REFUSED',
  DEVICE_BUSY: 'DEVICE_BUSY',
  WAKE_FAILED: 'WAKE_FAILED',
  ATOMICITY_VIOLATION: 'ATOMICITY_VIOLATION',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
});

export function buildErrorBody({ error, code, details, retryable } = {}) {
  const body = { ok: false, error: String(error ?? 'Unknown error') };
  if (code) body.code = code;
  if (Array.isArray(details) && details.length) body.details = details;
  if (typeof retryable === 'boolean') body.retryable = retryable;
  return body;
}
