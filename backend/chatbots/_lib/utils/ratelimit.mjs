/**
 * Token bucket rate limiter
 * @module _lib/utils/ratelimit
 */

/**
 * Token bucket rate limiter
 */
export class RateLimiter {
  /**
   * @param {object} options - Rate limiter options
   * @param {number} options.tokensPerInterval - Number of tokens added per interval
   * @param {number} options.interval - Interval in milliseconds
   * @param {number} [options.maxTokens] - Maximum tokens (bucket size), defaults to tokensPerInterval
   */
  constructor(options) {
    this.tokensPerInterval = options.tokensPerInterval;
    this.interval = options.interval;
    this.maxTokens = options.maxTokens ?? options.tokensPerInterval;
    
    // Current state
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time
   */
  #refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = (elapsed / this.interval) * this.tokensPerInterval;
    
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Try to acquire tokens without blocking
   * @param {number} [cost=1] - Number of tokens to acquire
   * @returns {boolean} - True if tokens were acquired
   */
  tryAcquire(cost = 1) {
    this.#refill();
    
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    
    return false;
  }

  /**
   * Wait for tokens to become available
   * @param {number} [cost=1] - Number of tokens to acquire
   * @param {number} [timeoutMs=30000] - Maximum wait time
   * @returns {Promise<boolean>} - True if tokens were acquired
   */
  async waitForToken(cost = 1, timeoutMs = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (this.tryAcquire(cost)) {
        return true;
      }
      
      // Calculate wait time until next token
      const tokensNeeded = cost - this.tokens;
      const waitTime = Math.min(
        (tokensNeeded / this.tokensPerInterval) * this.interval,
        100 // Check at least every 100ms
      );
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    return false;
  }

  /**
   * Get remaining tokens
   * @returns {number}
   */
  getRemaining() {
    this.#refill();
    return Math.floor(this.tokens);
  }

  /**
   * Reset the rate limiter
   */
  reset() {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }
}

/**
 * Rate limiter registry for managing multiple limiters
 */
export class RateLimiterRegistry {
  constructor() {
    /** @type {Map<string, RateLimiter>} */
    this.limiters = new Map();
  }

  /**
   * Register a rate limiter
   * @param {string} key - Limiter key
   * @param {object} options - Rate limiter options
   * @returns {RateLimiter}
   */
  register(key, options) {
    const limiter = new RateLimiter(options);
    this.limiters.set(key, limiter);
    return limiter;
  }

  /**
   * Get or create a rate limiter
   * @param {string} key - Limiter key
   * @param {object} [defaultOptions] - Default options if creating
   * @returns {RateLimiter|undefined}
   */
  get(key, defaultOptions) {
    if (!this.limiters.has(key) && defaultOptions) {
      return this.register(key, defaultOptions);
    }
    return this.limiters.get(key);
  }

  /**
   * Try to acquire tokens from a limiter
   * @param {string} key - Limiter key
   * @param {number} [cost=1] - Number of tokens
   * @returns {boolean}
   */
  tryAcquire(key, cost = 1) {
    const limiter = this.limiters.get(key);
    return limiter ? limiter.tryAcquire(cost) : true;
  }

  /**
   * Get remaining tokens for a limiter
   * @param {string} key - Limiter key
   * @returns {number}
   */
  getRemaining(key) {
    const limiter = this.limiters.get(key);
    return limiter ? limiter.getRemaining() : Infinity;
  }

  /**
   * Clear all limiters
   */
  clear() {
    this.limiters.clear();
  }
}

/**
 * Create a rate limiter for a specific use case
 * @param {number} callsPerMinute - Calls allowed per minute
 * @returns {RateLimiter}
 */
export function createPerMinuteLimiter(callsPerMinute) {
  return new RateLimiter({
    tokensPerInterval: callsPerMinute,
    interval: 60000, // 1 minute
    maxTokens: callsPerMinute,
  });
}

/**
 * Create a rate limiter for a specific use case
 * @param {number} callsPerSecond - Calls allowed per second
 * @returns {RateLimiter}
 */
export function createPerSecondLimiter(callsPerSecond) {
  return new RateLimiter({
    tokensPerInterval: callsPerSecond,
    interval: 1000, // 1 second
    maxTokens: callsPerSecond,
  });
}

/**
 * Global rate limiter registry
 */
export const globalRegistry = new RateLimiterRegistry();

export default {
  RateLimiter,
  RateLimiterRegistry,
  createPerMinuteLimiter,
  createPerSecondLimiter,
  globalRegistry,
};
