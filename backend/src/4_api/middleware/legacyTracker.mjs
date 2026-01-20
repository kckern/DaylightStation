/**
 * Legacy Route Hit Tracker
 *
 * Middleware that tracks hits to legacy routes.
 * Used to monitor when it's safe to delete legacy code.
 *
 * Usage:
 *   const tracker = createLegacyTracker();
 *   app.use('/data', tracker.middleware, fetchRouter);
 *   app.use('/harvest', tracker.middleware, harvestRouter);
 *   // Later:
 *   const hits = tracker.getHits();
 *
 * @module legacyTracker
 */

/**
 * Create a legacy route hit tracker
 * @param {Object} [options]
 * @param {Object} [options.logger] - Logger instance
 * @returns {Object} Tracker with middleware and getHits functions
 */
export function createLegacyTracker(options = {}) {
  const { logger = console } = options;

  // Track hits per route prefix
  const hits = new Map();

  // Track first and last hit times
  const firstHit = new Map();
  const lastHit = new Map();

  /**
   * Middleware that tracks legacy route hits
   */
  const middleware = (req, res, next) => {
    // Extract route prefix (e.g., /data, /harvest)
    const prefix = '/' + req.baseUrl.split('/').filter(Boolean)[0];
    const now = new Date().toISOString();

    // Increment hit count
    hits.set(prefix, (hits.get(prefix) || 0) + 1);

    // Track first hit
    if (!firstHit.has(prefix)) {
      firstHit.set(prefix, now);
    }

    // Track last hit
    lastHit.set(prefix, now);

    // Log the hit (debug level to avoid noise)
    if (logger.debug) {
      logger.debug('legacy.route.hit', {
        prefix,
        path: req.path,
        method: req.method,
        hitCount: hits.get(prefix)
      });
    }

    next();
  };

  /**
   * Get hit statistics
   * @returns {Object} Hit statistics by route prefix
   */
  const getHits = () => {
    const stats = {};
    for (const [prefix, count] of hits) {
      stats[prefix] = {
        hits: count,
        firstHit: firstHit.get(prefix),
        lastHit: lastHit.get(prefix)
      };
    }
    return stats;
  };

  /**
   * Get total hit count across all legacy routes
   * @returns {number}
   */
  const getTotalHits = () => {
    let total = 0;
    for (const count of hits.values()) {
      total += count;
    }
    return total;
  };

  /**
   * Reset all hit counters
   */
  const reset = () => {
    hits.clear();
    firstHit.clear();
    lastHit.clear();
  };

  /**
   * Check if any legacy routes have been hit
   * @returns {boolean}
   */
  const hasHits = () => hits.size > 0;

  return {
    middleware,
    getHits,
    getTotalHits,
    reset,
    hasHits
  };
}

// Singleton instance for use across the app
let globalTracker = null;

/**
 * Get or create the global legacy tracker instance
 * @param {Object} [options]
 * @returns {Object} Global tracker instance
 */
export function getLegacyTracker(options) {
  if (!globalTracker) {
    globalTracker = createLegacyTracker(options);
  }
  return globalTracker;
}
