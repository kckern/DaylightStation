# OpenAI Retry with Backoff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add retry with exponential backoff to OpenAIAdapter for transient failures (network errors, 429s, 5xx).

**Architecture:** Add private helper methods to OpenAIAdapter: `#sleep()`, `#isRetryable()`, `#calculateDelay()`, `#retryWithBackoff()`. Wrap `callApi()` fetch logic with retry helper. Track retries in metrics.

**Tech Stack:** Native JavaScript, Jest for testing.

---

### Task 1: Add sleep helper and test

**Files:**
- Modify: `backend/src/2_adapters/ai/OpenAIAdapter.mjs`
- Create: `backend/src/2_adapters/ai/OpenAIAdapter.test.mjs`

**Step 1: Write the failing test**

```javascript
// backend/src/2_adapters/ai/OpenAIAdapter.test.mjs
import { OpenAIAdapter } from './OpenAIAdapter.mjs';

describe('OpenAIAdapter', () => {
  describe('retry helpers', () => {
    let adapter;

    beforeEach(() => {
      adapter = new OpenAIAdapter({ apiKey: 'test-key' });
    });

    test('sleep delays for specified milliseconds', async () => {
      const start = Date.now();
      await adapter._testSleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45);
      expect(elapsed).toBeLessThan(100);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/src/2_adapters/ai/OpenAIAdapter.test.mjs -t "sleep delays" --no-coverage`

Expected: FAIL with "adapter._testSleep is not a function"

**Step 3: Write minimal implementation**

Add after the constructor in `OpenAIAdapter.mjs`:

```javascript
  /**
   * Sleep for specified milliseconds
   * @private
   */
  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Expose sleep for testing
   * @private
   */
  _testSleep(ms) {
    return this.#sleep(ms);
  }
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/src/2_adapters/ai/OpenAIAdapter.test.mjs -t "sleep delays" --no-coverage`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/ai/OpenAIAdapter.mjs backend/src/2_adapters/ai/OpenAIAdapter.test.mjs
git commit -m "feat(openai): add sleep helper for retry backoff"
```

---

### Task 2: Add isRetryable helper and test

**Files:**
- Modify: `backend/src/2_adapters/ai/OpenAIAdapter.mjs`
- Modify: `backend/src/2_adapters/ai/OpenAIAdapter.test.mjs`

**Step 1: Write the failing tests**

Add to the test file:

```javascript
    describe('isRetryable', () => {
      test('returns true for fetch failed errors', () => {
        const error = new Error('fetch failed');
        expect(adapter._testIsRetryable(error)).toBe(true);
      });

      test('returns true for ECONNRESET', () => {
        const error = new Error('connection reset');
        error.cause = { code: 'ECONNRESET' };
        expect(adapter._testIsRetryable(error)).toBe(true);
      });

      test('returns true for ETIMEDOUT', () => {
        const error = new Error('timed out');
        error.cause = { code: 'ETIMEDOUT' };
        expect(adapter._testIsRetryable(error)).toBe(true);
      });

      test('returns true for RATE_LIMIT errors', () => {
        const error = new Error('rate limited');
        error.code = 'RATE_LIMIT';
        expect(adapter._testIsRetryable(error)).toBe(true);
      });

      test('returns true for 5xx server errors', () => {
        const error = new Error('server error');
        error.status = 503;
        expect(adapter._testIsRetryable(error)).toBe(true);
      });

      test('returns false for 4xx client errors', () => {
        const error = new Error('bad request');
        error.status = 400;
        expect(adapter._testIsRetryable(error)).toBe(false);
      });

      test('returns false for generic errors', () => {
        const error = new Error('something went wrong');
        expect(adapter._testIsRetryable(error)).toBe(false);
      });
    });
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/src/2_adapters/ai/OpenAIAdapter.test.mjs -t "isRetryable" --no-coverage`

Expected: FAIL with "adapter._testIsRetryable is not a function"

**Step 3: Write minimal implementation**

Add after `#sleep()` in `OpenAIAdapter.mjs`:

```javascript
  /**
   * Check if error is retryable
   * @private
   */
  #isRetryable(error) {
    // Network-level failures
    if (error.cause?.code === 'ECONNRESET') return true;
    if (error.cause?.code === 'ETIMEDOUT') return true;
    if (error.cause?.code === 'ENOTFOUND') return true;
    if (error.message?.includes('fetch failed')) return true;

    // Rate limit
    if (error.code === 'RATE_LIMIT') return true;

    // Server errors (5xx)
    if (error.status >= 500 && error.status < 600) return true;

    return false;
  }

  /**
   * Expose isRetryable for testing
   * @private
   */
  _testIsRetryable(error) {
    return this.#isRetryable(error);
  }
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/src/2_adapters/ai/OpenAIAdapter.test.mjs -t "isRetryable" --no-coverage`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/ai/OpenAIAdapter.mjs backend/src/2_adapters/ai/OpenAIAdapter.test.mjs
git commit -m "feat(openai): add isRetryable helper for error classification"
```

---

### Task 3: Add calculateDelay helper and test

**Files:**
- Modify: `backend/src/2_adapters/ai/OpenAIAdapter.mjs`
- Modify: `backend/src/2_adapters/ai/OpenAIAdapter.test.mjs`

**Step 1: Write the failing tests**

Add to the test file:

```javascript
    describe('calculateDelay', () => {
      test('uses retry-after for rate limit errors', () => {
        const error = new Error('rate limited');
        error.code = 'RATE_LIMIT';
        error.retryAfter = 30;
        const delay = adapter._testCalculateDelay(error, 1, 1000);
        expect(delay).toBe(30000);
      });

      test('returns exponential backoff for attempt 1', () => {
        const error = new Error('fetch failed');
        const delay = adapter._testCalculateDelay(error, 1, 1000);
        // 1000ms base * 2^0 = 1000ms, ±10% jitter = 900-1100
        expect(delay).toBeGreaterThanOrEqual(900);
        expect(delay).toBeLessThanOrEqual(1100);
      });

      test('returns exponential backoff for attempt 2', () => {
        const error = new Error('fetch failed');
        const delay = adapter._testCalculateDelay(error, 2, 1000);
        // 1000ms base * 2^1 = 2000ms, ±10% jitter = 1800-2200
        expect(delay).toBeGreaterThanOrEqual(1800);
        expect(delay).toBeLessThanOrEqual(2200);
      });

      test('returns exponential backoff for attempt 3', () => {
        const error = new Error('fetch failed');
        const delay = adapter._testCalculateDelay(error, 3, 1000);
        // 1000ms base * 2^2 = 4000ms, ±10% jitter = 3600-4400
        expect(delay).toBeGreaterThanOrEqual(3600);
        expect(delay).toBeLessThanOrEqual(4400);
      });
    });
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/src/2_adapters/ai/OpenAIAdapter.test.mjs -t "calculateDelay" --no-coverage`

Expected: FAIL with "adapter._testCalculateDelay is not a function"

**Step 3: Write minimal implementation**

Add after `#isRetryable()` in `OpenAIAdapter.mjs`:

```javascript
  /**
   * Calculate delay before retry
   * @private
   */
  #calculateDelay(error, attempt, baseDelay) {
    // Use retry-after for rate limits
    if (error.code === 'RATE_LIMIT' && error.retryAfter) {
      return error.retryAfter * 1000;
    }

    // Exponential backoff: baseDelay * 2^(attempt-1)
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);

    // Add jitter ±10%
    const jitter = exponentialDelay * 0.1 * (Math.random() * 2 - 1);

    return Math.floor(exponentialDelay + jitter);
  }

  /**
   * Expose calculateDelay for testing
   * @private
   */
  _testCalculateDelay(error, attempt, baseDelay) {
    return this.#calculateDelay(error, attempt, baseDelay);
  }
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/src/2_adapters/ai/OpenAIAdapter.test.mjs -t "calculateDelay" --no-coverage`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/ai/OpenAIAdapter.mjs backend/src/2_adapters/ai/OpenAIAdapter.test.mjs
git commit -m "feat(openai): add calculateDelay helper with exponential backoff"
```

---

### Task 4: Add retryWithBackoff helper and test

**Files:**
- Modify: `backend/src/2_adapters/ai/OpenAIAdapter.mjs`
- Modify: `backend/src/2_adapters/ai/OpenAIAdapter.test.mjs`

**Step 1: Write the failing tests**

Add to the test file:

```javascript
    describe('retryWithBackoff', () => {
      test('returns result on first success', async () => {
        const fn = jest.fn().mockResolvedValue('success');
        const result = await adapter._testRetryWithBackoff(fn);
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(1);
      });

      test('retries on retryable error and succeeds', async () => {
        const error = new Error('fetch failed');
        const fn = jest.fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValue('success');

        const result = await adapter._testRetryWithBackoff(fn, { baseDelay: 10 });
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(2);
      });

      test('throws after max attempts exhausted', async () => {
        const error = new Error('fetch failed');
        const fn = jest.fn().mockRejectedValue(error);

        await expect(adapter._testRetryWithBackoff(fn, { maxAttempts: 2, baseDelay: 10 }))
          .rejects.toThrow('fetch failed');
        expect(fn).toHaveBeenCalledTimes(2);
      });

      test('does not retry non-retryable errors', async () => {
        const error = new Error('bad request');
        error.status = 400;
        const fn = jest.fn().mockRejectedValue(error);

        await expect(adapter._testRetryWithBackoff(fn))
          .rejects.toThrow('bad request');
        expect(fn).toHaveBeenCalledTimes(1);
      });

      test('increments retryCount metric on retry', async () => {
        const error = new Error('fetch failed');
        const fn = jest.fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValue('success');

        await adapter._testRetryWithBackoff(fn, { baseDelay: 10 });
        expect(adapter.metrics.retryCount).toBe(1);
      });
    });
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/src/2_adapters/ai/OpenAIAdapter.test.mjs -t "retryWithBackoff" --no-coverage`

Expected: FAIL with "adapter._testRetryWithBackoff is not a function"

**Step 3: Write minimal implementation**

First, update the constructor to include retryCount in metrics:

```javascript
    this.metrics = {
      startedAt: Date.now(),
      requestCount: 0,
      tokenCount: 0,
      errors: 0,
      retryCount: 0
    };
```

Then add after `#calculateDelay()`:

```javascript
  /**
   * Execute function with retry and backoff
   * @private
   */
  async #retryWithBackoff(fn, options = {}) {
    const maxAttempts = options.maxAttempts || 3;
    const baseDelay = options.baseDelay || 1000;
    let totalDelayMs = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await fn();

        // Log recovery if we retried
        if (attempt > 1) {
          this.logger.info?.('openai.retry.recovered', { attempts: attempt, totalDelayMs });
        }

        return result;
      } catch (error) {
        const isRetryable = this.#isRetryable(error);
        const isLastAttempt = attempt === maxAttempts;

        if (!isRetryable || isLastAttempt) {
          throw error;
        }

        const delay = this.#calculateDelay(error, attempt, baseDelay);
        totalDelayMs += delay;

        this.logger.warn?.('openai.retry', {
          attempt,
          maxAttempts,
          delayMs: delay,
          error: error.message,
          errorCode: error.code || error.status
        });

        this.metrics.retryCount++;
        await this.#sleep(delay);
      }
    }
  }

  /**
   * Expose retryWithBackoff for testing
   * @private
   */
  _testRetryWithBackoff(fn, options) {
    return this.#retryWithBackoff(fn, options);
  }
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/src/2_adapters/ai/OpenAIAdapter.test.mjs -t "retryWithBackoff" --no-coverage`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/ai/OpenAIAdapter.mjs backend/src/2_adapters/ai/OpenAIAdapter.test.mjs
git commit -m "feat(openai): add retryWithBackoff helper"
```

---

### Task 5: Wrap callApi with retry and test

**Files:**
- Modify: `backend/src/2_adapters/ai/OpenAIAdapter.mjs`
- Modify: `backend/src/2_adapters/ai/OpenAIAdapter.test.mjs`

**Step 1: Write the failing test**

Add to the test file:

```javascript
  describe('callApi retry integration', () => {
    test('retries on fetch failure and succeeds', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'hello' } }],
          usage: { total_tokens: 10 }
        })
      };

      let callCount = 0;
      const adapter = new OpenAIAdapter(
        { apiKey: 'test-key' },
        {
          httpClient: {
            fetch: () => {
              callCount++;
              if (callCount === 1) {
                return Promise.reject(new Error('fetch failed'));
              }
              return Promise.resolve(mockResponse);
            }
          }
        }
      );

      // Override sleep to speed up test
      adapter._testSleep = () => Promise.resolve();

      const result = await adapter.chat([{ role: 'user', content: 'hi' }]);
      expect(result).toBe('hello');
      expect(callCount).toBe(2);
      expect(adapter.metrics.retryCount).toBe(1);
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/src/2_adapters/ai/OpenAIAdapter.test.mjs -t "retries on fetch failure" --no-coverage`

Expected: FAIL (currently callApi doesn't use retry wrapper)

**Step 3: Update callApi to use retry wrapper**

Replace the try/catch block in `callApi()` method with:

```javascript
  async callApi(endpoint, data, options = {}) {
    const url = `${OPENAI_API_BASE}${endpoint}`;

    this.logger.debug?.('openai.request', {
      endpoint,
      model: data.model,
      messageCount: data.messages?.length
    });

    this.metrics.requestCount++;

    try {
      return await this.#retryWithBackoff(async () => {
        const response = await this._makeRequest(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(data),
          timeout: options.timeout || this.timeout
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          this.metrics.errors++;

          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after') || 60;
            const error = new Error(`Rate limit exceeded. Retry after ${retryAfter}s`);
            error.code = 'RATE_LIMIT';
            error.retryAfter = parseInt(retryAfter, 10);
            throw error;
          }

          const err = new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
          err.status = response.status;
          throw err;
        }

        const result = await response.json();

        if (result.usage) {
          this.metrics.tokenCount += result.usage.total_tokens || 0;
        }

        this.logger.debug?.('openai.response', {
          endpoint,
          usage: result.usage
        });

        return result;
      });
    } catch (error) {
      if (!error.code) {
        this.metrics.errors++;
      }
      this.logger.error?.('openai.error', { endpoint, error: error.message });
      throw error;
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/src/2_adapters/ai/OpenAIAdapter.test.mjs -t "retries on fetch failure" --no-coverage`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/ai/OpenAIAdapter.mjs backend/src/2_adapters/ai/OpenAIAdapter.test.mjs
git commit -m "feat(openai): wrap callApi with retry backoff"
```

---

### Task 6: Update getMetrics and resetMetrics

**Files:**
- Modify: `backend/src/2_adapters/ai/OpenAIAdapter.mjs`

**Step 1: Update getMetrics**

Find `getMetrics()` and update the return object:

```javascript
  getMetrics() {
    const ms = Date.now() - this.metrics.startedAt;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    return {
      uptime: {
        ms,
        formatted: `${hours}h ${minutes % 60}m ${seconds % 60}s`
      },
      totals: {
        requests: this.metrics.requestCount,
        tokens: this.metrics.tokenCount,
        errors: this.metrics.errors,
        retries: this.metrics.retryCount
      }
    };
  }
```

**Step 2: Update resetMetrics**

```javascript
  resetMetrics() {
    this.metrics = {
      startedAt: Date.now(),
      requestCount: 0,
      tokenCount: 0,
      errors: 0,
      retryCount: 0
    };
  }
```

**Step 3: Run all tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest backend/src/2_adapters/ai/OpenAIAdapter.test.mjs --no-coverage`

Expected: All tests PASS

**Step 4: Commit**

```bash
git add backend/src/2_adapters/ai/OpenAIAdapter.mjs
git commit -m "feat(openai): include retries in metrics"
```

---

### Task 7: Deploy and verify

**Step 1: Run syntax check**

```bash
node --check backend/src/2_adapters/ai/OpenAIAdapter.mjs
```

Expected: No output (success)

**Step 2: Deploy**

```bash
./deploy.sh
```

**Step 3: Test by sending message to nutribot**

Send a message and check logs for retry behavior:

```bash
ssh homeserver.local 'docker logs daylight-station --tail 50 2>&1' | grep -E "openai\.(retry|error)"
```

Expected: On transient failures, should see `openai.retry` logs before success or final `openai.error`.

**Step 4: Verify metrics endpoint shows retries**

Check that `getMetrics()` now includes `retries` count.
