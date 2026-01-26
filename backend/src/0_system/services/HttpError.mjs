// backend/src/0_system/services/HttpError.mjs

/**
 * HTTP request error with standardized structure.
 *
 * @class HttpError
 */
export class HttpError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} options
   * @param {string} options.code - Error code
   * @param {number} [options.status] - HTTP status code
   * @param {boolean} [options.isTransient=false] - Whether error is retryable
   * @param {Object} [options.details] - Additional details
   */
  constructor(message, { code, status, isTransient = false, details } = {}) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = status;
    this.isTransient = isTransient;
    this.details = details;
  }

  /**
   * Create from fetch Response object.
   * @param {Response} response
   * @param {string} [body] - Response body text
   * @returns {HttpError}
   */
  static fromResponse(response, body) {
    const isTransient = response.status === 429 || response.status >= 500;
    const code = HttpError.#statusToCode(response.status);

    return new HttpError(
      `HTTP ${response.status}: ${response.statusText}`,
      { code, status: response.status, isTransient, details: { body } }
    );
  }

  /**
   * Create from network/timeout error.
   * @param {Error} error
   * @returns {HttpError}
   */
  static fromNetworkError(error) {
    const code = HttpError.#errorToCode(error);
    const isTransient = ['TIMEOUT', 'ECONNRESET', 'ENOTFOUND', 'NETWORK_ERROR'].includes(code);

    return new HttpError(
      error.message,
      { code, isTransient, details: { originalError: error.message } }
    );
  }

  static #statusToCode(status) {
    const mapping = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      429: 'RATE_LIMITED',
      500: 'SERVER_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
      504: 'GATEWAY_TIMEOUT'
    };
    return mapping[status] || 'HTTP_ERROR';
  }

  static #errorToCode(error) {
    if (error.name === 'AbortError') return 'TIMEOUT';
    if (error.cause?.code === 'ECONNRESET') return 'ECONNRESET';
    if (error.cause?.code === 'ETIMEDOUT') return 'TIMEOUT';
    if (error.cause?.code === 'ENOTFOUND') return 'ENOTFOUND';
    return 'NETWORK_ERROR';
  }
}

/**
 * Check if an object is an HttpError instance.
 * @param {Object} obj - Object to check
 * @returns {boolean}
 */
export function isHttpError(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return obj.name === 'HttpError' &&
    typeof obj.code === 'string' &&
    typeof obj.isTransient === 'boolean';
}

export default HttpError;
