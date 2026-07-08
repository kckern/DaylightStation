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
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
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

  /**
   * Perform a request WITHOUT throwing on non-2xx responses.
   *
   * Unlike get/post/put/delete (which throw HttpError on any non-ok status),
   * this returns the full response shape so callers can inspect the status
   * themselves — e.g. image proxies that fall back on 404, hubs that signal
   * 409 contention, or binary downloads that read the content-type header.
   * Still throws HttpError on network / timeout failure.
   *
   * @param {string} method - HTTP method (GET, POST, …)
   * @param {string} url
   * @param {Object} [options]
   * @param {any}    [options.body] - Request body (JSON-stringified unless a string)
   * @param {Object} [options.headers]
   * @param {number} [options.timeout]
   * @param {'buffer'|'text'|'json'} [options.responseType='json'] - How to decode the body.
   *   'buffer' → Node Buffer; 'text' → raw string; 'json' → parsed JSON when the
   *   response is application/json, otherwise the raw text.
   * @returns {Promise<{status:number, headers:Object, ok:boolean, data:any}>}
   */
  async requestRaw(method, url, { body, headers, timeout, responseType = 'json' } = {}) {
    const requestHeaders = { ...headers };
    const fetchOptions = { method, headers: requestHeaders, timeout };

    if (body !== undefined && body !== null) {
      if (!requestHeaders['Content-Type'] && !requestHeaders['content-type']) {
        requestHeaders['Content-Type'] = 'application/json';
      }
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await this.#fetchWithTimeout(url, fetchOptions);
    const responseHeaders = Object.fromEntries(response.headers.entries());

    let data;
    if (responseType === 'buffer') {
      data = Buffer.from(await response.arrayBuffer());
    } else if (responseType === 'text') {
      data = await response.text();
    } else {
      const contentType = responseHeaders['content-type'] || '';
      const text = await response.text();
      if (contentType.includes('application/json')) {
        try { data = JSON.parse(text); } catch { data = null; }
      } else {
        data = text;
      }
    }

    return { status: response.status, headers: responseHeaders, ok: response.ok, data };
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
