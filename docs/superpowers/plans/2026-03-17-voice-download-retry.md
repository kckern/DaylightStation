# Voice Download Retry Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add retry logic to the Telegram voice file download so transient network failures don't surface as user-facing errors.

**Architecture:** Add a `retryTransient()` helper to the system utils layer (reusable by any adapter). Wire it into `TelegramVoiceTranscriptionService.#downloadAudio()` to retry on transient `HttpError`s (TIMEOUT, ECONNRESET, etc.) with exponential backoff. 2 retries, 1s base delay.

**Tech Stack:** Node.js, Jest (unit tests), existing `HttpError.isTransient` flag.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `backend/src/0_system/utils/retryTransient.mjs` | Generic retry helper for transient errors |
| Create | `tests/isolated/assembly/infrastructure/utils/retryTransient.test.mjs` | Unit tests for retry helper |
| Modify | `backend/src/1_adapters/messaging/TelegramVoiceTranscriptionService.mjs:112-125` | Use retry in `#downloadAudio` |
| Create | `tests/isolated/assembly/adapters/messaging/TelegramVoiceTranscriptionService.test.mjs` | Unit tests for download retry behavior |

---

### Task 1: Retry Helper Utility

**Files:**
- Create: `backend/src/0_system/utils/retryTransient.mjs`
- Create: `tests/isolated/assembly/infrastructure/utils/retryTransient.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/assembly/infrastructure/utils/retryTransient.test.mjs

import { retryTransient } from '#backend/src/0_system/utils/retryTransient.mjs';

describe('retryTransient', () => {
  it('should return result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retryTransient(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on transient error and succeed', async () => {
    const transientError = new Error('timeout');
    transientError.isTransient = true;
    const fn = jest.fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValue('recovered');

    const result = await retryTransient(fn, { maxAttempts: 3, baseDelay: 0 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on non-transient error', async () => {
    const permanentError = new Error('bad request');
    permanentError.isTransient = false;
    const fn = jest.fn().mockRejectedValue(permanentError);

    await expect(retryTransient(fn, { maxAttempts: 3, baseDelay: 0 }))
      .rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throw after exhausting all attempts', async () => {
    const transientError = new Error('timeout');
    transientError.isTransient = true;
    const fn = jest.fn().mockRejectedValue(transientError);

    await expect(retryTransient(fn, { maxAttempts: 3, baseDelay: 0 }))
      .rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should call onRetry callback between attempts', async () => {
    const transientError = new Error('timeout');
    transientError.isTransient = true;
    const onRetry = jest.fn();
    const fn = jest.fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValue('ok');

    await retryTransient(fn, { maxAttempts: 3, baseDelay: 0, onRetry });
    expect(onRetry).toHaveBeenCalledWith(1, transientError);
  });

  it('should default to 3 attempts and 1000ms base delay', async () => {
    const transientError = new Error('timeout');
    transientError.isTransient = true;
    const fn = jest.fn().mockRejectedValue(transientError);

    const start = Date.now();
    await expect(retryTransient(fn, { baseDelay: 0 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should treat errors without isTransient as non-retryable', async () => {
    const ambiguousError = new Error('unknown');
    const fn = jest.fn().mockRejectedValue(ambiguousError);

    await expect(retryTransient(fn, { baseDelay: 0 })).rejects.toThrow('unknown');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should not retry when maxAttempts is 1', async () => {
    const transientError = new Error('timeout');
    transientError.isTransient = true;
    const onRetry = jest.fn();
    const fn = jest.fn().mockRejectedValue(transientError);

    await expect(retryTransient(fn, { maxAttempts: 1, baseDelay: 0, onRetry }))
      .rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/assembly/infrastructure/utils/retryTransient.test.mjs --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/0_system/utils/retryTransient.mjs

/**
 * Retry a function on transient errors with exponential backoff.
 *
 * Only retries when error.isTransient === true (e.g. HttpError from
 * network timeouts, connection resets, 429s, 5xx).
 *
 * @param {() => Promise<T>} fn - Async function to execute
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=3] - Total attempts (1 = no retry)
 * @param {number} [options.baseDelay=1000] - Base delay in ms (doubles each retry)
 * @param {(attempt: number, error: Error) => void} [options.onRetry] - Called before each retry
 * @returns {Promise<T>}
 */
export async function retryTransient(fn, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelay = options.baseDelay ?? 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt === maxAttempts;
      if (!error.isTransient || isLast) {
        throw error;
      }

      if (options.onRetry) {
        options.onRetry(attempt, error);
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/assembly/infrastructure/utils/retryTransient.test.mjs --no-coverage`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/0_system/utils/retryTransient.mjs tests/isolated/assembly/infrastructure/utils/retryTransient.test.mjs
git commit -m "feat(system): add retryTransient utility for transient error retry with backoff"
```

---

### Task 2: Wire Retry into Voice Download

**Files:**
- Modify: `backend/src/1_adapters/messaging/TelegramVoiceTranscriptionService.mjs:112-125`
- Create: `tests/isolated/assembly/adapters/messaging/TelegramVoiceTranscriptionService.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/assembly/adapters/messaging/TelegramVoiceTranscriptionService.test.mjs

import { TelegramVoiceTranscriptionService } from '#backend/src/1_adapters/messaging/TelegramVoiceTranscriptionService.mjs';

describe('TelegramVoiceTranscriptionService', () => {
  let service;
  let mockOpenai;
  let mockHttpClient;
  let mockLogger;

  beforeEach(() => {
    mockOpenai = {
      transcribe: jest.fn().mockResolvedValue('hello world'),
      isConfigured: jest.fn().mockReturnValue(true),
    };
    mockHttpClient = {
      downloadBuffer: jest.fn().mockResolvedValue(Buffer.from('audio-data')),
    };
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    service = new TelegramVoiceTranscriptionService(
      { openaiAdapter: mockOpenai },
      { httpClient: mockHttpClient, logger: mockLogger },
    );
  });

  describe('transcribeUrl() download retries', () => {
    it('should succeed on first attempt without retry', async () => {
      const result = await service.transcribeUrl('https://telegram.org/file/voice.oga');
      expect(result.text).toBe('hello world');
      expect(mockHttpClient.downloadBuffer).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient download error and recover', async () => {
      const transientError = new Error('fetch failed');
      transientError.isTransient = true;
      transientError.code = 'TIMEOUT';
      mockHttpClient.downloadBuffer
        .mockRejectedValueOnce(transientError)
        .mockResolvedValue(Buffer.from('audio-data'));

      const result = await service.transcribeUrl('https://telegram.org/file/voice.oga');
      expect(result.text).toBe('hello world');
      expect(mockHttpClient.downloadBuffer).toHaveBeenCalledTimes(2);
      // Should log the retry
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'telegram-voice.download.retry',
        expect.objectContaining({ attempt: 1 }),
      );
    });

    it('should NOT retry on non-transient download error', async () => {
      const permanentError = new Error('HTTP 403: Forbidden');
      permanentError.isTransient = false;
      permanentError.code = 'FORBIDDEN';
      mockHttpClient.downloadBuffer.mockRejectedValue(permanentError);

      await expect(service.transcribeUrl('https://telegram.org/file/voice.oga'))
        .rejects.toThrow('Failed to download audio');
      expect(mockHttpClient.downloadBuffer).toHaveBeenCalledTimes(1);
    });

    it('should throw after exhausting retries', async () => {
      const transientError = new Error('fetch failed');
      transientError.isTransient = true;
      transientError.code = 'TIMEOUT';
      mockHttpClient.downloadBuffer.mockRejectedValue(transientError);

      await expect(service.transcribeUrl('https://telegram.org/file/voice.oga'))
        .rejects.toThrow('Failed to download audio');
      expect(mockHttpClient.downloadBuffer).toHaveBeenCalledTimes(3);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/assembly/adapters/messaging/TelegramVoiceTranscriptionService.test.mjs --no-coverage`
Expected: FAIL — retries don't happen yet (download only called once)

- [ ] **Step 3: Modify `#downloadAudio` to use retry**

In `backend/src/1_adapters/messaging/TelegramVoiceTranscriptionService.mjs`, replace the `#downloadAudio` method (lines 112-125):

**Before:**
```javascript
  async #downloadAudio(url) {
    try {
      return await this.#httpClient.downloadBuffer(url);
    } catch (error) {
      this.#logger.error?.('telegram-voice.download.failed', {
        error: error.message,
        code: error.code
      });
      const wrapped = new Error('Failed to download audio');
      wrapped.code = error.code || 'DOWNLOAD_ERROR';
      wrapped.isTransient = error.isTransient || false;
      throw wrapped;
    }
  }
```

**After:**
```javascript
  async #downloadAudio(url) {
    try {
      return await retryTransient(
        () => this.#httpClient.downloadBuffer(url),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          onRetry: (attempt, error) => {
            this.#logger.warn?.('telegram-voice.download.retry', {
              attempt,
              error: error.message,
              code: error.code,
            });
          },
        },
      );
    } catch (error) {
      this.#logger.error?.('telegram-voice.download.failed', {
        error: error.message,
        code: error.code
      });
      const wrapped = new Error('Failed to download audio');
      wrapped.code = error.code || 'DOWNLOAD_ERROR';
      wrapped.isTransient = error.isTransient || false;
      throw wrapped;
    }
  }
```

Also add the import at the top of the file (after the existing imports):
```javascript
import { retryTransient } from '#system/utils/retryTransient.mjs';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/assembly/adapters/messaging/TelegramVoiceTranscriptionService.test.mjs --no-coverage`
Expected: All 4 tests PASS

- [ ] **Step 5: Run the existing HttpClient tests to check for regressions**

Run: `npx jest tests/isolated/assembly/infrastructure/services/HttpClient.test.mjs --no-coverage`
Expected: All existing tests PASS (no changes to HttpClient)

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/messaging/TelegramVoiceTranscriptionService.mjs tests/isolated/assembly/adapters/messaging/TelegramVoiceTranscriptionService.test.mjs
git commit -m "fix(journalist): retry transient download failures for voice messages

Telegram voice file downloads can fail with TIMEOUT or ECONNRESET.
Previously a single failure surfaced the user-facing error. Now retries
up to 3 times with exponential backoff before giving up."
```
