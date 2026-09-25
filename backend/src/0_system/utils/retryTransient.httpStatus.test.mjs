/**
 * A raw axios HTTP failure (code ERR_BAD_RESPONSE, status on error.response)
 * is retried when the status is 429/5xx — the shape of the Whisper 502 that
 * lost a voice revision on 2026-09-24 — and never for a 4xx.
 */
import { describe, it, expect, vi } from 'vitest';
import { retryTransient, isTransientError, isQuotaExhausted } from './retryTransient.mjs';

// The real error, as logged: message, code, and axios' response object.
const axios502 = () => Object.assign(new Error('Request failed with status code 502'), { code: 'ERR_BAD_RESPONSE', response: { status: 502 } });
const axios400 = () => Object.assign(new Error('Request failed with status code 400'), { code: 'ERR_BAD_REQUEST', response: { status: 400 } });

describe('retryTransient — HTTP status', () => {
  it('classifies raw axios 5xx/429 as transient and 4xx as not', () => {
    expect(isTransientError(axios502())).toBe(true);
    expect(isTransientError(Object.assign(new Error('x'), { response: { status: 429 } }))).toBe(true);
    expect(isTransientError(axios400())).toBe(false);
  });

  it('retries a Whisper-style 502 and succeeds on the next attempt', async () => {
    const fn = vi.fn().mockRejectedValueOnce(axios502()).mockResolvedValueOnce({ text: 'add a side of rice' });
    const onRetry = vi.fn();
    await expect(retryTransient(fn, { maxAttempts: 3, baseDelay: 1, onRetry })).resolves.toEqual({ text: 'add a side of rice' });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not retry a 400', async () => {
    const fn = vi.fn().mockRejectedValue(axios400());
    await expect(retryTransient(fn, { maxAttempts: 3, baseDelay: 1 })).rejects.toThrow('400');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // An exhausted balance is also a 429, but no retry can succeed (2026-09-10
  // outage: every call waited out its retries on "no credits remaining").
  const quota429 = () => Object.assign(new Error('Request failed with status code 429'), {
    code: 'ERR_BAD_REQUEST',
    response: { status: 429, data: { error: { type: 'insufficient_quota', code: 'credit_balance_exhausted' } } },
  });

  it('never treats an exhausted balance as transient, however it arrives', () => {
    expect(isQuotaExhausted(quota429())).toBe(true);
    expect(isTransientError(quota429())).toBe(false);
    const adapterShape = Object.assign(new Error('You have no credits remaining.'), {
      status: 429, code: 'QUOTA_EXHAUSTED', apiError: { type: 'insufficient_quota' },
    });
    expect(isQuotaExhausted(adapterShape)).toBe(true);
    expect(isTransientError(adapterShape)).toBe(false);
    const billing = Object.assign(new Error('x'), { response: { status: 429, data: { error: { code: 'billing_hard_limit_reached' } } } });
    expect(isTransientError(billing)).toBe(false);
    // a plain rate limit stays transient
    expect(isQuotaExhausted(Object.assign(new Error('x'), { response: { status: 429, data: { error: { type: 'requests' } } } }))).toBe(false);
  });

  it('does not retry an exhausted balance', async () => {
    const fn = vi.fn().mockRejectedValue(quota429());
    await expect(retryTransient(fn, { maxAttempts: 3, baseDelay: 1 })).rejects.toThrow('429');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
