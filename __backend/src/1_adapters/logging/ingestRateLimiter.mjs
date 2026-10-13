/**
 * Ingest rate limiter — a ceiling on how much one client can say about one
 * thing, applied at the frontend log ingestion boundary.
 *
 * WHY THIS EXISTS. Frontend logging is only as well-behaved as the oldest
 * browser tab still running it. Two forgotten Chrome tabs on a laptop retried a
 * localhost WebSocket for ~49 hours and emitted ~1,000 `bridge.socket-error`
 * rows an hour at ERROR level — 100% of the log store's error volume, pushing
 * genuine errors toward the edge of a 7-day retention window. The client-side
 * fix for that specific bug shipped, but those tabs were running JavaScript
 * loaded BEFORE it existed and kept flooding regardless. That is the general
 * shape of the problem: a client-side logging fix cannot reach a client that
 * never reloads, so the server needs its own floor.
 *
 * SHAPE: a token bucket per (client, event) pair.
 *
 * Keying on the CLIENT as well as the event is the point. A shared per-event
 * bucket would let one broken laptop exhaust the budget for `bridge.socket-error`
 * and silence the real tablet's report of the same failure — turning a noise
 * problem into a blindness problem. Separate buckets mean a flood is contained
 * to the client producing it.
 *
 * BURST OVER RATE: capacity is generous (a real incident announces itself in a
 * burst and should arrive intact) while the sustained refill is deliberately
 * low. That combination passes a genuine 30-event failure immediately and still
 * clips an indefinite 16/min drip to a trickle.
 *
 * NOTHING IS SILENTLY LOST: suppression is counted, and a `log.ingest.throttled`
 * summary naming the key and the suppressed count is emitted when a bucket
 * first throttles and periodically while it stays throttled. A count you can
 * see is diagnosis; a gap you cannot is a second bug.
 */

/** Burst allowance per (client, event). A real incident arrives all at once. */
export const DEFAULT_CAPACITY = 30;
/** Sustained refill. 3/min turns an indefinite flood into a trickle. */
export const DEFAULT_REFILL_PER_MIN = 3;
/** How often a still-throttled bucket re-announces its suppressed count. */
export const DEFAULT_SUMMARY_INTERVAL_MS = 60_000;
/** Bucket ceiling. Beyond this, the idlest buckets are evicted. */
export const DEFAULT_MAX_BUCKETS = 5_000;

const shortHash = (value) => {
  // Non-cryptographic; only needs to keep distinct clients in distinct buckets
  // and keep long user-agent strings out of the key.
  let h = 5381;
  const s = String(value || '');
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/**
 * Identity of the thing being said, and who is saying it.
 * `component` is included because it is the unit a flood actually belongs to
 * (`piano-bridge-notes`), not the coarser app.
 */
export function ingestRateKey(event) {
  const ctx = event?.context || {};
  const client = shortHash(`${ctx.ip || ''}|${ctx.userAgent || ''}`);
  return `${client}|${ctx.app || ''}|${ctx.component || ''}|${event?.event || ''}|${event?.level || ''}`;
}

/**
 * @param {object} [options]
 * @param {number} [options.capacity]
 * @param {number} [options.refillPerMinute]
 * @param {number} [options.summaryIntervalMs]
 * @param {number} [options.maxBuckets]
 * @param {() => number} [options.now] injected clock, so tests do not sleep
 */
import { createTokenBucket } from '#system/utils/tokenBucket.mjs';

export function createIngestRateLimiter({
  capacity = DEFAULT_CAPACITY,
  refillPerMinute = DEFAULT_REFILL_PER_MIN,
  summaryIntervalMs = DEFAULT_SUMMARY_INTERVAL_MS,
  maxBuckets = DEFAULT_MAX_BUCKETS,
  now = () => Date.now(),
} = {}) {
  // The ARITHMETIC is shared (`#system/utils/tokenBucket.mjs`); only the policy
  // below — what a key is, and what to emit when a caller is denied — belongs
  // to log ingestion. The bucket returned by `take` is where this file keeps
  // `suppressed` and `lastSummaryAt`, which the core neither reads nor writes.
  const bucket = createTokenBucket({ capacity, refillPerMinute, maxBuckets, now });

  return {
    /**
     * @param {object} event a normalized ingestion event
     * @returns {{allow: boolean, summary: object|null}} `summary` is a synthetic
     *   event the caller should dispatch; it is never itself rate limited.
     */
    check(event) {
      const key = ingestRateKey(event);
      const t = now();
      const { allow, bucket: b } = bucket.take(key);
      // This file's own bookkeeping, hung on the shared bucket. A bucket the
      // core has just created carries neither field.
      if (b.suppressed === undefined) { b.suppressed = 0; b.lastSummaryAt = null; }

      // `null` (never summarized), not 0 — 0 is a real timestamp and is where an
      // injected clock starts, which made every suppression look due.
      const summaryDue = b.lastSummaryAt === null || (t - b.lastSummaryAt) >= summaryIntervalMs;

      if (allow) {
        // Leaving a throttled stretch: report the total, so the gap in the
        // record is explained rather than merely absent.
        //
        // This is gated on the SAME interval as the throttling summary, and it
        // has to be. A steady drip against a slow refill does not throttle once
        // and stop — the bucket flaps, suppressing a few then admitting one as a
        // token lands. Reporting on every recovery turned a 16/min flood into
        // ~12/min of summaries about it, which is not a fix. Holding the count
        // instead of resetting it means nothing is lost; it is simply carried to
        // the next due summary.
        if (b.suppressed > 0 && summaryDue) {
          const summary = throttleSummary(event, b.suppressed, 'recovered');
          b.suppressed = 0;
          b.lastSummaryAt = t;
          return { allow: true, summary };
        }
        return { allow: true, summary: null };
      }

      b.suppressed += 1;
      if (summaryDue) {
        b.lastSummaryAt = t;
        const summary = throttleSummary(event, b.suppressed, 'throttling');
        b.suppressed = 0;
        return { allow: false, summary };
      }
      return { allow: false, summary: null };
    },

    /** Test/diagnostic seam. */
    size() { return bucket.size(); },
    reset() { bucket.reset(); },
  };
}

function throttleSummary(event, suppressed, phase) {
  const ctx = event?.context || {};
  return {
    ts: event?.ts,
    level: 'warn',
    event: 'log.ingest.throttled',
    data: {
      throttledEvent: event?.event,
      throttledLevel: event?.level,
      suppressed,
      phase,
    },
    context: {
      source: 'backend',
      app: ctx.app || 'frontend',
      component: ctx.component || null,
      // Carry the client through so a flood can be traced to its origin.
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
    tags: [],
  };
}

export default createIngestRateLimiter;
