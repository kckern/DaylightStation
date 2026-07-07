/**
 * Configuration error - invalid or missing configuration
 * @module system/utils/errors/ConfigurationError
 *
 * NOTE: This class must NOT depend on any clock/now helper (audit S-4).
 * Error construction happens during config-singleton initialization, so
 * importing such utilities here would create a bootstrap coupling. Keep
 * this module dependency-free.
 */

/**
 * Raised when configuration is invalid or missing.
 */
export class ConfigurationError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {object} [opts]
   * @param {string} [opts.code] - Machine-readable code (e.g. 'MISSING_SECRET')
   * @param {string} [opts.key] - Which config key (e.g. 'OPENAI_API_KEY')
   * @param {*} [opts.value] - What was provided (sanitized — never a secret)
   * @param {object} [opts.details] - Additional context
   */
  constructor(message, { code, key, value, details } = {}) {
    super(message);
    this.name = 'ConfigurationError';
    this.code = code;
    this.key = key;
    this.value = value;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export default ConfigurationError;
