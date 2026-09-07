/**
 * Voice-memo artifact lifecycle — the pure policy behind durable capture.
 *
 * WHY THIS EXISTS. Fitness voice memos used to treat transcription as a
 * prerequisite for keeping the recording: capture in the browser, POST to the
 * provider, persist only on success. On 2026-09-07 that turned a provider
 * quota outage into permanent data loss — one upload took an HTTP 429
 * (`insufficient_quota`) and a second was discarded in the browser before it
 * ever reached the network. Nothing survived either failure.
 *
 * Capture and transcription are therefore two durable stages, and this module
 * owns the rules that connect them: how a provider failure is CLASSIFIED, when
 * a retry is DUE, when a lease is stale, and when the raw audio must go. It is
 * deliberately free of I/O and clocks so the policy can be tested exhaustively
 * without a filesystem or a provider.
 *
 * Mirrors the decision nutrition already made for the same failure on
 * 2026-09-04 (see VoiceMemoStore): bytes on disk are the only thing that makes
 * a transient upstream failure recoverable.
 */

/** Lifecycle states. A record is in exactly one at rest. */
export const ARTIFACT_STATES = Object.freeze({
  /** Audio persisted; no transcription attempt has started. */
  PENDING: 'pending',
  /** An attempt holds a lease. Reclaimed by the worker if the lease goes stale. */
  PROCESSING: 'processing',
  /** Last attempt failed for a retryable reason; `nextAttemptAt` is set. */
  RETRYABLE: 'retryable',
  /** Transcript persisted and linked to the memo; raw audio purged. */
  TRANSCRIBED: 'transcribed',
  /** Retention elapsed before success; raw audio purged, failure record kept. */
  EXPIRED: 'expired',
  /** Non-retryable failure, or the retry budget ran out. Audio kept until retention. */
  PERMANENTLY_FAILED: 'permanently_failed',
});

const TERMINAL_STATES = new Set([
  ARTIFACT_STATES.TRANSCRIBED,
  ARTIFACT_STATES.EXPIRED,
  ARTIFACT_STATES.PERMANENTLY_FAILED,
]);

export function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

/**
 * Failure classifications. These are the ONLY strings that reach a log or an
 * API response — the provider's message, headers, and response body never do.
 */
export const FAILURE_CLASSES = Object.freeze({
  NETWORK_TIMEOUT: 'network_timeout',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  RATE_LIMITED: 'rate_limited',
  QUOTA_EXHAUSTED: 'quota_exhausted',
  AUTH_FAILED: 'auth_failed',
  INVALID_AUDIO: 'invalid_audio',
  UNKNOWN: 'unknown',
});

/**
 * Only these classes are scheduled automatically. `auth_failed` and
 * `invalid_audio` are excluded on purpose: neither improves by being retried,
 * and hammering a rejected key is how an account gets locked. Both keep their
 * audio until retention so a human can retry once the cause is fixed.
 */
const RETRYABLE_CLASSES = new Set([
  FAILURE_CLASSES.NETWORK_TIMEOUT,
  FAILURE_CLASSES.PROVIDER_UNAVAILABLE,
  FAILURE_CLASSES.RATE_LIMITED,
  FAILURE_CLASSES.QUOTA_EXHAUSTED,
  FAILURE_CLASSES.UNKNOWN,
]);

export function isRetryableClass(classification) {
  return RETRYABLE_CLASSES.has(classification);
}

/** Node/undici socket-level codes that mean "the network, not the request". */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN',
  'EPIPE', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

/** Provider codes/types that mean "the account is out of credit", not "slow down". */
const QUOTA_MARKERS = new Set([
  'insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached',
  'account_deactivated',
]);

const TRANSIENT_MESSAGE_FRAGMENTS = [
  'fetch failed', 'socket hang up', 'timed out', 'timeout', 'network error',
];

/**
 * Retry schedules, per class, in milliseconds after each failed attempt.
 *
 * `quota_exhausted` gets its own, much slower ladder because it does not clear
 * on its own: someone has to add credit. Retrying it every minute would burn
 * the budget in the first ten minutes of an outage that lasts until a human
 * notices, which is precisely how the 2026-09-07 recordings would have been
 * lost a second time.
 */
const RETRY_SCHEDULES = Object.freeze({
  [FAILURE_CLASSES.QUOTA_EXHAUSTED]: [30 * 60_000, 60 * 60_000, 2 * 3600_000, 6 * 3600_000, 12 * 3600_000],
  default: [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 3600_000],
});

/** Total transcription attempts (the inline one plus retries) before giving up. */
export const MAX_ATTEMPTS = 6;

/** How long an in-flight attempt may hold its lease before a worker reclaims it. */
export const ATTEMPT_LEASE_MS = 5 * 60_000;

/** How long raw audio is kept for an artifact that has not been transcribed. */
export const RAW_AUDIO_RETENTION_MS = 7 * 24 * 3600_000;

/** How long the (audio-free) lifecycle record is kept once it is terminal. */
export const RECORD_RETENTION_MS = 30 * 24 * 3600_000;

/** Largest capture accepted. ~5 min of Opus is ≈1.2MB; this is deliberate headroom. */
export const MAX_ARTIFACT_BYTES = 12 * 1024 * 1024;

/**
 * Reduce a thrown provider error to an allowlisted classification.
 *
 * Reads ONLY fields whose shape we control the interpretation of — HTTP
 * status, the provider's own `code`/`type` strings, and the request id. The
 * message is consulted for transient network fragments and then discarded;
 * it is never part of the returned record.
 *
 * @param {Error|any} error
 * @returns {{classification: string, retryable: boolean, providerStatus: number|null,
 *   providerCode: string|null, providerType: string|null, requestId: string|null}}
 */
export function classifyTranscriptionFailure(error) {
  const providerError = error?.response?.data?.error ?? error?.apiError ?? null;
  const status = numberOrNull(error?.response?.status ?? error?.status);
  const providerCode = stringOrNull(providerError?.code ?? error?.code);
  const providerType = stringOrNull(providerError?.type);
  const requestId = stringOrNull(error?.response?.headers?.['x-request-id']);
  const socketCode = stringOrNull(error?.cause?.code ?? error?.errno_code);
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';

  const classification = resolveClassification({
    status, providerCode, providerType, socketCode, message,
  });

  return {
    classification,
    retryable: isRetryableClass(classification),
    providerStatus: status,
    // A socket code arrives on `error.code` too; keep it out of `providerCode`
    // so "the network hung up" is never mistaken for a provider verdict.
    providerCode: providerCode && providerCode !== socketCode ? providerCode : null,
    providerType,
    requestId,
    networkCode: socketCode,
  };
}

function resolveClassification({ status, providerCode, providerType, socketCode, message }) {
  if (socketCode && TRANSIENT_NETWORK_CODES.has(socketCode)) return FAILURE_CLASSES.NETWORK_TIMEOUT;

  const quotaMarked = QUOTA_MARKERS.has(providerCode) || QUOTA_MARKERS.has(providerType);
  // Quota is checked before the status ladder: it arrives as a 429 that looks
  // exactly like rate limiting but is fixed by billing, not by waiting a minute.
  if (quotaMarked || status === 402) return FAILURE_CLASSES.QUOTA_EXHAUSTED;

  if (status === 429) return FAILURE_CLASSES.RATE_LIMITED;
  if (status === 401 || status === 403) return FAILURE_CLASSES.AUTH_FAILED;
  if (status === 400 || status === 413 || status === 415 || status === 422) return FAILURE_CLASSES.INVALID_AUDIO;
  if (status !== null && status >= 500 && status < 600) return FAILURE_CLASSES.PROVIDER_UNAVAILABLE;

  if (!status && TRANSIENT_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment))) {
    return FAILURE_CLASSES.NETWORK_TIMEOUT;
  }
  return FAILURE_CLASSES.UNKNOWN;
}

/**
 * Delay before the next attempt, given the class and how many attempts have
 * already been made. Past the end of a schedule the last rung repeats, so a
 * long outage backs off to a steady interval rather than off a cliff.
 *
 * @param {string} classification
 * @param {number} attempts - attempts made SO FAR, including the one that just failed
 * @returns {number} milliseconds
 */
export function nextAttemptDelayMs(classification, attempts) {
  const schedule = RETRY_SCHEDULES[classification] || RETRY_SCHEDULES.default;
  const index = Math.min(Math.max(attempts - 1, 0), schedule.length - 1);
  return schedule[index];
}

/**
 * The record patch for a failed attempt.
 *
 * @param {Object} record - current lifecycle record
 * @param {Object} failure - the result of classifyTranscriptionFailure
 * @param {number} now - epoch ms
 * @returns {Object} fields to merge into the record
 */
export function applyFailure(record, failure, now) {
  const attempts = (record?.attempts || 0) + 1;
  const budgetLeft = attempts < MAX_ATTEMPTS;
  const willRetry = failure.retryable && budgetLeft;

  return {
    attempts,
    state: willRetry ? ARTIFACT_STATES.RETRYABLE : ARTIFACT_STATES.PERMANENTLY_FAILED,
    nextAttemptAt: willRetry ? now + nextAttemptDelayMs(failure.classification, attempts) : null,
    attemptStartedAt: null,
    lastFailure: {
      classification: failure.classification,
      retryable: failure.retryable,
      providerStatus: failure.providerStatus ?? null,
      providerCode: failure.providerCode ?? null,
      providerType: failure.providerType ?? null,
      networkCode: failure.networkCode ?? null,
      requestId: failure.requestId ?? null,
      at: now,
    },
    // Distinguishes "we stopped trying because the class is hopeless" from
    // "we ran out of budget" on the staff view without re-deriving it there.
    ...(willRetry ? {} : { givenUpReason: failure.retryable ? 'retry_budget_exhausted' : 'not_retryable' }),
    updatedAt: now,
  };
}

/** Is this record ready for another transcription attempt right now? */
export function isDue(record, now) {
  if (!record) return false;
  if (record.state === ARTIFACT_STATES.PENDING) return true;
  if (record.state !== ARTIFACT_STATES.RETRYABLE) return false;
  return (record.nextAttemptAt ?? 0) <= now;
}

/**
 * Did a `processing` attempt die without releasing its lease? A crashed or
 * redeployed backend leaves records mid-flight; without this they would sit in
 * `processing` forever and the recording would be just as lost as before.
 */
export function isLeaseStale(record, now, leaseMs = ATTEMPT_LEASE_MS) {
  if (record?.state !== ARTIFACT_STATES.PROCESSING) return false;
  return now - (record.attemptStartedAt ?? 0) >= leaseMs;
}

/**
 * What retention says to do with a record right now.
 *
 * - `purge_audio`: the transcript landed, or the artifact is terminal and the
 *   audio has outlived its retention window.
 * - `expire`: never transcribed and out of time — audio goes, record stays so
 *   staff can see the memo existed and why it has no transcript.
 * - `delete_record`: the whole (audio-free) record has aged out.
 * - `keep`: nothing to do.
 *
 * @param {Object} record
 * @param {number} now
 * @param {{rawAudioRetentionMs?: number, recordRetentionMs?: number}} [policy]
 */
export function retentionDecision(record, now, policy = {}) {
  const rawAudioRetentionMs = policy.rawAudioRetentionMs ?? RAW_AUDIO_RETENTION_MS;
  const recordRetentionMs = policy.recordRetentionMs ?? RECORD_RETENTION_MS;
  if (!record) return 'keep';

  const age = now - (record.capturedAt ?? now);
  const settledFor = now - (record.updatedAt ?? record.capturedAt ?? now);

  if (isTerminalState(record.state)) {
    // A transcript makes the audio redundant, so it goes at once. A permanent
    // failure does NOT: its audio is exactly what a human retry needs once the
    // key is replaced or the credit is restored, so it keeps the full window.
    const audioMayStay = record.state === ARTIFACT_STATES.PERMANENTLY_FAILED && age < rawAudioRetentionMs;
    if (record.audioPurgedAt == null && !audioMayStay) return 'purge_audio';
    if (record.audioPurgedAt != null && settledFor >= recordRetentionMs) return 'delete_record';
    return 'keep';
  }

  if (age >= rawAudioRetentionMs) return 'expire';
  return 'keep';
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length ? value : null;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}
