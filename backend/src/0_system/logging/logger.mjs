/**
 * Logger Factory
 *
 * Creates contextualized logger instances that dispatch to the central LogDispatcher.
 */

import os from 'os';
import { getDispatcher, isLoggingInitialized } from './dispatcher.mjs';

const hostname = os.hostname();

/**
 * Get current timestamp from dispatcher (uses configured timezone)
 * Falls back to system local time if dispatcher not initialized
 * @returns {string} Timestamp in format "2026-01-23T16:54:50.536"
 */
function getLocalTimestamp() {
  // Fallback for pre-initialization logging
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localTime = new Date(now - offset);
  return localTime.toISOString().slice(0, -1);
}

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

  const log = (level, event, data = {}, options = {}) => {
    if (!isLoggingInitialized()) {
      const fallbackMsg = `[${level.toUpperCase()}] ${event} ${JSON.stringify(data)}`;
      if (level === 'error' || level === 'warn') {
        process.stderr.write(fallbackMsg + '\n');
      } else {
        process.stdout.write(fallbackMsg + '\n');
      }
      return;
    }

    const dispatcher = getDispatcher();
    dispatcher.dispatch({
      ts: getLocalTimestamp(),
      level,
      event,
      message: options.message,
      data,
      context: { ...baseContext, ...options.context },
      tags: options.tags || []
    });
  };

  return {
    debug: (event, data, opts) => log('debug', event, data, opts),
    info: (event, data, opts) => log('info', event, data, opts),
    warn: (event, data, opts) => log('warn', event, data, opts),
    error: (event, data, opts) => log('error', event, data, opts),
    log: (level, event, data, opts) => log(level, event, data, opts),

    child(childContext) {
      return createLogger({
        source,
        app,
        context: { ...baseContext, ...childContext }
      });
    },

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
