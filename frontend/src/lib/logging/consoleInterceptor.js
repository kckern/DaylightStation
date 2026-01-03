/**
 * Console Interceptor
 *
 * Intercepts native console methods (log, warn, error, info, debug) and forwards
 * them to DaylightLogger while preserving the original console output.
 *
 * Features:
 * - Rate limiting to prevent log spam
 * - Preserves original console behavior
 * - Serializes Error objects properly
 * - Handles circular references
 */

import { getDaylightLogger } from './singleton.js';

// Rate limiting: max events per level per second
const RATE_LIMIT_CONFIG = {
  log: 50,    // Max 50 console.log per second
  info: 50,   // Max 50 console.info per second
  warn: 100,  // Max 100 console.warn per second
  error: 200, // Max 200 console.error per second (critical)
  debug: 30   // Max 30 console.debug per second
};

const rateLimitState = {
  log: { count: 0, resetTime: Date.now() + 1000 },
  info: { count: 0, resetTime: Date.now() + 1000 },
  warn: { count: 0, resetTime: Date.now() + 1000 },
  error: { count: 0, resetTime: Date.now() + 1000 },
  debug: { count: 0, resetTime: Date.now() + 1000 }
};

/**
 * Check if logging should be rate-limited
 * @param {string} level - Log level
 * @returns {boolean} True if rate limit exceeded
 */
function shouldRateLimit(level) {
  const now = Date.now();
  const state = rateLimitState[level];

  // Reset counter if time window expired
  if (now >= state.resetTime) {
    state.count = 0;
    state.resetTime = now + 1000;
  }

  // Increment and check limit
  state.count++;
  return state.count > RATE_LIMIT_CONFIG[level];
}

/**
 * Serialize an argument for logging (handles errors, circular refs, etc)
 * @param {*} arg - Argument to serialize
 * @returns {*} Serialized argument
 */
function serializeArg(arg) {
  if (arg instanceof Error) {
    return {
      __type: 'Error',
      message: arg.message,
      stack: arg.stack,
      name: arg.name,
      ...Object.getOwnPropertyNames(arg).reduce((acc, key) => {
        if (!['message', 'stack', 'name'].includes(key)) {
          acc[key] = arg[key];
        }
        return acc;
      }, {})
    };
  }

  if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean' || arg === null || arg === undefined) {
    return arg;
  }

  if (typeof arg === 'function') {
    return `[Function: ${arg.name || 'anonymous'}]`;
  }

  // For objects, try to stringify (handle circular refs)
  try {
    JSON.stringify(arg);
    return arg; // If it works, return as-is
  } catch (err) {
    // Circular reference or other issue
    try {
      return String(arg);
    } catch (stringErr) {
      return '[Object: Cannot serialize]';
    }
  }
}

/**
 * Intercept console methods and forward to DaylightLogger
 * @param {Object} options - Configuration options
 * @param {boolean} options.interceptLog - Intercept console.log (default: true)
 * @param {boolean} options.interceptInfo - Intercept console.info (default: true)
 * @param {boolean} options.interceptWarn - Intercept console.warn (default: true)
 * @param {boolean} options.interceptError - Intercept console.error (default: true)
 * @param {boolean} options.interceptDebug - Intercept console.debug (default: false)
 * @returns {Function} Cleanup function to restore original console
 */
export function interceptConsole(options = {}) {
  const {
    interceptLog = true,
    interceptInfo = true,
    interceptWarn = true,
    interceptError = true,
    interceptDebug = false // Off by default (too noisy)
  } = options;

  const logger = getDaylightLogger();

  // Save original console methods
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  };

  // Intercept console.log
  if (interceptLog) {
    console.log = (...args) => {
      originalConsole.log(...args);

      if (!shouldRateLimit('log')) {
        logger.debug('console.log', {
          args: args.map(serializeArg)
        });
      }
    };
  }

  // Intercept console.info
  if (interceptInfo) {
    console.info = (...args) => {
      originalConsole.info(...args);

      if (!shouldRateLimit('info')) {
        logger.info('console.info', {
          args: args.map(serializeArg)
        });
      }
    };
  }

  // Intercept console.warn
  if (interceptWarn) {
    console.warn = (...args) => {
      originalConsole.warn(...args);

      if (!shouldRateLimit('warn')) {
        logger.warn('console.warn', {
          args: args.map(serializeArg)
        });
      }
    };
  }

  // Intercept console.error
  if (interceptError) {
    console.error = (...args) => {
      originalConsole.error(...args);

      if (!shouldRateLimit('error')) {
        logger.error('console.error', {
          args: args.map(serializeArg)
        });
      }
    };
  }

  // Intercept console.debug (optional, off by default)
  if (interceptDebug) {
    console.debug = (...args) => {
      originalConsole.debug(...args);

      if (!shouldRateLimit('debug')) {
        logger.debug('console.debug', {
          args: args.map(serializeArg)
        });
      }
    };
  }

  // Log that console interception is active
  logger.info('console-interceptor.initialized', {
    intercepted: {
      log: interceptLog,
      info: interceptInfo,
      warn: interceptWarn,
      error: interceptError,
      debug: interceptDebug
    },
    rateLimits: RATE_LIMIT_CONFIG
  });

  // Return cleanup function to restore original console
  return () => {
    Object.assign(console, originalConsole);
    logger.info('console-interceptor.removed', {});
  };
}

export default interceptConsole;
