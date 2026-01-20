/**
 * Logger Factory
 * 
 * Creates contextualized logger instances that dispatch to the central LogDispatcher.
 * Provides a clean interface for application code to emit structured log events.
 */

import os from 'os';
import moment from 'moment-timezone';
import { getDispatcher, isLoggingInitialized } from './dispatcher.js';
import { configService } from '../config/index.mjs';

const hostname = os.hostname();

/**
 * Create a logger instance with preset context
 * @param {Object} options
 * @param {string} options.source - 'frontend' | 'backend' | 'cron' | 'webhook'
 * @param {string} options.app - Application/module name
 * @param {Object} options.context - Additional context fields
 * @returns {Object} Logger instance with debug, info, warn, error, child methods
 */
export function createLogger({ source = 'backend', app = 'default', context = {} } = {}) {
  const baseContext = {
    source,
    app,
    host: hostname,
    ...context
  };

  // Sampling state for rate-limited logging
  const samplingState = new Map();
  const WINDOW_MS = 60_000;

  /**
   * Internal log function
   * @param {string} level - 'debug' | 'info' | 'warn' | 'error'
   * @param {string} event - Dot-notation event name
   * @param {Object} data - Structured payload
   * @param {Object} options - { message?, context?, tags? }
   */
  const log = (level, event, data = {}, options = {}) => {
    // Handle case where dispatcher isn't initialized yet
    // (e.g., during early startup or in tests)
    if (!isLoggingInitialized()) {
      // Fallback to console
      const fallbackMsg = `[${level.toUpperCase()}] ${event} ${JSON.stringify(data)}`;
      if (level === 'error' || level === 'warn') {
        process.stderr.write(fallbackMsg + '\n');
      } else {
        process.stdout.write(fallbackMsg + '\n');
      }
      return;
    }

    const dispatcher = getDispatcher();
    
    let timestamp;
    try {
      if (configService && typeof configService.isReady === 'function' && configService.isReady()) {
        const tz = configService.getHouseholdTimezone ? configService.getHouseholdTimezone() : 'UTC';
        timestamp = moment().tz(tz).format();
      }
    } catch (err) {
      // Fallback to UTC if config is not ready or throws
      // Do not log the error here as it would cause an infinite loop
    }
    
    if (!timestamp) {
      timestamp = new Date().toISOString();
    }

    dispatcher.dispatch({
      ts: timestamp,
      level,
      event,
      message: options.message,
      data,
      context: { ...baseContext, ...options.context },
      tags: options.tags || []
    });
  };

  return {
    /**
     * Log a debug-level event
     * @param {string} event - Event name
     * @param {Object} data - Event data
     * @param {Object} opts - Options { message?, context?, tags? }
     */
    debug: (event, data, opts) => log('debug', event, data, opts),
    
    /**
     * Log an info-level event
     * @param {string} event - Event name
     * @param {Object} data - Event data
     * @param {Object} opts - Options { message?, context?, tags? }
     */
    info: (event, data, opts) => log('info', event, data, opts),
    
    /**
     * Log a warn-level event
     * @param {string} event - Event name
     * @param {Object} data - Event data
     * @param {Object} opts - Options { message?, context?, tags? }
     */
    warn: (event, data, opts) => log('warn', event, data, opts),
    
    /**
     * Log an error-level event
     * @param {string} event - Event name
     * @param {Object} data - Event data
     * @param {Object} opts - Options { message?, context?, tags? }
     */
    error: (event, data, opts) => log('error', event, data, opts),
    
    /**
     * Generic log method with explicit level
     * @param {string} level - 'debug' | 'info' | 'warn' | 'error'
     * @param {string} event - Event name
     * @param {Object} data - Event data
     * @param {Object} opts - Options { message?, context?, tags? }
     */
    log: (level, event, data, opts) => log(level, event, data, opts),
    
    /**
     * Create a child logger with additional context
     * @param {Object} childContext - Context to merge with parent
     * @returns {Object} New logger instance
     */
    child(childContext) {
      return createLogger({
        source,
        app,
        context: { ...baseContext, ...childContext }
      });
    },

    /**
     * Get the current context for this logger
     * @returns {Object}
     */
    getContext() {
      return { ...baseContext };
    },

    /**
     * Log with rate limiting and aggregation
     * @param {string} event - Event name
     * @param {Object} data - Event data
     * @param {Object} options - { maxPerMinute?: number, aggregate?: boolean }
     */
    sampled(event, data = {}, options = {}) {
      const { maxPerMinute = 20, aggregate = true } = options;
      const now = Date.now();

      let state = samplingState.get(event);

      // New window or first call
      if (!state || now - state.windowStart >= WINDOW_MS) {
        // Flush previous window's aggregate
        if (state?.skipped > 0 && aggregate) {
          log('info', `${event}.aggregated`, {
            sampledCount: state.count,
            skippedCount: state.skipped,
            window: '60s',
            aggregated: state.aggregated
          });
        }
        state = { count: 0, skipped: 0, aggregated: {}, windowStart: now };
        samplingState.set(event, state);
      }

      // Within budget: log normally
      if (state.count < maxPerMinute) {
        state.count++;
        log('info', event, data);
        return;
      }

      // Over budget: accumulate for summary
      state.skipped++;
      if (aggregate) {
        accumulateData(state.aggregated, data);
      }
    }
  };
}

/**
 * Accumulate data for aggregation
 * @param {Object} aggregated - Accumulator object
 * @param {Object} data - New data to merge
 */
function accumulateData(aggregated, data) {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number') {
      aggregated[key] = (aggregated[key] || 0) + value;
    } else if (typeof value === 'string') {
      if (!aggregated[key]) aggregated[key] = {};
      const counts = aggregated[key];
      if (Object.keys(counts).length < 20) {
        counts[value] = (counts[value] || 0) + 1;
      } else {
        counts['__other__'] = (counts['__other__'] || 0) + 1;
      }
    }
  }
}

export default createLogger;
