/**
 * Structured JSON logger for chatbot operations
 * @module _lib/logging/Logger
 */

/**
 * Log levels in order of severity
 */
export const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/**
 * Default fields to redact from logs
 */
const DEFAULT_REDACT_FIELDS = [
  'token',
  'apiKey',
  'api_key',
  'password',
  'secret',
  'authorization',
  'Authorization',
];

/**
 * Structured JSON logger
 */
export class Logger {
  /**
   * @param {object} options - Logger options
   * @param {string} [options.level='info'] - Minimum log level
   * @param {string} [options.source] - Source identifier (e.g., 'nutribot')
   * @param {string} [options.app] - App/module name
   * @param {string[]} [options.redactFields] - Additional fields to redact
   * @param {function} [options.output] - Output function (default: console.log)
   */
  constructor(options = {}) {
    this.level = LOG_LEVELS[options.level] ?? LOG_LEVELS.info;
    this.source = options.source || 'chatbot';
    this.app = options.app || 'unknown';
    this.redactFields = new Set([
      ...DEFAULT_REDACT_FIELDS,
      ...(options.redactFields || []),
    ]);
    this.output = options.output || console.log;
    this.defaultContext = {};
  }

  /**
   * Set default context to include in all logs
   * @param {object} context
   * @returns {Logger} - Returns this for chaining
   */
  setDefaultContext(context) {
    this.defaultContext = { ...this.defaultContext, ...context };
    return this;
  }

  /**
   * Create a child logger with additional default context
   * @param {object} context - Additional context
   * @returns {Logger}
   */
  child(context) {
    const child = new Logger({
      level: Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === this.level),
      source: this.source,
      app: this.app,
      redactFields: [...this.redactFields],
      output: this.output,
    });
    child.defaultContext = { ...this.defaultContext, ...context };
    return child;
  }

  /**
   * Redact sensitive fields from an object
   * @param {any} value - Value to redact
   * @returns {any}
   */
  redact(value) {
    if (value === null || value === undefined) return value;
    
    if (typeof value === 'string') return value;
    
    if (Array.isArray(value)) {
      return value.map(item => this.redact(item));
    }
    
    if (typeof value === 'object') {
      const result = {};
      for (const [key, val] of Object.entries(value)) {
        if (this.redactFields.has(key)) {
          result[key] = '[REDACTED]';
        } else {
          result[key] = this.redact(val);
        }
      }
      return result;
    }
    
    return value;
  }

  /**
   * Format a log entry as JSON
   * @param {string} level - Log level
   * @param {string} event - Event name (dot-notation)
   * @param {object} [data] - Additional data
   * @returns {string}
   */
  format(level, event, data = {}) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      source: this.source,
      app: this.app,
      event,
      ...this.defaultContext,
      ...this.redact(data),
    };
    
    return JSON.stringify(entry);
  }

  /**
   * Log at a specific level
   * @param {string} level - Log level
   * @param {string} event - Event name
   * @param {object} [data] - Additional data
   */
  log(level, event, data = {}) {
    if (LOG_LEVELS[level] > this.level) return;
    
    const formatted = this.format(level, event, data);
    this.output(formatted);
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
    this.log('error', event, data);
  }

  /**
   * Log a warning
   * @param {string} event - Event name
   * @param {object} [data] - Additional data
   */
  warn(event, data = {}) {
    this.log('warn', event, data);
  }

  /**
   * Log an info message
   * @param {string} event - Event name
   * @param {object} [data] - Additional data
   */
  info(event, data = {}) {
    this.log('info', event, data);
  }

  /**
   * Log a debug message
   * @param {string} event - Event name
   * @param {object} [data] - Additional data
   */
  debug(event, data = {}) {
    this.log('debug', event, data);
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
