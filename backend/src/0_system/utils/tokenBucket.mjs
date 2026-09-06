/**
 * A keyed token bucket — the accounting half of every rate limit in the app.
 *
 * EXTRACTED, NOT COPIED (2026-09-06). This logic was written once, inside
 * `1_adapters/logging/ingestRateLimiter.mjs`, and shaped around log events: its
 * `check()` took a normalized log record, derived a key from
 * `context.ip`/`app`/`component`, and returned a synthetic log line to emit.
 * The school panel needs the same arithmetic against a completely different
 * key — a device typing wrong access codes — and a second hand-written bucket
 * is how two limiters drift until one of them quietly stops limiting.
 *
 * So the ARITHMETIC lives here and the POLICY lives with each caller. This
 * module knows nothing about log events, HTTP, or what a key means; it does not
 * decide what to do when a caller is denied, and it emits nothing.
 *
 * It lives in `0_system` because both an adapter and a composition root need
 * it, and `0_system` is the one layer both may import from. It reads no clock
 * of its own — `now` is injected, so tests never sleep.
 *
 * WHAT A BUCKET IS NOT: durable. Everything is in memory and per process, so a
 * restart hands everyone a fresh allowance and eviction under pressure does the
 * same to whoever has been quiet longest. That is the right trade for a limiter
 * whose job is to blunt a burst — losing state costs one extra burst, never
 * correctness — and the wrong one for anything that must be counted exactly.
 * A use CAP is counted on the record, not here.
 *
 * @module system/utils/tokenBucket
 */

/** Enough headroom for a normal flurry; low enough that a flood is caught. */
export const DEFAULT_CAPACITY = 30;
/** Sustained rate once the initial burst is spent. */
export const DEFAULT_REFILL_PER_MINUTE = 3;
/** Bounded so a key with unbounded cardinality cannot grow the map forever. */
export const DEFAULT_MAX_BUCKETS = 5_000;

/**
 * @param {object} [options]
 * @param {number} [options.capacity] burst size, in tokens
 * @param {number} [options.refillPerMinute] sustained rate
 * @param {number} [options.maxBuckets] eviction ceiling
 * @param {() => number} [options.now] injected epoch-ms clock
 * @returns {{take: (key: string) => {allow: boolean, bucket: object},
 *   peek: (key: string) => object|null, size: () => number, reset: () => void}}
 */
export function createTokenBucket({
  capacity = DEFAULT_CAPACITY,
  refillPerMinute = DEFAULT_REFILL_PER_MINUTE,
  maxBuckets = DEFAULT_MAX_BUCKETS,
  now = () => Date.now(),
} = {}) {
  const buckets = new Map();
  const refillPerMs = refillPerMinute / 60_000;

  const evictIdlest = () => {
    // Cheap approximation of LRU: drop the single least-recently-touched entry.
    // Buckets are only an optimisation — losing one costs a fresh burst
    // allowance, never correctness.
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [key, b] of buckets) {
      if (b.lastSeen < oldestAt) { oldestAt = b.lastSeen; oldestKey = key; }
    }
    if (oldestKey !== null) buckets.delete(oldestKey);
  };

  return {
    /**
     * Spend one token for `key`.
     *
     * Returns the bucket alongside the verdict so a caller can hang its own
     * bookkeeping on it — the logging limiter keeps a suppressed count and a
     * last-summary timestamp there. Anything a caller writes onto the returned
     * object survives until that bucket is evicted, and this module never reads
     * it.
     */
    take(key) {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxBuckets) evictIdlest();
        b = { tokens: capacity, lastRefill: t, lastSeen: t };
        buckets.set(key, b);
      }
      b.tokens = Math.min(capacity, b.tokens + (t - b.lastRefill) * refillPerMs);
      b.lastRefill = t;
      b.lastSeen = t;

      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { allow: true, bucket: b };
      }
      return { allow: false, bucket: b };
    },

    /** The bucket for `key` without spending anything, or null. */
    peek(key) { return buckets.get(key) ?? null; },

    /** Test/diagnostic seams. */
    size() { return buckets.size; },
    reset() { buckets.clear(); },
  };
}

export default createTokenBucket;
