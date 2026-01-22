// tests/unit/infrastructure/routing/ShimMetrics.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ShimMetrics } from '@backend/src/0_infrastructure/routing/ShimMetrics.mjs';

describe('ShimMetrics', () => {
  let metrics;

  beforeEach(() => {
    metrics = new ShimMetrics();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-12T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('record', () => {
    it('tracks first use of a shim', () => {
      metrics.record('content-v1');

      const report = metrics.getReport();
      expect(report).toHaveLength(1);
      expect(report[0].shim).toBe('content-v1');
      expect(report[0].totalRequests).toBe(1);
    });

    it('increments count for repeated uses', () => {
      metrics.record('content-v1');
      metrics.record('content-v1');
      metrics.record('content-v1');

      const report = metrics.getReport();
      expect(report).toHaveLength(1);
      expect(report[0].totalRequests).toBe(3);
    });

    it('tracks multiple shims independently', () => {
      metrics.record('content-v1');
      metrics.record('content-v1');
      metrics.record('finance-v1');

      const report = metrics.getReport();
      expect(report).toHaveLength(2);

      const contentShim = report.find(r => r.shim === 'content-v1');
      const financeShim = report.find(r => r.shim === 'finance-v1');

      expect(contentShim.totalRequests).toBe(2);
      expect(financeShim.totalRequests).toBe(1);
    });

    it('updates lastSeen timestamp', () => {
      metrics.record('content-v1');
      const firstTimestamp = metrics.getReport()[0].lastSeen;

      // Advance time by 1 hour
      jest.setSystemTime(new Date('2026-01-12T13:00:00Z'));
      metrics.record('content-v1');

      const secondTimestamp = metrics.getReport()[0].lastSeen;
      expect(new Date(secondTimestamp).getTime()).toBeGreaterThan(new Date(firstTimestamp).getTime());
    });
  });

  describe('getReport', () => {
    it('returns empty array when no shims recorded', () => {
      const report = metrics.getReport();
      expect(report).toEqual([]);
    });

    it('includes daysSinceLastUse calculation', () => {
      metrics.record('content-v1');

      // Advance time by 3 days
      jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));

      const report = metrics.getReport();
      expect(report[0].daysSinceLastUse).toBe(3);
    });
  });

  describe('reset', () => {
    it('clears all metrics', () => {
      metrics.record('content-v1');
      metrics.record('finance-v1');
      expect(metrics.getReport()).toHaveLength(2);

      metrics.reset();

      expect(metrics.getReport()).toEqual([]);
    });
  });
});
