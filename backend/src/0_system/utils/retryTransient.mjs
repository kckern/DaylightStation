/**
 * Retry a function on transient errors with exponential backoff.
 *
 * Only retries when error.isTransient === true (e.g. HttpError from
 * network timeouts, connection resets, 429s, 5xx).
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
      if (!error.isTransient || isLast) {
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
