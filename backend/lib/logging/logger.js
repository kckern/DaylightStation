/**
 * Logger Factory
 * 
 * Creates contextualized logger instances that dispatch to the central LogDispatcher.
 * Provides a clean interface for application code to emit structured log events.
 */

import os from 'os';
import { getDispatcher, isLoggingInitialized } from './dispatcher.js';

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
    dispatcher.dispatch({
      ts: new Date().toISOString(),
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
    }
  };
}

export default createLogger;
