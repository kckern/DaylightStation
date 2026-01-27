// backend/src/0_system/services/IHttpClient.mjs

/**
 * HTTP client interface for making web requests.
 *
 * Adapters inject this to make HTTP calls without knowing
 * the underlying implementation (fetch, axios, etc.).
 *
 * @interface IHttpClient
 */
export class IHttpClient {
  /**
   * Make a GET request.
   *
   * @param {string} url - Request URL
   * @param {Object} [options] - Request options
   * @param {Object} [options.headers] - Request headers
   * @param {number} [options.timeout] - Timeout in ms
   * @returns {Promise<HttpResponse>}
   * @throws {HttpError} On request failure
   */
  async get(url, options = {}) {
    throw new Error('Not implemented');
  }

  /**
   * Make a POST request.
   *
   * @param {string} url - Request URL
   * @param {Object|string} body - Request body
   * @param {Object} [options] - Request options
   * @param {Object} [options.headers] - Request headers
   * @param {number} [options.timeout] - Timeout in ms
   * @returns {Promise<HttpResponse>}
   * @throws {HttpError} On request failure
   */
  async post(url, body, options = {}) {
    throw new Error('Not implemented');
  }

  /**
   * Make a PUT request.
   *
   * @param {string} url - Request URL
   * @param {Object|string} body - Request body
   * @param {Object} [options] - Request options
   * @param {Object} [options.headers] - Request headers
   * @param {number} [options.timeout] - Timeout in ms
   * @returns {Promise<HttpResponse>}
   * @throws {HttpError} On request failure
   */
  async put(url, body, options = {}) {
    throw new Error('Not implemented');
  }

  /**
   * Make a DELETE request.
   *
   * @param {string} url - Request URL
   * @param {Object} [options] - Request options
   * @param {Object} [options.headers] - Request headers
   * @param {number} [options.timeout] - Timeout in ms
   * @returns {Promise<HttpResponse>}
   * @throws {HttpError} On request failure
   */
  async delete(url, options = {}) {
    throw new Error('Not implemented');
  }

  /**
   * Download binary content.
   *
   * @param {string} url - URL to download
   * @param {Object} [options] - Request options
   * @param {string} [options.method='GET'] - HTTP method
   * @param {Object} [options.headers] - Request headers
   * @param {string} [options.body] - Request body (for POST/PUT)
   * @param {number} [options.timeout] - Timeout in ms
   * @returns {Promise<Buffer>}
   * @throws {HttpError} On request failure
   */
  async downloadBuffer(url, options = {}) {
    throw new Error('Not implemented');
  }

  /**
   * Post form data (multipart).
   *
   * @param {string} url - Request URL
   * @param {FormData} formData - Form data to send
   * @param {Object} [options] - Request options
   * @returns {Promise<HttpResponse>}
   * @throws {HttpError} On request failure
   */
  async postForm(url, formData, options = {}) {
    throw new Error('Not implemented');
  }
}

/**
 * Check if an object implements IHttpClient interface.
 * @param {Object} obj - Object to check
 * @returns {boolean}
 */
export function isHttpClient(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const requiredMethods = ['get', 'post', 'put', 'delete', 'downloadBuffer', 'postForm'];
  return requiredMethods.every(method => typeof obj[method] === 'function');
}

/**
 * @typedef {Object} HttpResponse
 * @property {number} status - HTTP status code
 * @property {Object} headers - Response headers
 * @property {any} data - Parsed response body
 * @property {boolean} ok - True if status 2xx
 */

/**
 * @typedef {Object} HttpError
 * @property {string} message - Error message
 * @property {string} code - Error code (TIMEOUT, NETWORK_ERROR, etc.)
 * @property {number} [status] - HTTP status if available
 * @property {boolean} isTransient - True if retryable
 */

export default IHttpClient;
