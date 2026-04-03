// Raw error codes that indicate transient network issues (DNS, connection, timeout)
const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED',
  'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH'
]);

/**
 * Check if an error is transient (retryable).
 * Supports both HttpError (isTransient flag) and raw network errors (code check).
 */
function isTransientError(error) {
  if (error.isTransient) return true;
  // Raw axios/node errors carry code on error or error.cause
  const code = error.code || error.cause?.code;
  if (code && TRANSIENT_CODES.has(code)) return true;
  return false;
}

/**
 * Retry a function on transient errors with exponential backoff.
 *
 * Retries when error.isTransient === true (HttpError from network timeouts,
 * connection resets, 429s, 5xx) OR when the raw error code indicates a
 * transient network issue (EAI_AGAIN, ECONNRESET, etc.).
 *
 * @param {() => Promise<T>} fn - Async function to execute
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=3] - Total attempts (1 = no retry)
 * @param {number} [options.baseDelay=1000] - Base delay in ms (doubles each retry)
 * @param {(attempt: number, error: Error) => void} [options.onRetry] - Called before each retry
 * @returns {Promise<T>}
 */
export async function retryTransient(fn, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelay = options.baseDelay ?? 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt === maxAttempts;
      if (!isTransientError(error) || isLast) {
        throw error;
      }

      if (options.onRetry) {
        options.onRetry(attempt, error);
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
}
