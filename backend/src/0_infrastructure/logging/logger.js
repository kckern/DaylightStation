/**
 * Logger Factory
 *
 * Creates contextualized logger instances that dispatch to the central LogDispatcher.
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
    }
  };
}

export default createLogger;
