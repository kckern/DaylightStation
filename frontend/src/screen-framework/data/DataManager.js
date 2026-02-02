/**
 * DataManager - Handles data fetching, caching, and subscriptions
 *
 * Widgets declare data sources in config. DataManager handles:
 * - Initial fetch on mount
 * - Periodic refresh based on interval
 * - Caching to avoid duplicate requests
 * - WebSocket subscriptions (future)
 */
export class DataManager {
  constructor() {
    this.cache = new Map();
    this.subscriptions = new Map();
    this.intervals = new Map();
  }

  /**
   * Fetch data from a source
   * @param {string} source - API endpoint
   * @returns {Promise<*>} Fetched data
   */
  async fetch(source) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${source}: ${response.status}`);
    }
    const data = await response.json();
    this.cache.set(source, { data, timestamp: Date.now() });
    return data;
  }

  /**
   * Get cached data for a source
   * @param {string} source - API endpoint
   * @returns {*|null} Cached data or null
   */
  getCached(source) {
    const cached = this.cache.get(source);
    return cached ? cached.data : null;
  }

  /**
   * Subscribe to a data source with optional refresh
   * @param {string} source - API endpoint
   * @param {Function} callback - Called with data on each fetch
   * @param {Object} options - { refreshInterval: ms }
   * @returns {Function} Unsubscribe function
   */
  subscribe(source, callback, options = {}) {
    const { refreshInterval } = options;

    // Track subscription
    if (!this.subscriptions.has(source)) {
      this.subscriptions.set(source, new Set());
    }
    this.subscriptions.get(source).add(callback);

    // Initial fetch
    this.fetch(source)
      .then(data => callback(data))
      .catch(err => console.error(`DataManager fetch error: ${source}`, err));

    // Set up refresh interval if specified
    if (refreshInterval && !this.intervals.has(source)) {
      const intervalId = setInterval(() => {
        this.fetch(source)
          .then(data => {
            const subscribers = this.subscriptions.get(source);
            if (subscribers) {
              subscribers.forEach(cb => cb(data));
            }
          })
          .catch(err => console.error(`DataManager refresh error: ${source}`, err));
      }, refreshInterval);
      this.intervals.set(source, intervalId);
    }

    // Return unsubscribe function
    return () => {
      const subscribers = this.subscriptions.get(source);
      if (subscribers) {
        subscribers.delete(callback);
        // Clean up interval if no more subscribers
        if (subscribers.size === 0) {
          const intervalId = this.intervals.get(source);
          if (intervalId) {
            clearInterval(intervalId);
            this.intervals.delete(source);
          }
          this.subscriptions.delete(source);
        }
      }
    };
  }

  /**
   * Clear all subscriptions and intervals
   */
  destroy() {
    this.intervals.forEach(intervalId => clearInterval(intervalId));
    this.intervals.clear();
    this.subscriptions.clear();
    this.cache.clear();
  }
}

// Singleton instance
let defaultManager = null;

export function getDataManager() {
  if (!defaultManager) {
    defaultManager = new DataManager();
  }
  return defaultManager;
}

export function resetDataManager() {
  if (defaultManager) {
    defaultManager.destroy();
  }
  defaultManager = null;
}
