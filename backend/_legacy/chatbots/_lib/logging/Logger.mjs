/**
 * Structured JSON logger for chatbot operations
 * @module _lib/logging/Logger
 * 
 * Adapter that bridges chatbots logging to the backend logging framework.
 * Routes all logs through the centralized LogDispatcher.
 */

import { createLogger as createBackendLogger } from '../../../lib/logging/logger.js';

/**
 * Log levels in order of severity (compatibility layer)
 */
export const LOG_LEVELS = {
  debug: 3,
  info: 2,
  warn: 1,
  error: 0,
};

/**
 * Structured JSON logger - wraps backend logging framework
 * 
 * This class provides a compatible interface for existing chatbots code
 * while routing all logs through the backend framework.
 */
export class Logger {
  /**
   * @param {object} options - Logger options
   * @param {string} [options.level='info'] - Minimum log level (for compatibility)
   * @param {string} [options.source='chatbots'] - Source identifier
   * @param {string} [options.app='unknown'] - App/module name
   * @param {string[]} [options.redactFields] - Additional fields to redact (handled by backend)
   * @param {function} [options.output] - Output function (ignored - uses backend)
   */
  constructor(options = {}) {
    this.source = options.source || 'chatbots';
    this.app = options.app || 'unknown';
    this.defaultContext = {};
    
    // Create a backend logger for this instance
    this.#backendLogger = createBackendLogger({
      source: this.source,
      app: this.app,
      context: this.defaultContext
    });
  }

  #backendLogger;

  /**
   * Set default context to include in all logs
   * @param {object} context
   * @returns {Logger} - Returns this for chaining
   */
  setDefaultContext(context) {
    this.defaultContext = { ...this.defaultContext, ...context };
    this.#backendLogger = createBackendLogger({
      source: this.source,
      app: this.app,
      context: this.defaultContext
    });
    return this;
  }

  /**
   * Create a child logger with additional default context
   * @param {object} context - Additional context
   * @returns {Logger}
   */
  child(context) {
    const child = new Logger({
      source: this.source,
      app: this.app,
    });
    child.defaultContext = { ...this.defaultContext, ...context };
    child.#backendLogger = createBackendLogger({
      source: this.source,
      app: this.app,
      context: child.defaultContext
    });
    return child;
  }

  /**
   * Log at a specific level
   * @param {string} level - Log level
   * @param {string} event - Event name
   * @param {object} [data] - Additional data
   */
  log(level, event, data = {}) {
    const method = level === 'debug' ? 'debug' 
                 : level === 'info' ? 'info'
                 : level === 'warn' ? 'warn'
                 : 'error';
    
    this.#backendLogger[method](event, data);
  }

  /**
   * Log an error
   * @param {string} event - Event name
   * @param {object|Error} data - Data or Error object
   */
  error(event, data = {}) {
    if (data instanceof Error) {
      data = {
        message: data.message,
        name: data.name,
        stack: data.stack,
        ...(data.context || {}),
      };
    }
    this.#backendLogger.error(event, data);
  }

  /**
   * Log a warning
   * @param {string} event - Event name
   * @param {object} [data] - Additional data
   */
  warn(event, data = {}) {
    this.#backendLogger.warn(event, data);
  }

  /**
   * Log an info message
   * @param {string} event - Event name
   * @param {object} [data] - Additional data
   */
  info(event, data = {}) {
    this.#backendLogger.info(event, data);
  }

  /**
   * Log a debug message
   * @param {string} event - Event name
   * @param {object} [data] - Additional data
   */
  debug(event, data = {}) {
    this.#backendLogger.debug(event, data);
  }
}

/**
 * Create a logger instance
 * @param {object} options - Logger options
 * @returns {Logger}
 */
export function createLogger(options = {}) {
  return new Logger(options);
}

/**
 * Default logger instance
 */
export const defaultLogger = createLogger();

export default {
  Logger,
  createLogger,
  defaultLogger,
  LOG_LEVELS,
};
