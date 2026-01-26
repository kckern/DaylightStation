// backend/src/0_system/services/HttpClient.mjs

import { IHttpClient } from './IHttpClient.mjs';
import { HttpError } from './HttpError.mjs';

/**
 * Fetch-based HTTP client implementation.
 *
 * @class HttpClient
 * @implements {IHttpClient}
 */
export class HttpClient extends IHttpClient {
  #defaultTimeout;
  #logger;

  /**
   * @param {Object} [options]
   * @param {number} [options.timeout=30000] - Default timeout in ms
   * @param {Object} [options.logger=console] - Logger instance
   */
  constructor(options = {}) {
    super();
    this.#defaultTimeout = options.timeout || 30000;
    this.#logger = options.logger || console;
  }

  async get(url, options = {}) {
    return this.#request('GET', url, null, options);
  }

  async post(url, body, options = {}) {
    return this.#request('POST', url, body, options);
  }

  async put(url, body, options = {}) {
    return this.#request('PUT', url, body, options);
  }

  async delete(url, options = {}) {
    return this.#request('DELETE', url, null, options);
  }

  async downloadBuffer(url, options = {}) {
    const response = await this.#fetchWithTimeout(url, {
      method: 'GET',
      headers: options.headers,
      timeout: options.timeout
    });

    if (!response.ok) {
      throw HttpError.fromResponse(response);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async postForm(url, formData, options = {}) {
    const response = await this.#fetchWithTimeout(url, {
      method: 'POST',
      body: formData,
      headers: options.headers,
      timeout: options.timeout
    });

    return this.#parseResponse(response);
  }

  async #request(method, url, body, options) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const fetchOptions = {
      method,
      headers,
      timeout: options.timeout
    };

    if (body !== null) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await this.#fetchWithTimeout(url, fetchOptions);
    return this.#parseResponse(response);
  }

  async #fetchWithTimeout(url, options) {
    const timeout = options.timeout || this.#defaultTimeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      this.#logger.debug?.('http.request', { method: options.method, url });

      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      this.#logger.debug?.('http.response', {
        method: options.method,
        url,
        status: response.status
      });

      return response;
    } catch (error) {
      this.#logger.error?.('http.error', {
        method: options.method,
        url,
        error: error.message
      });
      throw HttpError.fromNetworkError(error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async #parseResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    let data;

    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => null);
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      throw HttpError.fromResponse(response, typeof data === 'string' ? data : JSON.stringify(data));
    }

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      data,
      ok: response.ok
    };
  }
}

export default HttpClient;
