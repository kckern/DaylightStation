import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createEventLoopLagMonitor,
  DEFAULT_THRESHOLD_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_RESOLUTION_MS,
  EVENT_LAG,
  EVENT_MONITOR_STARTED,
} from '#system/runtime/eventLoopLag.mjs';

/**
 * A stand-in for a perf_hooks IntervalHistogram. Values are nanoseconds, as the
 * real one reports them.
 */
function fakeHistogram({ max = 0, percentiles = {} } = {}) {
  return {
    max,
    percentile: vi.fn((p) => percentiles[p] ?? 0),
    reset: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
  };
}

describe('createEventLoopLagMonitor', () => {
  // ---- the two behaviours the task specified, verbatim ----------------------

  it('logs at warn when the max lag over a sample window exceeds the threshold', () => {
    const warn = vi.fn(); const info = vi.fn();
    const histogram = { max: 1_500e6, percentile: () => 40e6, reset: vi.fn() }; // nanoseconds
    const m = createEventLoopLagMonitor({ logger: { warn, info }, histogram, thresholdMs: 1000 });
    m.sample();
    expect(warn).toHaveBeenCalledWith('system.event-loop.lag', expect.objectContaining({ maxMs: 1500, p99Ms: 40 }));
    expect(histogram.reset).toHaveBeenCalled();
  });

  it('stays quiet below the threshold', () => {
    const warn = vi.fn();
    const m = createEventLoopLagMonitor({ logger: { warn, info() {} }, histogram: { max: 30e6, percentile: () => 20e6, reset() {} }, thresholdMs: 1000 });
    m.sample();
    expect(warn).not.toHaveBeenCalled();
  });

  // ---- the threshold boundary ----------------------------------------------

  it('warns at exactly the threshold and stays at info one millisecond below it', () => {
    const belowLogger = { warn: vi.fn(), info: vi.fn() };
    createEventLoopLagMonitor({
      logger: belowLogger,
      histogram: fakeHistogram({ max: 999e6 }),
      thresholdMs: 1000,
    }).sample();
    expect(belowLogger.warn).not.toHaveBeenCalled();
    expect(belowLogger.info).toHaveBeenCalledWith(EVENT_LAG, expect.objectContaining({ maxMs: 999 }));

    const atLogger = { warn: vi.fn(), info: vi.fn() };
    createEventLoopLagMonitor({
      logger: atLogger,
      histogram: fakeHistogram({ max: 1000e6 }),
      thresholdMs: 1000,
    }).sample();
    expect(atLogger.warn).toHaveBeenCalledWith(EVENT_LAG, expect.objectContaining({ maxMs: 1000 }));
    expect(atLogger.info).not.toHaveBeenCalledWith(EVENT_LAG, expect.anything());
  });

  // ---- the payload ----------------------------------------------------------

  it('reports max, p99, p50, the threshold, and the wall-clock span the window actually covered', () => {
    const warn = vi.fn();
    let clock = 10_000;
    const histogram = fakeHistogram({ max: 45_650e6, percentiles: { 50: 2e6, 99: 900e6 } });
    const m = createEventLoopLagMonitor({
      logger: { warn, info() {} },
      histogram,
      thresholdMs: 1000,
      intervalMs: 60_000,
      now: () => clock,
    });

    // The monitor's own timer is late by the length of the stall: a 60s window
    // that took 105s of wall clock to close is independent corroboration that
    // the process could not run, and does not depend on the histogram at all.
    clock = 115_000;
    m.sample();

    expect(warn).toHaveBeenCalledWith(EVENT_LAG, {
      maxMs: 45_650,
      p99Ms: 900,
      p50Ms: 2,
      windowMs: 105_000,
      thresholdMs: 1000,
    });
    expect(histogram.percentile).toHaveBeenCalledWith(99);
    expect(histogram.percentile).toHaveBeenCalledWith(50);
  });

  it('measures each window from the previous sample, not from construction', () => {
    const warn = vi.fn();
    let clock = 0;
    const m = createEventLoopLagMonitor({
      logger: { warn, info() {} },
      histogram: fakeHistogram({ max: 2000e6 }),
      thresholdMs: 1000,
      now: () => clock,
    });

    clock = 60_000;
    m.sample();
    clock = 90_000;
    m.sample();

    expect(warn.mock.calls[0][1].windowMs).toBe(60_000);
    expect(warn.mock.calls[1][1].windowMs).toBe(30_000);
  });

  it('resets the histogram on every sample, quiet windows included', () => {
    const histogram = fakeHistogram({ max: 5e6 });
    const m = createEventLoopLagMonitor({ logger: { warn() {}, info() {} }, histogram, thresholdMs: 1000 });
    m.sample();
    m.sample();
    expect(histogram.reset).toHaveBeenCalledTimes(2);
  });

  // ---- the defaults are wired, not merely declared --------------------------

  it('applies DEFAULT_THRESHOLD_MS when no threshold is injected', () => {
    const below = { warn: vi.fn(), info: vi.fn() };
    createEventLoopLagMonitor({
      logger: below,
      histogram: fakeHistogram({ max: (DEFAULT_THRESHOLD_MS - 1) * 1e6 }),
    }).sample();
    expect(below.warn).not.toHaveBeenCalled();

    const at = { warn: vi.fn(), info: vi.fn() };
    createEventLoopLagMonitor({
      logger: at,
      histogram: fakeHistogram({ max: DEFAULT_THRESHOLD_MS * 1e6 }),
    }).sample();
    expect(at.warn).toHaveBeenCalledWith(EVENT_LAG, expect.objectContaining({ thresholdMs: DEFAULT_THRESHOLD_MS }));
  });

  it('exposes defaults that are coherent: the window is far longer than the resolution and longer than the threshold', () => {
    expect(DEFAULT_RESOLUTION_MS).toBeGreaterThan(0);
    // A window must hold enough samples for p99 to mean anything.
    expect(DEFAULT_INTERVAL_MS / DEFAULT_RESOLUTION_MS).toBeGreaterThanOrEqual(1000);
    // A stall at the threshold must be able to fit inside one window.
    expect(DEFAULT_INTERVAL_MS).toBeGreaterThan(DEFAULT_THRESHOLD_MS);
  });

  // ---- lifecycle ------------------------------------------------------------

  describe('start/stop', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('samples on the injected interval and announces itself once', () => {
      const info = vi.fn(); const warn = vi.fn();
      const histogram = fakeHistogram({ max: 4e6 });
      const m = createEventLoopLagMonitor({
        logger: { warn, info }, histogram, thresholdMs: 1000, intervalMs: 60_000,
      });

      m.start();
      expect(histogram.enable).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith(EVENT_MONITOR_STARTED, expect.objectContaining({
        thresholdMs: 1000, intervalMs: 60_000,
      }));

      expect(histogram.reset).not.toHaveBeenCalled();
      vi.advanceTimersByTime(59_999);
      expect(histogram.reset).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(histogram.reset).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60_000);
      expect(histogram.reset).toHaveBeenCalledTimes(2);

      m.stop();
    });

    it('uses DEFAULT_INTERVAL_MS when no interval is injected', () => {
      const histogram = fakeHistogram({ max: 1e6 });
      const m = createEventLoopLagMonitor({ logger: { warn() {}, info() {} }, histogram });
      m.start();
      vi.advanceTimersByTime(DEFAULT_INTERVAL_MS - 1);
      expect(histogram.reset).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(histogram.reset).toHaveBeenCalledTimes(1);
      m.stop();
    });

    it('is idempotent: a second start neither re-enables nor adds a second timer', () => {
      const info = vi.fn();
      const histogram = fakeHistogram({ max: 1e6 });
      const m = createEventLoopLagMonitor({ logger: { warn() {}, info }, histogram, intervalMs: 60_000 });

      m.start();
      m.start();
      expect(histogram.enable).toHaveBeenCalledTimes(1);
      expect(info.mock.calls.filter(([e]) => e === EVENT_MONITOR_STARTED)).toHaveLength(1);

      vi.advanceTimersByTime(60_000);
      expect(histogram.reset).toHaveBeenCalledTimes(1); // not 2

      m.stop();
    });

    it('stops sampling and disables the histogram, and can be restarted', () => {
      const histogram = fakeHistogram({ max: 1e6 });
      const m = createEventLoopLagMonitor({ logger: { warn() {}, info() {} }, histogram, intervalMs: 60_000 });

      m.start();
      vi.advanceTimersByTime(60_000);
      expect(histogram.reset).toHaveBeenCalledTimes(1);

      m.stop();
      expect(histogram.disable).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(600_000);
      expect(histogram.reset).toHaveBeenCalledTimes(1); // no further samples

      m.start();
      vi.advanceTimersByTime(60_000);
      expect(histogram.reset).toHaveBeenCalledTimes(2);
      m.stop();
    });

    it('stop() before start() is a no-op rather than a throw', () => {
      const m = createEventLoopLagMonitor({ logger: { warn() {}, info() {} }, histogram: fakeHistogram() });
      expect(() => m.stop()).not.toThrow();
    });

    it('does not hold the process open', () => {
      const histogram = fakeHistogram({ max: 1e6 });
      const unref = vi.fn();
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref });
      try {
        createEventLoopLagMonitor({ logger: { warn() {}, info() {} }, histogram }).start();
        expect(unref).toHaveBeenCalled();
      } finally {
        setIntervalSpy.mockRestore();
      }
    });

    it('start survives being detached from the monitor object', () => {
      const histogram = fakeHistogram({ max: 1e6 });
      const { start, stop } = createEventLoopLagMonitor({
        logger: { warn() {}, info() {} }, histogram, intervalMs: 60_000,
      });
      expect(() => start()).not.toThrow();
      vi.advanceTimersByTime(60_000);
      expect(histogram.reset).toHaveBeenCalledTimes(1);
      stop();
    });
  });

  // ---- degenerate inputs ----------------------------------------------------

  it('tolerates a logger that implements neither level', () => {
    const histogram = fakeHistogram({ max: 9_000e6 });
    const m = createEventLoopLagMonitor({ logger: {}, histogram, thresholdMs: 1000 });
    expect(() => m.sample()).not.toThrow();
    expect(histogram.reset).toHaveBeenCalledTimes(1);
  });

  it('tolerates a histogram with no enable/disable hooks', () => {
    const m = createEventLoopLagMonitor({
      logger: { warn() {}, info() {} },
      histogram: { max: 0, percentile: () => 0, reset() {} },
      intervalMs: 60_000,
    });
    expect(() => { m.start(); m.stop(); }).not.toThrow();
  });
});
