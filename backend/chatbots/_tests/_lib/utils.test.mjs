/**
 * Tests for Utility modules
 * @group Phase1
 */

import { jest } from '@jest/globals';
import * as time from '../../_lib/utils/time.mjs';
import { retry, withRetry } from '../../_lib/utils/retry.mjs';
import { RateLimiter, createPerMinuteLimiter, createPerSecondLimiter } from '../../_lib/utils/ratelimit.mjs';
import { ok, err, isOk, isErr, unwrap, unwrapOr, map, mapErr, andThen, tryCatch, tryCatchAsync, all, any } from '../../_lib/utils/result.mjs';

describe('Phase1: Time utilities', () => {
  describe('formatDate', () => {
    it('should format as ISO by default', () => {
      const date = new Date('2024-06-15T12:00:00Z');
      const result = time.formatDate(date);
      expect(result).toBe(date.toISOString());
    });

    it('should format as date (YYYY-MM-DD)', () => {
      const date = new Date('2024-06-15T12:00:00Z');
      const result = time.formatDate(date, 'date', 'UTC');
      expect(result).toBe('2024-06-15');
    });
  });

  describe('today', () => {
    it('should return date in YYYY-MM-DD format', () => {
      const result = time.today();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('yesterday', () => {
    it('should return yesterday date', () => {
      const todayDate = new Date();
      const expectedYesterday = new Date(todayDate);
      expectedYesterday.setDate(expectedYesterday.getDate() - 1);
      
      const result = time.yesterday('UTC');
      const expected = time.formatDate(expectedYesterday, 'date', 'UTC');
      expect(result).toBe(expected);
    });
  });

  describe('parseDate', () => {
    it('should parse YYYY-MM-DD format', () => {
      const result = time.parseDate('2024-06-15');
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(5); // 0-indexed
      expect(result.getDate()).toBe(15);
    });
  });

  describe('getTimeOfDay', () => {
    it('should return morning for 5-11', () => {
      // Create a date at 9 AM UTC
      const date = new Date('2024-06-15T09:00:00Z');
      expect(time.getTimeOfDay(date, 'UTC')).toBe('morning');
    });

    it('should return midday for 12-16', () => {
      const date = new Date('2024-06-15T14:00:00Z');
      expect(time.getTimeOfDay(date, 'UTC')).toBe('midday');
    });

    it('should return evening for 17-20', () => {
      const date = new Date('2024-06-15T19:00:00Z');
      expect(time.getTimeOfDay(date, 'UTC')).toBe('evening');
    });

    it('should return night for 21-4', () => {
      const date = new Date('2024-06-15T23:00:00Z');
      expect(time.getTimeOfDay(date, 'UTC')).toBe('night');
    });
  });

  describe('addDays', () => {
    it('should add positive days', () => {
      const date = new Date('2024-06-15T12:00:00Z');
      const result = time.addDays(date, 5);
      expect(result.getUTCDate()).toBe(20);
    });

    it('should subtract with negative days', () => {
      const date = new Date('2024-06-15T12:00:00Z');
      const result = time.addDays(date, -5);
      expect(result.getUTCDate()).toBe(10);
    });
  });

  describe('getPastDays', () => {
    it('should return array of past dates', () => {
      const result = time.getPastDays(3);
      expect(result).toHaveLength(3);
      expect(result[0]).toBe(time.today()); // First is today
    });
  });

  describe('daysDiff', () => {
    it('should calculate positive difference', () => {
      const date1 = new Date('2024-06-15');
      const date2 = new Date('2024-06-10');
      expect(time.daysDiff(date1, date2)).toBe(5);
    });

    it('should calculate negative difference', () => {
      const date1 = new Date('2024-06-10');
      const date2 = new Date('2024-06-15');
      expect(time.daysDiff(date1, date2)).toBe(-5);
    });
  });
});

describe('Phase1: Retry utilities', () => {
  describe('retry', () => {
    it('should return value on success', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await retry(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error', async () => {
      const error = new Error('Temporary failure');
      error.retryable = true;
      
      const fn = jest.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');
      
      const result = await retry(fn, { 
        initialDelayMs: 1,
        shouldRetry: (e) => e.retryable === true,
      });
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable error', async () => {
      const error = new Error('Permanent failure');
      error.retryable = false;
      
      const fn = jest.fn().mockRejectedValue(error);
      
      await expect(retry(fn, {
        shouldRetry: (e) => e.retryable === true,
      })).rejects.toThrow('Permanent failure');
      
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should respect maxAttempts', async () => {
      const error = new Error('Always fails');
      error.retryable = true;
      
      const fn = jest.fn().mockRejectedValue(error);
      
      await expect(retry(fn, {
        maxAttempts: 3,
        initialDelayMs: 1,
        shouldRetry: () => true,
      })).rejects.toThrow('Always fails');
      
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should call onRetry callback', async () => {
      const error = new Error('Fails');
      error.retryable = true;
      
      const fn = jest.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');
      
      const onRetry = jest.fn();
      
      await retry(fn, {
        initialDelayMs: 1,
        shouldRetry: () => true,
        onRetry,
      });
      
      expect(onRetry).toHaveBeenCalledWith(1, error, expect.any(Number));
    });
  });

  describe('withRetry', () => {
    it('should wrap function with retry', async () => {
      const fn = jest.fn().mockResolvedValue('value');
      const wrapped = withRetry(fn);
      
      const result = await wrapped();
      expect(result).toBe('value');
    });
  });
});

describe('Phase1: RateLimiter', () => {
  describe('RateLimiter class', () => {
    it('should allow requests within limit', () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10,
        interval: 1000,
      });
      
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.getRemaining()).toBe(9);
    });

    it('should block when tokens exhausted', () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 2,
        interval: 1000,
      });
      
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);
    });

    it('should support custom cost', () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 10,
        interval: 1000,
      });
      
      expect(limiter.tryAcquire(5)).toBe(true);
      expect(limiter.getRemaining()).toBe(5);
      expect(limiter.tryAcquire(6)).toBe(false);
    });

    it('should reset tokens', () => {
      const limiter = new RateLimiter({
        tokensPerInterval: 5,
        interval: 1000,
      });
      
      limiter.tryAcquire(5);
      expect(limiter.getRemaining()).toBe(0);
      
      limiter.reset();
      expect(limiter.getRemaining()).toBe(5);
    });
  });

  describe('Helper functions', () => {
    it('createPerMinuteLimiter should create correct limiter', () => {
      const limiter = createPerMinuteLimiter(60);
      expect(limiter.getRemaining()).toBe(60);
    });

    it('createPerSecondLimiter should create correct limiter', () => {
      const limiter = createPerSecondLimiter(10);
      expect(limiter.getRemaining()).toBe(10);
    });
  });
});

describe('Phase1: Result monad', () => {
  describe('ok and err', () => {
    it('ok should create success result', () => {
      const result = ok('value');
      expect(result.ok).toBe(true);
      expect(result.value).toBe('value');
    });

    it('err should create failure result', () => {
      const result = err(new Error('fail'));
      expect(result.ok).toBe(false);
      expect(result.error.message).toBe('fail');
    });
  });

  describe('isOk and isErr', () => {
    it('isOk should identify success', () => {
      expect(isOk(ok('value'))).toBe(true);
      expect(isOk(err('error'))).toBe(false);
    });

    it('isErr should identify failure', () => {
      expect(isErr(err('error'))).toBe(true);
      expect(isErr(ok('value'))).toBe(false);
    });
  });

  describe('unwrap and unwrapOr', () => {
    it('unwrap should return value on success', () => {
      expect(unwrap(ok('value'))).toBe('value');
    });

    it('unwrap should throw on failure', () => {
      expect(() => unwrap(err(new Error('fail')))).toThrow('fail');
    });

    it('unwrapOr should return value on success', () => {
      expect(unwrapOr(ok('value'), 'default')).toBe('value');
    });

    it('unwrapOr should return default on failure', () => {
      expect(unwrapOr(err('error'), 'default')).toBe('default');
    });
  });

  describe('map and mapErr', () => {
    it('map should transform success value', () => {
      const result = map(ok(5), (x) => x * 2);
      expect(unwrap(result)).toBe(10);
    });

    it('map should pass through failure', () => {
      const error = new Error('fail');
      const result = map(err(error), (x) => x * 2);
      expect(isErr(result)).toBe(true);
      expect(result.error).toBe(error);
    });

    it('mapErr should transform error', () => {
      const result = mapErr(err('original'), (e) => new Error(e));
      expect(result.error.message).toBe('original');
    });
  });

  describe('andThen', () => {
    it('should chain successful results', () => {
      const result = andThen(ok(5), (x) => ok(x * 2));
      expect(unwrap(result)).toBe(10);
    });

    it('should short-circuit on failure', () => {
      const result = andThen(err('error'), (x) => ok(x * 2));
      expect(isErr(result)).toBe(true);
    });
  });

  describe('tryCatch and tryCatchAsync', () => {
    it('tryCatch should catch errors', () => {
      const result = tryCatch(() => {
        throw new Error('fail');
      });
      expect(isErr(result)).toBe(true);
    });

    it('tryCatch should wrap success', () => {
      const result = tryCatch(() => 'value');
      expect(isOk(result)).toBe(true);
      expect(unwrap(result)).toBe('value');
    });

    it('tryCatchAsync should handle async', async () => {
      const result = await tryCatchAsync(async () => 'async-value');
      expect(unwrap(result)).toBe('async-value');
    });

    it('tryCatchAsync should catch async errors', async () => {
      const result = await tryCatchAsync(async () => {
        throw new Error('async-fail');
      });
      expect(isErr(result)).toBe(true);
    });
  });

  describe('all and any', () => {
    it('all should combine successes', () => {
      const results = [ok(1), ok(2), ok(3)];
      const combined = all(results);
      expect(unwrap(combined)).toEqual([1, 2, 3]);
    });

    it('all should fail on first error', () => {
      const results = [ok(1), err('error'), ok(3)];
      const combined = all(results);
      expect(isErr(combined)).toBe(true);
    });

    it('any should return first success', () => {
      const results = [err('e1'), ok('success'), err('e2')];
      const result = any(results);
      expect(unwrap(result)).toBe('success');
    });

    it('any should collect all errors if all fail', () => {
      const results = [err('e1'), err('e2')];
      const result = any(results);
      expect(result.error).toEqual(['e1', 'e2']);
    });
  });
});
