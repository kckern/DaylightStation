import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_STATES, FAILURE_CLASSES, MAX_ATTEMPTS, RAW_AUDIO_RETENTION_MS, RECORD_RETENTION_MS,
  classifyTranscriptionFailure, applyFailure, nextAttemptDelayMs, isDue, isLeaseStale,
  retentionDecision, isRetryableClass,
} from './voiceMemoArtifactLifecycle.mjs';

/** The provider error shape OpenAIAdapter actually throws. */
function providerError({ status, code, type, requestId, message = 'AI API error' } = {}) {
  const error = new Error(message);
  error.status = status;
  if (code || type) error.apiError = { code, type };
  if (requestId) error.response = { status, headers: { 'x-request-id': requestId } };
  return error;
}

function socketError(code, message = 'fetch failed') {
  const error = new Error(message);
  error.cause = { code };
  return error;
}

describe('classifyTranscriptionFailure', () => {
  it('separates the four failures the 2026-09-07 incident could not tell apart', () => {
    expect(classifyTranscriptionFailure(socketError('ETIMEDOUT')).classification)
      .toBe(FAILURE_CLASSES.NETWORK_TIMEOUT);
    expect(classifyTranscriptionFailure(providerError({ status: 401 })).classification)
      .toBe(FAILURE_CLASSES.AUTH_FAILED);
    expect(classifyTranscriptionFailure(providerError({ status: 400 })).classification)
      .toBe(FAILURE_CLASSES.INVALID_AUDIO);
    expect(classifyTranscriptionFailure(providerError({ status: 429, code: 'insufficient_quota' })).classification)
      .toBe(FAILURE_CLASSES.QUOTA_EXHAUSTED);
  });

  it('distinguishes an exhausted balance from plain rate limiting on the same 429', () => {
    // The whole point: HTTP 429 alone cannot say whether waiting will help.
    expect(classifyTranscriptionFailure(providerError({ status: 429 })).classification)
      .toBe(FAILURE_CLASSES.RATE_LIMITED);
    expect(classifyTranscriptionFailure(providerError({ status: 429, type: 'credit_balance_exhausted' })).classification)
      .toBe(FAILURE_CLASSES.QUOTA_EXHAUSTED);
  });

  it('treats 5xx as the provider being down, and an unlabelled failure as unknown', () => {
    expect(classifyTranscriptionFailure(providerError({ status: 503 })).classification)
      .toBe(FAILURE_CLASSES.PROVIDER_UNAVAILABLE);
    expect(classifyTranscriptionFailure(new Error('something odd')).classification)
      .toBe(FAILURE_CLASSES.UNKNOWN);
  });

  it('reads a bare socket hang up as network, not as an unknown bug', () => {
    expect(classifyTranscriptionFailure(new Error('socket hang up')).classification)
      .toBe(FAILURE_CLASSES.NETWORK_TIMEOUT);
  });

  it('schedules only the classes that can improve without a human', () => {
    expect(isRetryableClass(FAILURE_CLASSES.NETWORK_TIMEOUT)).toBe(true);
    expect(isRetryableClass(FAILURE_CLASSES.RATE_LIMITED)).toBe(true);
    expect(isRetryableClass(FAILURE_CLASSES.QUOTA_EXHAUSTED)).toBe(true);
    expect(isRetryableClass(FAILURE_CLASSES.AUTH_FAILED)).toBe(false);
    expect(isRetryableClass(FAILURE_CLASSES.INVALID_AUDIO)).toBe(false);
  });

  it('carries the provider request id but never the message or a body', () => {
    const failure = classifyTranscriptionFailure(providerError({
      status: 429, code: 'insufficient_quota', requestId: 'req_abc123',
      message: 'You exceeded your current quota, please check your plan and billing details',
    }));
    expect(failure.requestId).toBe('req_abc123');
    expect(failure.providerCode).toBe('insufficient_quota');
    expect(JSON.stringify(failure)).not.toMatch(/billing details/);
  });

  it('does not report a socket code as if the provider had returned it', () => {
    const failure = classifyTranscriptionFailure(socketError('ECONNRESET'));
    expect(failure.networkCode).toBe('ECONNRESET');
    expect(failure.providerCode).toBeNull();
  });
});

describe('applyFailure', () => {
  const NOW = 1_700_000_000_000;

  it('keeps a retryable failure alive with a scheduled next attempt', () => {
    const patch = applyFailure({ attempts: 0 }, classifyTranscriptionFailure(providerError({ status: 429 })), NOW);
    expect(patch.state).toBe(ARTIFACT_STATES.RETRYABLE);
    expect(patch.attempts).toBe(1);
    expect(patch.nextAttemptAt).toBeGreaterThan(NOW);
    expect(patch.lastFailure.classification).toBe(FAILURE_CLASSES.RATE_LIMITED);
  });

  it('gives up immediately on a class no retry can fix', () => {
    const patch = applyFailure({ attempts: 0 }, classifyTranscriptionFailure(providerError({ status: 401 })), NOW);
    expect(patch.state).toBe(ARTIFACT_STATES.PERMANENTLY_FAILED);
    expect(patch.nextAttemptAt).toBeNull();
    expect(patch.givenUpReason).toBe('not_retryable');
  });

  it('gives up on a retryable class once the budget is spent, and says which it was', () => {
    const patch = applyFailure(
      { attempts: MAX_ATTEMPTS - 1 },
      classifyTranscriptionFailure(socketError('ETIMEDOUT')),
      NOW,
    );
    expect(patch.attempts).toBe(MAX_ATTEMPTS);
    expect(patch.state).toBe(ARTIFACT_STATES.PERMANENTLY_FAILED);
    expect(patch.givenUpReason).toBe('retry_budget_exhausted');
  });

  it('releases the lease so a failed attempt cannot look in-flight forever', () => {
    const patch = applyFailure({ attempts: 0, attemptStartedAt: NOW - 1000 },
      classifyTranscriptionFailure(providerError({ status: 500 })), NOW);
    expect(patch.attemptStartedAt).toBeNull();
  });
});

describe('nextAttemptDelayMs', () => {
  it('backs off on a much slower ladder for a failure only a human can clear', () => {
    // Retrying an exhausted balance every minute burns the whole budget before
    // anyone notices the account needs credit.
    expect(nextAttemptDelayMs(FAILURE_CLASSES.QUOTA_EXHAUSTED, 1))
      .toBeGreaterThan(nextAttemptDelayMs(FAILURE_CLASSES.RATE_LIMITED, 1));
    expect(nextAttemptDelayMs(FAILURE_CLASSES.QUOTA_EXHAUSTED, 1)).toBe(30 * 60_000);
  });

  it('grows with each attempt and then holds steady rather than falling off the end', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map((n) => nextAttemptDelayMs(FAILURE_CLASSES.NETWORK_TIMEOUT, n));
    for (let i = 1; i < 5; i += 1) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    expect(delays[6]).toBe(delays[5]);
  });
});

describe('isDue / isLeaseStale', () => {
  const NOW = 1_700_000_000_000;

  it('runs a pending capture immediately and a retryable one only when its time comes', () => {
    expect(isDue({ state: ARTIFACT_STATES.PENDING }, NOW)).toBe(true);
    expect(isDue({ state: ARTIFACT_STATES.RETRYABLE, nextAttemptAt: NOW + 1000 }, NOW)).toBe(false);
    expect(isDue({ state: ARTIFACT_STATES.RETRYABLE, nextAttemptAt: NOW - 1 }, NOW)).toBe(true);
  });

  it('never re-runs a settled artifact', () => {
    for (const state of [ARTIFACT_STATES.TRANSCRIBED, ARTIFACT_STATES.EXPIRED, ARTIFACT_STATES.PERMANENTLY_FAILED]) {
      expect(isDue({ state, nextAttemptAt: 0 }, NOW)).toBe(false);
    }
  });

  it('reclaims a lease left behind by a crash, but not one still in its window', () => {
    expect(isLeaseStale({ state: ARTIFACT_STATES.PROCESSING, attemptStartedAt: NOW - 1000 }, NOW, 60_000)).toBe(false);
    expect(isLeaseStale({ state: ARTIFACT_STATES.PROCESSING, attemptStartedAt: NOW - 120_000 }, NOW, 60_000)).toBe(true);
    expect(isLeaseStale({ state: ARTIFACT_STATES.RETRYABLE, attemptStartedAt: 0 }, NOW, 60_000)).toBe(false);
  });
});

describe('retentionDecision', () => {
  const NOW = 1_700_000_000_000;
  const fresh = { capturedAt: NOW - 1000, updatedAt: NOW - 1000 };

  it('purges the audio the moment a transcript exists', () => {
    expect(retentionDecision({ ...fresh, state: ARTIFACT_STATES.TRANSCRIBED, audioPurgedAt: null }, NOW))
      .toBe('purge_audio');
  });

  it('keeps a permanently failed recording for the full window so a human can retry it', () => {
    const record = { capturedAt: NOW - 1000, updatedAt: NOW - 1000, state: ARTIFACT_STATES.PERMANENTLY_FAILED, audioPurgedAt: null };
    expect(retentionDecision(record, NOW)).toBe('keep');
    expect(retentionDecision({ ...record, capturedAt: NOW - RAW_AUDIO_RETENTION_MS - 1 }, NOW)).toBe('purge_audio');
  });

  it('expires a capture that ran out of time before it ever became a memo', () => {
    const stranded = { state: ARTIFACT_STATES.RETRYABLE, capturedAt: NOW - RAW_AUDIO_RETENTION_MS - 1, updatedAt: NOW };
    expect(retentionDecision(stranded, NOW)).toBe('expire');
    expect(retentionDecision({ ...stranded, capturedAt: NOW - 1000 }, NOW)).toBe('keep');
  });

  it('drops the audio-free record only after it has been settled for the record window', () => {
    const settled = {
      state: ARTIFACT_STATES.TRANSCRIBED, audioPurgedAt: NOW - RECORD_RETENTION_MS,
      capturedAt: NOW - RECORD_RETENTION_MS, updatedAt: NOW - RECORD_RETENTION_MS,
    };
    expect(retentionDecision(settled, NOW)).toBe('delete_record');
    expect(retentionDecision({ ...settled, updatedAt: NOW - 1000 }, NOW)).toBe('keep');
  });
});
