/**
 * DispatchIdempotencyService — dispatch-level idempotency cache.
 *
 * Provides `runWithIdempotency(dispatchId, body, fn)` which memoizes the
 * resolved result of `fn()` under a (dispatchId, bodyHash) key for a
 * configurable TTL (default 60s). Designed for dispatch-level orchestrations
 * like `POST /api/v1/device/:id/load?mode=adopt`, where a caller may retry
 * the same HTTP request and expect the same outcome without re-running
 * multi-step side effects.
 *
 * ## Scope vs SessionControlService
 *
 * This service is **dispatch-level**: one cache entry represents one
 * end-to-end HTTP dispatch (possibly orchestrating multiple commands).
 * Use it from router handlers.
 *
 * `SessionControlService` maintains its own **command-level** idempotency
 * cache keyed on `commandId`. That layer dedupes a single WS-bridged
 * command envelope (the unit used by transport / queue / config / claim).
 * The two caches are orthogonal: a single dispatch may dispatch multiple
 * commands, and each command participates independently in command-level
 * dedup.
 *
 * ## Semantics
 *
 * - **Same dispatchId + same body within TTL** → `fn` is *not* invoked again;
 *   the cached resolved result is returned.
 * - **Same dispatchId + different body within TTL** → throws
 *   `IdempotencyConflictError`. Callers generate fresh dispatchIds per intent.
 * - **New or expired dispatchId** → `fn` runs, and on *resolve* the result is
 *   cached. On *reject*, the entry is removed so the next call re-runs
 *   `fn` (partial/failed dispatches are safe to retry).
 *
 * @module applications/devices/services
 */

const DEFAULT_TTL_MS = 60_000;

/**
 * Thrown by `runWithIdempotency` when the same dispatchId is re-submitted
 * with a different payload within TTL.
 */
export class IdempotencyConflictError extends Error {
  constructor(message = 'Idempotency conflict: same dispatchId with different payload') {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.code = 'IDEMPOTENCY_CONFLICT';
  }
}

/**
 * Stable recursive JSON serialization — sorts object keys so that logically
 * equal bodies fingerprint the same regardless of JSON key order. Exported
 * for callers that want to pre-compute hashes or share the fingerprint
 * format.
 *
 * @param {*} value
 * @returns {string}
 */
export function stableStringify(value) {
  const seen = new WeakSet();
  function walk(v) {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const keys = Object.keys(v).sort();
    const out = {};
    for (const k of keys) out[k] = walk(v[k]);
    return out;
  }
  return JSON.stringify(walk(value));
}

/**
 * @typedef {Object} IdempotencyCacheEntry
 * @property {number}      recordedAt  - Epoch ms when resolved result was cached
 * @property {string}      bodyHash    - stableStringify(body) at that time
 * @property {*}           result      - Resolved value of fn()
 */

export class DispatchIdempotencyService {
  #clock;
  #ttlMs;
  #logger;
  /** @type {Map<string, IdempotencyCacheEntry>} */
  #cache = new Map();

  /**
   * @param {Object} deps
   * @param {{ now: () => number } | DateConstructor} [deps.clock=Date]
   * @param {number} [deps.ttlMs=60000]
   * @param {Object} [deps.logger]
   */
  constructor(deps = {}) {
    this.#clock = deps.clock || Date;
    this.#ttlMs = Number.isFinite(deps.ttlMs) && deps.ttlMs > 0
      ? deps.ttlMs
      : DEFAULT_TTL_MS;
    this.#logger = deps.logger || null;
  }

  /**
   * Run `fn` at most once per (dispatchId, bodyHash) within TTL.
   *
   * @param {string} dispatchId
   * @param {*}      body        - Any JSON-serializable payload describing the dispatch
   * @param {() => Promise<*>} fn
   * @returns {Promise<*>}       Whatever `fn` resolved to (or cached prior result)
   * @throws {IdempotencyConflictError} when dispatchId matches but body differs
   */
  async runWithIdempotency(dispatchId, body, fn) {
    if (typeof dispatchId !== 'string' || dispatchId.length === 0) {
      throw new TypeError('dispatchId must be a non-empty string');
    }
    if (typeof fn !== 'function') {
      throw new TypeError('fn must be a function');
    }

    this.#evictExpired();

    const bodyHash = stableStringify(body);
    const cached = this.#cache.get(dispatchId);

    if (cached) {
      if (cached.bodyHash === bodyHash) {
        this.#logger?.debug?.('dispatch-idempotency.replay', { dispatchId });
        return cached.result;
      }
      this.#logger?.warn?.('dispatch-idempotency.conflict', { dispatchId });
      throw new IdempotencyConflictError();
    }

    let result;
    try {
      result = await fn();
    } catch (err) {
      // Do not cache rejected results — the failure may be transient and
      // the caller should be free to retry (with a fresh dispatchId or
      // the same, since no entry is recorded here).
      this.#logger?.debug?.('dispatch-idempotency.fn_rejected', {
        dispatchId,
        error: err?.message,
      });
      throw err;
    }

    this.#cache.set(dispatchId, {
      recordedAt: this.#now(),
      bodyHash,
      result,
    });
    return result;
  }

  /**
   * Remove any entries older than TTL. Called automatically on each
   * `runWithIdempotency` call; exposed for tests and future explicit
   * maintenance hooks.
   */
  evictExpired() {
    this.#evictExpired();
  }

  /** Current cache size (tests/metrics). */
  get size() {
    return this.#cache.size;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  #now() {
    return typeof this.#clock.now === 'function'
      ? this.#clock.now()
      : Date.now();
  }

  #evictExpired() {
    const now = this.#now();
    for (const [id, entry] of this.#cache) {
      if (now - entry.recordedAt > this.#ttlMs) this.#cache.delete(id);
    }
  }
}

export default DispatchIdempotencyService;
