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
 * @param {number} [options.maxElapsedMs=Infinity] - Overall budget. No further
 *   attempt is STARTED once this much time has passed since the first one, even
 *   if attempts remain. It bounds the retrying, not a single call: the attempt
 *   already in flight still runs to its own timeout, so the true ceiling is
 *   `maxElapsedMs` plus one attempt. A caller that needs a hard wall-clock cap
 *   has to put a timeout on `fn` as well — which every HTTP caller here does.
 * @param {number} [options.jitter=0] - Fraction of the computed delay to vary
 *   it by, +/-, in [0, 1). 0.25 spreads a 4s delay over 3-5s. Without it a
 *   burst of concurrent callers that failed together retries in lockstep and
 *   re-creates the pile-up it is backing off from.
 * @param {() => number} [options.now=Date.now] - Injectable clock, for tests.
 * @param {(attempt: number, error: Error) => void} [options.onRetry] - Called before each retry
 * @param {(info: {attempts: number, elapsedMs: number, error: Error}) => void} [options.onBudgetExhausted]
 *   Called when the budget, rather than the attempt count, ends the retrying.
 * @returns {Promise<T>}
 */
export async function retryTransient(fn, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelay = options.baseDelay ?? 1000;
  const maxElapsedMs = options.maxElapsedMs ?? Infinity;
  const jitter = Math.min(Math.max(options.jitter ?? 0, 0), 0.999);
  const now = options.now ?? Date.now;
  const startedAt = now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt === maxAttempts;
      if (!isTransientError(error) || isLast) {
        throw error;
      }

      const spread = jitter ? 1 + (Math.random() * 2 - 1) * jitter : 1;
      const delay = Math.round(baseDelay * Math.pow(2, attempt - 1) * spread);

      // Checked BEFORE sleeping, and against the moment the next attempt would
      // START — a budget that only stops us after the sleep has already been
      // paid for is a budget that overruns by a whole backoff step.
      const elapsedMs = now() - startedAt;
      if (elapsedMs + delay >= maxElapsedMs) {
        options.onBudgetExhausted?.({ attempts: attempt, elapsedMs, error });
        throw error;
      }

      if (options.onRetry) {
        options.onRetry(attempt, error);
      }

      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
}
