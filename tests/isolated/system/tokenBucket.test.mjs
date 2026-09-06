/**
 * The keyed token bucket, extracted from the log-ingestion limiter on
 * 2026-09-06 so the school panel's wrong-code throttle could share the
 * arithmetic instead of growing a second copy of it.
 *
 * Tested directly because it now has TWO consumers with different policies, and
 * a defect here would show up in each of them as a different-looking bug: log
 * lines going missing, or a child being told to slow down when they had not
 * hurried.
 */
import { describe, it, expect } from 'vitest';
import { createTokenBucket } from '#system/utils/tokenBucket.mjs';

describe('createTokenBucket', () => {
  it('allows a full burst, then denies', () => {
    const bucket = createTokenBucket({ capacity: 3, refillPerMinute: 0, now: () => 0 });
    for (let i = 0; i < 3; i += 1) expect(bucket.take('k').allow).toBe(true);
    expect(bucket.take('k').allow).toBe(false);
    expect(bucket.take('k').allow).toBe(false);
  });

  it('refills over time, at the stated rate', () => {
    let t = 0;
    const bucket = createTokenBucket({ capacity: 1, refillPerMinute: 60, now: () => t });
    expect(bucket.take('k').allow).toBe(true);
    expect(bucket.take('k').allow).toBe(false);
    t = 1_000; // 60/min == one per second
    expect(bucket.take('k').allow).toBe(true);
  });

  it('never refills past capacity, so a long quiet spell is not a bigger burst', () => {
    let t = 0;
    const bucket = createTokenBucket({ capacity: 2, refillPerMinute: 60, now: () => t });
    t = 3_600_000;
    expect(bucket.take('k').allow).toBe(true);
    expect(bucket.take('k').allow).toBe(true);
    expect(bucket.take('k').allow).toBe(false);
  });

  it('keeps keys apart', () => {
    const bucket = createTokenBucket({ capacity: 1, refillPerMinute: 0, now: () => 0 });
    expect(bucket.take('a').allow).toBe(true);
    expect(bucket.take('a').allow).toBe(false);
    expect(bucket.take('b').allow).toBe(true);
  });

  it('hands back a bucket a caller can hang its own bookkeeping on', () => {
    // How the logging limiter keeps `suppressed`/`lastSummaryAt` without the
    // core knowing anything about summaries.
    const bucket = createTokenBucket({ capacity: 2, refillPerMinute: 0, now: () => 0 });
    const first = bucket.take('k').bucket;
    first.mine = 7;
    expect(bucket.take('k').bucket.mine).toBe(7);
  });

  it('evicts the idlest key rather than growing without bound', () => {
    let t = 0;
    const bucket = createTokenBucket({ capacity: 1, refillPerMinute: 0, maxBuckets: 2, now: () => t });
    bucket.take('old'); t = 10;
    bucket.take('mid'); t = 20;
    bucket.take('new');
    expect(bucket.size()).toBe(2);
    // Losing a bucket costs a fresh burst allowance, never correctness — so the
    // evicted key is allowed again rather than wrongly denied.
    expect(bucket.peek('old')).toBeNull();
    expect(bucket.take('old').allow).toBe(true);
  });

  it('reset() and size() are honest', () => {
    const bucket = createTokenBucket({ capacity: 1, now: () => 0 });
    bucket.take('a'); bucket.take('b');
    expect(bucket.size()).toBe(2);
    bucket.reset();
    expect(bucket.size()).toBe(0);
    expect(bucket.peek('a')).toBeNull();
  });
});
