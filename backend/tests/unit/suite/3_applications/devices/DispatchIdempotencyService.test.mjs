/**
 * DispatchIdempotencyService — dispatch-level idempotency cache tests.
 *
 * Covers:
 *  - same dispatchId + same body within TTL → fn called once, cached replay
 *  - same dispatchId + different body within TTL → IdempotencyConflictError
 *  - different dispatchId → fn called each time
 *  - TTL expiry → fn re-runs after window
 *  - rejected fn: no entry cached, next call re-runs
 *  - stableStringify: key-order invariance
 *  - guard-rails: input validation
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  DispatchIdempotencyService,
  IdempotencyConflictError,
  stableStringify,
} from '#apps/devices/services/DispatchIdempotencyService.mjs';

function makeClock() {
  let now = 1_700_000_000_000;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
    set: (ts) => { now = ts; },
  };
}

describe('DispatchIdempotencyService', () => {
  let clock, logger, service;

  beforeEach(() => {
    clock = makeClock();
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    service = new DispatchIdempotencyService({
      clock,
      ttlMs: 60_000,
      logger,
    });
  });

  describe('same dispatchId + same body within TTL', () => {
    it('calls fn exactly once and replays the cached result', async () => {
      const fn = vi.fn(async () => ({ ok: true, elapsed: 42 }));

      const body = { snapshot: { a: 1 }, deviceId: 'tv-1' };
      const r1 = await service.runWithIdempotency('d-1', body, fn);
      clock.advance(30_000);
      const r2 = await service.runWithIdempotency('d-1', body, fn);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(r1).toEqual({ ok: true, elapsed: 42 });
      expect(r2).toBe(r1); // exact same reference — cached
    });
  });

  describe('same dispatchId + different body within TTL', () => {
    it('throws IdempotencyConflictError', async () => {
      const fn = vi.fn(async () => ({ ok: true }));

      await service.runWithIdempotency('d-1', { a: 1 }, fn);

      await expect(
        service.runWithIdempotency('d-1', { a: 2 }, fn),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);

      // Conflict detected before fn is re-invoked.
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('conflict error carries code IDEMPOTENCY_CONFLICT', async () => {
      await service.runWithIdempotency('d-1', { a: 1 }, async () => 'x');
      try {
        await service.runWithIdempotency('d-1', { a: 2 }, async () => 'y');
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(IdempotencyConflictError);
        expect(err.code).toBe('IDEMPOTENCY_CONFLICT');
      }
    });
  });

  describe('different dispatchId', () => {
    it('calls fn each time', async () => {
      const fn = vi.fn(async (x) => x);
      await service.runWithIdempotency('d-1', { a: 1 }, () => fn('r1'));
      await service.runWithIdempotency('d-2', { a: 1 }, () => fn('r2'));
      await service.runWithIdempotency('d-3', { a: 1 }, () => fn('r3'));

      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('TTL expiry', () => {
    it('re-runs fn when the cached entry has expired', async () => {
      const fn = vi.fn(async () => 'ok');
      const body = { a: 1 };

      await service.runWithIdempotency('d-1', body, fn);
      expect(fn).toHaveBeenCalledTimes(1);

      // Past TTL.
      clock.advance(61_000);
      await service.runWithIdempotency('d-1', body, fn);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('evictExpired() removes stale entries', async () => {
      await service.runWithIdempotency('d-1', { a: 1 }, async () => 'ok');
      expect(service.size).toBe(1);

      clock.advance(61_000);
      service.evictExpired();
      expect(service.size).toBe(0);
    });
  });

  describe('rejected fn', () => {
    it('does not cache the rejection; next identical call re-runs', async () => {
      let attempt = 0;
      const fn = async () => {
        attempt++;
        if (attempt === 1) throw new Error('transient');
        return { ok: true, attempt };
      };

      const body = { a: 1 };
      await expect(
        service.runWithIdempotency('d-1', body, fn),
      ).rejects.toThrow(/transient/);

      // Nothing cached — next call runs fn again and now succeeds.
      const r2 = await service.runWithIdempotency('d-1', body, fn);
      expect(r2).toEqual({ ok: true, attempt: 2 });
      expect(service.size).toBe(1);
    });
  });

  describe('input validation', () => {
    it('rejects empty dispatchId', async () => {
      await expect(
        service.runWithIdempotency('', { a: 1 }, async () => 1),
      ).rejects.toThrow(/dispatchId/);
    });

    it('rejects non-string dispatchId', async () => {
      await expect(
        service.runWithIdempotency(null, { a: 1 }, async () => 1),
      ).rejects.toThrow(/dispatchId/);
    });

    it('rejects non-function fn', async () => {
      await expect(
        service.runWithIdempotency('d-1', { a: 1 }, 'not a fn'),
      ).rejects.toThrow(/fn/);
    });
  });

  describe('stableStringify', () => {
    it('produces identical output for objects with different key order', () => {
      const a = { x: 1, y: { p: 2, q: 3 } };
      const b = { y: { q: 3, p: 2 }, x: 1 };
      expect(stableStringify(a)).toBe(stableStringify(b));
    });

    it('handles arrays, nulls, and primitives', () => {
      const a = { arr: [3, 1, 2], s: 'hi', n: null };
      const b = { n: null, arr: [3, 1, 2], s: 'hi' };
      expect(stableStringify(a)).toBe(stableStringify(b));
    });

    it('distinguishes different values', () => {
      expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    });
  });

  describe('JSDoc semantics: cache contains only resolved results', () => {
    it('after reject + retry success, cached entry corresponds to the success', async () => {
      let attempt = 0;
      const fn = async () => {
        attempt++;
        if (attempt === 1) throw new Error('nope');
        return { result: 'success', attempt };
      };

      await expect(
        service.runWithIdempotency('d-1', { a: 1 }, fn),
      ).rejects.toThrow();

      const r = await service.runWithIdempotency('d-1', { a: 1 }, fn);
      expect(r).toEqual({ result: 'success', attempt: 2 });

      // A replay should return the success too — no re-run.
      const replay = await service.runWithIdempotency('d-1', { a: 1 }, fn);
      expect(replay).toBe(r);
      expect(attempt).toBe(2);
    });
  });
});
