/**
 * Retry utility with exponential backoff
 * @module _lib/utils/retry
 */

import { isRetryableError } from '../errors/index.mjs';

/**
 * Default retry options
 */
const DEFAULT_OPTIONS = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  shouldRetry: isRetryableError,
};

/**
 * Calculate delay with exponential backoff and jitter
 * @param {number} attempt - Current attempt (0-based)
 * @param {object} options - Retry options
 * @returns {number} - Delay in milliseconds
 */
function calculateDelay(attempt, options) {
  const { initialDelayMs, maxDelayMs, backoffMultiplier, jitterFactor } = options;
  
  // Exponential backoff
  let delay = initialDelayMs * Math.pow(backoffMultiplier, attempt);
  
  // Apply max cap
  delay = Math.min(delay, maxDelayMs);
  
  // Add jitter (±jitterFactor)
  const jitter = delay * jitterFactor * (Math.random() * 2 - 1);
  delay = Math.round(delay + jitter);
  
  return Math.max(0, delay);
}

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 * @template T
 * @param {() => Promise<T>} fn - Async function to retry
 * @param {object} [options] - Retry options
 * @param {number} [options.maxAttempts=3] - Maximum number of attempts
 * @param {number} [options.initialDelayMs=1000] - Initial delay in milliseconds
 * @param {number} [options.maxDelayMs=30000] - Maximum delay in milliseconds
 * @param {number} [options.backoffMultiplier=2] - Backoff multiplier
 * @param {number} [options.jitterFactor=0.1] - Jitter factor (0-1)
 * @param {(error: Error) => boolean} [options.shouldRetry] - Function to determine if error is retryable
 * @param {(attempt: number, error: Error, delayMs: number) => void} [options.onRetry] - Callback on retry
 * @returns {Promise<T>}
 */
export async function retry(fn, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  let lastError;
  
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (!opts.shouldRetry(error)) {
        throw error;
      }
      
      // Check if this was the last attempt
      if (attempt >= opts.maxAttempts - 1) {
        throw error;
      }
      
      // Calculate delay
      const delayMs = calculateDelay(attempt, opts);
      
      // Call onRetry callback if provided
      if (opts.onRetry) {
        opts.onRetry(attempt + 1, error, delayMs);
      }
      
      // Wait before retrying
      await sleep(delayMs);
    }
  }
  
  throw lastError;
}

/**
 * Create a retry wrapper for a function
 * @template T
 * @param {() => Promise<T>} fn - Async function to wrap
 * @param {object} [options] - Retry options
 * @returns {() => Promise<T>}
 */
export function withRetry(fn, options = {}) {
  return () => retry(fn, options);
}

/**
 * Create a retry decorator
 * @param {object} [options] - Retry options
 * @returns {function} - Decorator function
 */
export function retryable(options = {}) {
  return function decorator(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args) {
      return retry(() => originalMethod.apply(this, args), options);
    };
    
    return descriptor;
  };
}

export default {
  retry,
  withRetry,
  retryable,
};
