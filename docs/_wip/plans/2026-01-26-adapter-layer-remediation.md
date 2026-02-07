# Adapter Layer DDD Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the adapter layer into full compliance with adapter-layer-guidelines.md, fixing 130+ violations across 60+ files.

**Architecture:** Six-phase approach starting with system layer prerequisites (HttpClient service), then fixing I/O imports, renaming Store→Datastore, adding port implementations, standardizing error handling, and structural cleanup. Each phase builds on the previous.

**Tech Stack:** Node.js ESM, YAML datastores, external APIs (Telegram, OpenAI, Anthropic, Plex, Home Assistant)

**Reference Docs:**
- `docs/reference/core/adapter-layer-guidelines.md`
- `docs/_wip/audits/2026-01-26-adapter-layer-ddd-audit.md`

---

## Phase 1: System Layer Prerequisites

### Task 1.1: Create HttpClient Service Interface

**Files:**
- Create: `backend/src/0_system/services/IHttpClient.mjs`

**Step 1: Create the interface file**

```javascript
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
```

**Step 2: Commit**

```bash
git add backend/src/0_system/services/IHttpClient.mjs
git commit -m "feat(system): add IHttpClient interface"
```

---

### Task 1.2: Create HttpClient Implementation

**Files:**
- Create: `backend/src/0_system/services/HttpClient.mjs`
- Create: `backend/src/0_system/services/HttpError.mjs`

**Step 1: Create HttpError class**

```javascript
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

export default HttpError;
```

**Step 2: Create HttpClient implementation**

```javascript
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
```

**Step 3: Commit**

```bash
git add backend/src/0_system/services/HttpError.mjs backend/src/0_system/services/HttpClient.mjs
git commit -m "feat(system): add HttpClient implementation with HttpError"
```

---

### Task 1.3: Create HttpClient Tests

**Files:**
- Create: `backend/src/0_system/services/__tests__/HttpClient.test.mjs`

**Step 1: Write tests**

```javascript
// backend/src/0_system/services/__tests__/HttpClient.test.mjs

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from '../HttpClient.mjs';
import { HttpError } from '../HttpError.mjs';

describe('HttpClient', () => {
  let client;
  let mockLogger;

  beforeEach(() => {
    mockLogger = { debug: vi.fn(), error: vi.fn() };
    client = new HttpClient({ logger: mockLogger });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('get()', () => {
    it('should make GET request and return parsed JSON', async () => {
      const mockResponse = { id: 1, name: 'test' };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.get('https://api.example.com/data');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.data).toEqual(mockResponse);
      expect(result.ok).toBe(true);
    });

    it('should throw HttpError on 404', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ error: 'not found' })
      });

      await expect(client.get('https://api.example.com/missing'))
        .rejects.toThrow(HttpError);
    });
  });

  describe('post()', () => {
    it('should make POST request with JSON body', async () => {
      const requestBody = { name: 'test' };
      const mockResponse = { id: 1, name: 'test' };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.post('https://api.example.com/data', requestBody);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestBody)
        })
      );
      expect(result.data).toEqual(mockResponse);
    });
  });

  describe('error handling', () => {
    it('should mark 429 as transient', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({}),
        text: () => Promise.resolve('rate limited')
      });

      try {
        await client.get('https://api.example.com/data');
      } catch (error) {
        expect(error.isTransient).toBe(true);
        expect(error.code).toBe('RATE_LIMITED');
      }
    });

    it('should mark 500 as transient', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({}),
        text: () => Promise.resolve('server error')
      });

      try {
        await client.get('https://api.example.com/data');
      } catch (error) {
        expect(error.isTransient).toBe(true);
      }
    });

    it('should mark 400 as not transient', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({}),
        text: () => Promise.resolve('bad request')
      });

      try {
        await client.get('https://api.example.com/data');
      } catch (error) {
        expect(error.isTransient).toBe(false);
        expect(error.code).toBe('BAD_REQUEST');
      }
    });
  });

  describe('downloadBuffer()', () => {
    it('should return Buffer from response', async () => {
      const mockData = new Uint8Array([1, 2, 3, 4]).buffer;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({}),
        arrayBuffer: () => Promise.resolve(mockData)
      });

      const result = await client.downloadBuffer('https://example.com/file.bin');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(4);
    });
  });
});
```

**Step 2: Run tests**

```bash
cd backend && npm test -- src/0_system/services/__tests__/HttpClient.test.mjs
```

Expected: All tests pass

**Step 3: Commit**

```bash
git add backend/src/0_system/services/__tests__/HttpClient.test.mjs
git commit -m "test(system): add HttpClient unit tests"
```

---

### Task 1.4: Add System Services Index

**Files:**
- Create: `backend/src/0_system/services/index.mjs`

**Step 1: Create barrel export**

```javascript
// backend/src/0_system/services/index.mjs

export { IHttpClient } from './IHttpClient.mjs';
export { HttpClient } from './HttpClient.mjs';
export { HttpError } from './HttpError.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/0_system/services/index.mjs
git commit -m "feat(system): add services barrel export"
```

---

### Task 1.5: Move InputEventType to Shared Location

**Files:**
- Modify: `backend/src/2_adapters/telegram/IInputEvent.mjs`
- Create: `backend/src/3_applications/common/InputEventType.mjs`
- Modify: `backend/src/2_adapters/homebot/HomeBotInputRouter.mjs`
- Modify: `backend/src/2_adapters/journalist/JournalistInputRouter.mjs`

**Step 1: Create shared InputEventType**

```javascript
// backend/src/3_applications/common/InputEventType.mjs

/**
 * Input event types for bot message routing.
 *
 * Used by input routers to determine how to handle incoming events.
 */
export const InputEventType = Object.freeze({
  TEXT: 'text',
  VOICE: 'voice',
  IMAGE: 'image',
  CALLBACK: 'callback',
  COMMAND: 'command',
  UPC: 'upc'
});

export default InputEventType;
```

**Step 2: Update IInputEvent.mjs to re-export from shared**

```javascript
// At top of backend/src/2_adapters/telegram/IInputEvent.mjs
// Replace the existing InputEventType definition with:

export { InputEventType } from '../../3_applications/common/InputEventType.mjs';
```

**Step 3: Update HomeBotInputRouter import**

```javascript
// backend/src/2_adapters/homebot/HomeBotInputRouter.mjs
// Change line 3 from:
import { InputEventType } from '../telegram/IInputEvent.mjs';
// To:
import { InputEventType } from '../../3_applications/common/InputEventType.mjs';
```

**Step 4: Update JournalistInputRouter import**

```javascript
// backend/src/2_adapters/journalist/JournalistInputRouter.mjs
// Change line 9 from:
import { InputEventType } from '../telegram/IInputEvent.mjs';
// To:
import { InputEventType } from '../../3_applications/common/InputEventType.mjs';
```

**Step 5: Commit**

```bash
git add backend/src/3_applications/common/InputEventType.mjs \
        backend/src/2_adapters/telegram/IInputEvent.mjs \
        backend/src/2_adapters/homebot/HomeBotInputRouter.mjs \
        backend/src/2_adapters/journalist/JournalistInputRouter.mjs
git commit -m "refactor: move InputEventType to shared application layer"
```

---

## Phase 2: Critical I/O Fixes

### Task 2.1: Fix TelegramMessagingAdapter

**Files:**
- Modify: `backend/src/2_adapters/telegram/TelegramMessagingAdapter.mjs`

**Step 1: Update constructor to accept httpClient**

```javascript
// Replace constructor and add #httpClient field:

export class TelegramMessagingAdapter {
  #token;
  #baseUrl;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.token - Telegram bot token
   * @param {Object} deps
   * @param {import('#system/services/HttpClient.mjs').HttpClient} deps.httpClient
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps = {}) {
    if (!config.token) {
      throw new Error('TelegramMessagingAdapter requires token');
    }
    if (!deps.httpClient) {
      throw new Error('TelegramMessagingAdapter requires httpClient');
    }
    this.#token = config.token;
    this.#baseUrl = `https://api.telegram.org/bot${config.token}`;
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }
```

**Step 2: Replace #callApi method**

```javascript
  async #callApi(method, params = {}) {
    try {
      const response = await this.#httpClient.post(
        `${this.#baseUrl}/${method}`,
        params
      );

      if (!response.data.ok) {
        this.#logger.error?.('telegram.api.error', {
          method,
          error: response.data.description
        });
        const err = new Error('Telegram API request failed');
        err.code = 'TELEGRAM_API_ERROR';
        err.isTransient = false;
        throw err;
      }

      return response.data.result;
    } catch (error) {
      if (error.code === 'TELEGRAM_API_ERROR') throw error;

      // Wrap HttpError
      this.#logger.error?.('telegram.request.failed', {
        method,
        error: error.message,
        code: error.code
      });
      const wrapped = new Error('Failed to call Telegram API');
      wrapped.code = error.code || 'UNKNOWN_ERROR';
      wrapped.isTransient = error.isTransient || false;
      throw wrapped;
    }
  }
```

**Step 3: Replace downloadFile method**

```javascript
  async downloadFile(fileId) {
    const url = await this.getFileUrl(fileId);
    return this.#httpClient.downloadBuffer(url);
  }
```

**Step 4: Run any existing tests**

```bash
cd backend && npm test -- --grep "TelegramMessagingAdapter" 2>/dev/null || echo "No tests found"
```

**Step 5: Commit**

```bash
git add backend/src/2_adapters/telegram/TelegramMessagingAdapter.mjs
git commit -m "refactor(telegram): use HttpClient instead of raw fetch"
```

---

### Task 2.2: Fix OpenAIFoodParserAdapter

**Files:**
- Modify: `backend/src/2_adapters/ai/OpenAIFoodParserAdapter.mjs`

**Step 1: Update constructor**

```javascript
// Replace class definition and constructor:

export class OpenAIFoodParserAdapter {
  #apiKey;
  #baseUrl;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.apiKey - OpenAI API key
   * @param {Object} deps
   * @param {import('#system/services/HttpClient.mjs').HttpClient} deps.httpClient
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps = {}) {
    if (!config.apiKey) {
      throw new Error('OpenAIFoodParserAdapter requires apiKey');
    }
    if (!deps.httpClient) {
      throw new Error('OpenAIFoodParserAdapter requires httpClient');
    }
    this.#apiKey = config.apiKey;
    this.#baseUrl = 'https://api.openai.com/v1';
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }
```

**Step 2: Replace parse method's fetch call**

```javascript
  async parse(text) {
    try {
      const response = await this.#httpClient.post(
        `${this.#baseUrl}/chat/completions`,
        {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: this.#systemPrompt },
            { role: 'user', content: text }
          ],
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.#apiKey}`
          }
        }
      );

      return JSON.parse(response.data.choices[0].message.content);
    } catch (error) {
      this.#logger.error?.('openai.foodparser.failed', {
        error: error.message,
        code: error.code
      });
      const wrapped = new Error('Failed to parse food');
      wrapped.code = error.code || 'PARSE_ERROR';
      wrapped.isTransient = error.isTransient || false;
      throw wrapped;
    }
  }
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/ai/OpenAIFoodParserAdapter.mjs
git commit -m "refactor(ai): use HttpClient in OpenAIFoodParserAdapter"
```

---

### Task 2.3: Fix OpenAIAdapter

**Files:**
- Modify: `backend/src/2_adapters/ai/OpenAIAdapter.mjs`

**Step 1: Update constructor to require httpClient**

```javascript
  constructor(config, deps = {}) {
    if (!config?.apiKey) {
      throw new Error('OpenAI API key is required');
    }
    if (!deps.httpClient) {
      throw new Error('OpenAIAdapter requires httpClient');
    }

    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 1000;
    this.timeout = config.timeout || 60000;
    this.httpClient = deps.httpClient;
    this.logger = deps.logger || console;
    // ... rest of constructor
  }
```

**Step 2: Update _makeRequest method**

```javascript
  async _makeRequest(url, options) {
    return this.httpClient.post(url, JSON.parse(options.body), {
      headers: options.headers,
      timeout: options.timeout
    }).then(response => ({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.data),
      headers: { get: (key) => response.headers[key.toLowerCase()] }
    }));
  }
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/ai/OpenAIAdapter.mjs
git commit -m "refactor(ai): require HttpClient in OpenAIAdapter"
```

---

### Task 2.4: Fix AnthropicAdapter

**Files:**
- Modify: `backend/src/2_adapters/ai/AnthropicAdapter.mjs`

**Step 1: Update constructor to require httpClient**

Similar pattern to OpenAIAdapter - add `deps.httpClient` requirement and update `_makeRequest`.

**Step 2: Commit**

```bash
git add backend/src/2_adapters/ai/AnthropicAdapter.mjs
git commit -m "refactor(ai): require HttpClient in AnthropicAdapter"
```

---

### Task 2.5: Fix Remaining Gateway Adapters

**Files to fix (same pattern as above):**
- `messaging/TelegramVoiceTranscriptionService.mjs`
- `content/media/plex/PlexClient.mjs`
- `content/media/plex/PlexAdapter.mjs`
- `home-automation/homeassistant/HomeAssistantAdapter.mjs`
- `nutribot/UPCGateway.mjs`
- `nutrition/NutritionixAdapter.mjs`

**For each file:**
1. Add `httpClient` to constructor deps
2. Replace `fetch()` calls with `this.#httpClient.get/post()`
3. Update error handling to use wrapped errors with codes

**Commit after each file:**

```bash
git add <file>
git commit -m "refactor(<domain>): use HttpClient in <AdapterName>"
```

---

### Task 2.6: Remove axios from TTSAdapter

**Files:**
- Modify: `backend/src/2_adapters/hardware/tts/TTSAdapter.mjs`

**Step 1: Remove axios import and use httpClient**

```javascript
// Remove line 13: import axios from 'axios';

// Update constructor to require httpClient in deps

// Replace axios calls with this.#httpClient.post()
```

**Step 2: Commit**

```bash
git add backend/src/2_adapters/hardware/tts/TTSAdapter.mjs
git commit -m "refactor(hardware): remove axios, use HttpClient in TTSAdapter"
```

---

### Task 2.7: Fix Raw fs Imports

**Files:**
- `home-automation/remote-exec/RemoteExecAdapter.mjs`
- `hardware/thermal-printer/ThermalPrinterAdapter.mjs`
- `nutribot/rendering/NutriReportRenderer.mjs`

**For each file:**
1. Remove `import fs from 'fs'`
2. Import from `#system/utils/FileIO.mjs`
3. Replace `fs.readFileSync` with FileIO equivalent
4. Replace `fs.writeFileSync` with FileIO equivalent

**Commit after each:**

```bash
git add <file>
git commit -m "refactor(<domain>): use FileIO instead of raw fs in <FileName>"
```

---

## Phase 3: Naming Migration (Store → Datastore)

### Task 3.1: Rename Port Interfaces

**Files:** All 15 `I*Store.mjs` files in `3_applications/*/ports/`

**For each file:**
1. Rename file: `IFoodLogStore.mjs` → `IFoodLogDatastore.mjs`
2. Rename class inside: `IFoodLogStore` → `IFoodLogDatastore`
3. Update all imports across codebase

**Execute as batch with script:**

```bash
# Create rename script
cat > /tmp/rename-stores.sh << 'EOF'
#!/bin/bash
cd /root/Code/DaylightStation

# Rename port interface files
for f in $(find backend/src/3_applications -name "I*Store.mjs"); do
  newname=$(echo "$f" | sed 's/Store\.mjs$/Datastore.mjs/')
  git mv "$f" "$newname"
done

# Update class names and imports in all files
find backend/src -name "*.mjs" -exec sed -i \
  -e 's/IFoodLogStore/IFoodLogDatastore/g' \
  -e 's/INutriCoachStore/INutriCoachDatastore/g' \
  -e 's/INutriListStore/INutriListDatastore/g' \
  -e 's/INutriLogStore/INutriLogDatastore/g' \
  -e 's/ISessionStore/ISessionDatastore/g' \
  -e 's/IGratitudeStore/IGratitudeDatastore/g' \
  -e 's/IHealthDataStore/IHealthDataDatastore/g' \
  -e 's/IJournalStore/IJournalDatastore/g' \
  -e 's/IConversationStateStore/IConversationStateDatastore/g' \
  -e 's/IConversationStore/IConversationDatastore/g' \
  -e 's/IWatchStateStore/IWatchStateDatastore/g' \
  -e 's/IJobStore/IJobDatastore/g' \
  -e 's/IStateStore/IStateDatastore/g' \
  -e 's/IMemoryStore/IMemoryDatastore/g' \
  {} \;
EOF
chmod +x /tmp/rename-stores.sh
/tmp/rename-stores.sh
```

**Commit:**

```bash
git add -A
git commit -m "refactor: rename I*Store port interfaces to I*Datastore"
```

---

### Task 3.2: Rename Adapter Datastore Classes

**Files:** All 17 `Yaml*Store.mjs` files in `2_adapters/`

**Execute as batch:**

```bash
# Rename adapter files
for f in $(find backend/src/2_adapters -name "*Store.mjs"); do
  newname=$(echo "$f" | sed 's/Store\.mjs$/Datastore.mjs/')
  git mv "$f" "$newname"
done

# Update class names
find backend/src -name "*.mjs" -exec sed -i \
  -e 's/YamlFoodLogStore/YamlFoodLogDatastore/g' \
  -e 's/YamlNutriCoachStore/YamlNutriCoachDatastore/g' \
  -e 's/YamlNutriListStore/YamlNutriListDatastore/g' \
  -e 's/YamlNutriLogStore/YamlNutriLogDatastore/g' \
  -e 's/YamlSessionStore/YamlSessionDatastore/g' \
  -e 's/YamlGratitudeStore/YamlGratitudeDatastore/g' \
  -e 's/YamlHealthStore/YamlHealthDatastore/g' \
  -e 's/YamlJournalStore/YamlJournalDatastore/g' \
  -e 's/YamlConversationStateStore/YamlConversationStateDatastore/g' \
  -e 's/YamlConversationStore/YamlConversationDatastore/g' \
  -e 's/YamlWatchStateStore/YamlWatchStateDatastore/g' \
  -e 's/YamlJobStore/YamlJobDatastore/g' \
  -e 's/YamlStateStore/YamlStateDatastore/g' \
  -e 's/YamlFinanceStore/YamlFinanceDatastore/g' \
  -e 's/YamlWeatherStore/YamlWeatherDatastore/g' \
  -e 's/YamlAuthStore/YamlAuthDatastore/g' \
  -e 's/YamlLifelogStore/YamlLifelogDatastore/g' \
  {} \;
```

**Commit:**

```bash
git add -A
git commit -m "refactor: rename Yaml*Store adapters to Yaml*Datastore"
```

---

### Task 3.3: Update Index Files

**Files:** All `index.mjs` files that export renamed classes

**Update each index.mjs to use new names**

**Commit:**

```bash
git add -A
git commit -m "refactor: update index exports for Datastore renames"
```

---

## Phase 4: Port Implementation

### Task 4.1: Add extends to Datastore Adapters

**For each datastore that doesn't extend its port:**

```javascript
// Before:
export class YamlFinanceDatastore {

// After:
import { IFinanceDatastore } from '#applications/finance/ports/IFinanceDatastore.mjs';

export class YamlFinanceDatastore extends IFinanceDatastore {
```

**Files to update:**
- `YamlFinanceDatastore`
- `YamlConversationDatastore`
- `YamlJournalDatastore`
- `YamlGratitudeDatastore`
- `YamlWeatherDatastore`
- `YamlSessionDatastore`
- `YamlWatchStateDatastore`
- `YamlNutriLogDatastore`
- `YamlAuthDatastore`
- `YamlLifelogDatastore`

**Commit after each batch of 3-4:**

```bash
git add <files>
git commit -m "refactor(<domain>): add port interface extends to datastores"
```

---

### Task 4.2: Add extends to Gateway Adapters

**For each gateway adapter, add extends for its port interface.**

Note: Some ports may not exist yet - create them in `3_applications/common/ports/` as needed.

**Commit in batches.**

---

## Phase 5: Error Handling Standardization

### Task 5.1: Add Error Mapping to Gateway Adapters

**For each gateway adapter, add:**

```javascript
  #mapErrorCode(status) {
    const mapping = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      429: 'RATE_LIMITED',
      500: 'SERVER_ERROR',
      503: 'SERVICE_UNAVAILABLE'
    };
    return mapping[status] || 'UNKNOWN_ERROR';
  }

  #isTransient(error) {
    if (error.code === 'ECONNRESET') return true;
    if (error.code === 'ETIMEDOUT') return true;
    if (error.code === 'RATE_LIMITED') return true;
    if (error.status >= 500) return true;
    return false;
  }
```

**Commit in batches by domain.**

---

### Task 5.2: Remove Vendor Names from Error Messages

**Search and replace patterns:**

```bash
# Find vendor-specific error messages
grep -rn "Telegram API error\|OpenAI API error\|Plex API error" backend/src/2_adapters/
```

**Replace with generic messages:**

```javascript
// Before:
throw new Error(`Telegram API error: ${data.description}`);

// After:
const err = new Error('Messaging API request failed');
err.code = 'API_ERROR';
err.isTransient = false;
throw err;
```

**Commit:**

```bash
git add -A
git commit -m "refactor: remove vendor names from adapter error messages"
```

---

## Phase 6: Structural Cleanup

### Task 6.1: Remove Use Case Import from JournalistInputRouter

**Files:**
- Modify: `backend/src/2_adapters/journalist/JournalistInputRouter.mjs`

**Step 1: Remove the import and inject via constructor instead**

```javascript
// Remove line 8:
// import { HandleSpecialStart } from '../../3_applications/journalist/usecases/HandleSpecialStart.mjs';

// Add to constructor:
constructor(container, options = {}) {
  super(container, options);
  this.#handleSpecialStart = options.handleSpecialStart || null;
}

// Update usage to use injected instance
```

**Commit:**

```bash
git add backend/src/2_adapters/journalist/JournalistInputRouter.mjs
git commit -m "refactor(journalist): inject use case instead of importing"
```

---

### Task 6.2: Move Business Logic from UPCGateway

**Files:**
- Create: `backend/src/1_domains/nutrition/services/CalorieColorService.mjs`
- Modify: `backend/src/2_adapters/nutribot/UPCGateway.mjs`

**Step 1: Create domain service**

```javascript
// backend/src/1_domains/nutrition/services/CalorieColorService.mjs

/**
 * Determines color classification based on calorie density.
 *
 * @class CalorieColorService
 * @stateless
 */
export class CalorieColorService {
  /**
   * Classify food by calorie density.
   *
   * @param {number} calories - Total calories
   * @param {number} grams - Total grams
   * @returns {'green'|'yellow'|'orange'} Color classification
   */
  classifyByDensity(calories, grams) {
    if (!calories || !grams || grams === 0) return 'yellow';

    const caloriesPerGram = calories / grams;

    if (caloriesPerGram < 1.0) return 'green';
    if (caloriesPerGram <= 2.4) return 'yellow';
    return 'orange';
  }
}

export default CalorieColorService;
```

**Step 2: Update UPCGateway to use injected service**

```javascript
// In constructor:
this.#calorieColorService = deps.calorieColorService;

// Replace inline logic with:
const color = this.#calorieColorService.classifyByDensity(calories, grams);
```

**Commit:**

```bash
git add backend/src/1_domains/nutrition/services/CalorieColorService.mjs \
        backend/src/2_adapters/nutribot/UPCGateway.mjs
git commit -m "refactor: move calorie color logic to domain service"
```

---

### Task 6.3: Move Business Logic from NutritionixAdapter

**Same pattern as Task 6.2 - use the CalorieColorService.**

**Commit:**

```bash
git add backend/src/2_adapters/nutrition/NutritionixAdapter.mjs
git commit -m "refactor(nutrition): use CalorieColorService in NutritionixAdapter"
```

---

### Task 6.4: Fix ConfigHouseholdAdapter

**Files:**
- Modify: `backend/src/2_adapters/homebot/ConfigHouseholdAdapter.mjs`

**Option A:** Create a config repository in system layer
**Option B:** Pass resolved config data to constructor

**Choose based on usage patterns and implement accordingly.**

**Commit:**

```bash
git add backend/src/2_adapters/homebot/ConfigHouseholdAdapter.mjs
git commit -m "refactor(homebot): receive config values instead of ConfigService"
```

---

## Verification

### Final Audit Check

After all phases complete, run the audit checks:

```bash
# Check for remaining raw fetch
grep -rn "await fetch\(" backend/src/2_adapters/ | grep -v test

# Check for remaining axios
grep -rn "from 'axios'" backend/src/2_adapters/

# Check for remaining raw fs
grep -rn "from 'fs'" backend/src/2_adapters/

# Check for Store naming
grep -rn "class.*Store " backend/src/2_adapters/

# Check for missing extends
grep -rn "export class.*Adapter {" backend/src/2_adapters/
grep -rn "export class.*Datastore {" backend/src/2_adapters/
```

All checks should return empty or only false positives.

---

## Summary

| Phase | Tasks | Est. Files |
|-------|-------|------------|
| 1. System Prerequisites | 5 | 6 new |
| 2. Critical I/O Fixes | 7 | 15 modified |
| 3. Naming Migration | 3 | 32 renamed |
| 4. Port Implementation | 2 | 39 modified |
| 5. Error Handling | 2 | 15 modified |
| 6. Structural Cleanup | 4 | 5 modified |

**Total: 23 tasks across 6 phases**
