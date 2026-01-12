/**
 * LeakAssertions - Threshold-based assertions for memory leak detection
 *
 * Aggregates results from MemoryProfiler and TimerTracker to determine
 * if a test passes or fails based on configurable thresholds.
 *
 * @example
 * const assertions = new LeakAssertions(profiler, timerTracker, {
 *   maxHeapGrowthMB: 50,
 *   maxTimerGrowth: 5
 * });
 * const results = await assertions.runAllAssertions();
 * if (!results.passed) {
 *   console.log('Failures:', results.failures);
 * }
 */

/**
 * Default thresholds for leak detection
 */
export const DEFAULT_THRESHOLDS = {
  maxHeapGrowthMB: 50,           // Max heap growth in MB
  maxGrowthRateMBPerMin: 2.5,   // Max sustained growth rate
  maxTimerGrowth: 5,            // Max additional timers from baseline
  warnHeapGrowthMB: 30,         // Warning threshold for heap
  warnGrowthRateMBPerMin: 1.5,  // Warning threshold for rate
  warnTimerGrowth: 2            // Warning threshold for timers
};

export class LeakAssertions {
  /**
   * @param {import('./MemoryProfiler.mjs').MemoryProfiler} profiler
   * @param {import('./TimerTracker.mjs').TimerTracker} timerTracker
   * @param {Object} config - Override default thresholds
   */
  constructor(profiler, timerTracker, config = {}) {
    this.profiler = profiler;
    this.timers = timerTracker;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...config };
  }

  /**
   * Run all assertions and return aggregated results
   */
  async runAllAssertions() {
    const results = {
      passed: true,
      failures: [],
      warnings: [],
      metrics: {},
      timestamp: new Date().toISOString()
    };

    // 1. Heap growth check
    const growth = this.profiler.getTotalGrowth();
    results.metrics.heapGrowthMB = parseFloat(growth.toFixed(2));

    if (growth > this.thresholds.maxHeapGrowthMB) {
      results.passed = false;
      results.failures.push(
        `Heap grew ${growth.toFixed(1)}MB exceeds max ${this.thresholds.maxHeapGrowthMB}MB`
      );
    } else if (growth > this.thresholds.warnHeapGrowthMB) {
      results.warnings.push(
        `Heap grew ${growth.toFixed(1)}MB exceeds warning threshold ${this.thresholds.warnHeapGrowthMB}MB`
      );
    }

    // 2. Growth rate check
    const rate = this.profiler.getGrowthRate();
    results.metrics.growthRateMBPerMin = parseFloat(rate.toFixed(3));

    if (rate > this.thresholds.maxGrowthRateMBPerMin) {
      results.passed = false;
      results.failures.push(
        `Growth rate ${rate.toFixed(2)}MB/min exceeds max ${this.thresholds.maxGrowthRateMBPerMin}MB/min`
      );
    } else if (rate > this.thresholds.warnGrowthRateMBPerMin) {
      results.warnings.push(
        `Growth rate ${rate.toFixed(2)}MB/min exceeds warning threshold ${this.thresholds.warnGrowthRateMBPerMin}MB/min`
      );
    }

    // 3. Peak usage
    const peak = this.profiler.getPeakUsage();
    results.metrics.peakUsageMB = parseFloat(peak.toFixed(2));

    // 4. Timer leak check
    const timerGrowth = this.timers.getGrowth();
    results.metrics.timerGrowth = timerGrowth;
    results.metrics.timerBaseline = this.timers.baselineCount;
    results.metrics.timerFinal = this.timers.finalCount;

    if (timerGrowth > this.thresholds.maxTimerGrowth) {
      results.passed = false;
      results.failures.push(
        `Timer count grew by ${timerGrowth} exceeds max ${this.thresholds.maxTimerGrowth}`
      );
      // Include leaked timer stacks for debugging
      results.metrics.leakedTimerStacks = this.timers.getLeakedStacks();
    } else if (timerGrowth > this.thresholds.warnTimerGrowth) {
      results.warnings.push(
        `Timer count grew by ${timerGrowth} exceeds warning threshold ${this.thresholds.warnTimerGrowth}`
      );
    }

    // 5. Stale intervals (running > 60s, likely leaks)
    const staleIntervals = await this.timers.getStaleIntervals(60000);
    results.metrics.staleIntervalCount = staleIntervals.length;
    if (staleIntervals.length > 0) {
      results.metrics.staleIntervals = staleIntervals.slice(0, 10); // Limit for report size
    }

    return results;
  }

  /**
   * Run assertions and throw if failed (for use with test frameworks)
   */
  async assertNoLeaks() {
    const results = await this.runAllAssertions();
    if (!results.passed) {
      const error = new Error(
        `Memory leak detected:\n${results.failures.join('\n')}`
      );
      error.leakResults = results;
      throw error;
    }
    return results;
  }

  /**
   * Generate a full diagnostic report
   * @param {string} testName - Name of the test
   * @param {number} durationSec - Test duration in seconds
   */
  async generateReport(testName, durationSec) {
    const assertions = await this.runAllAssertions();
    const memoryReport = this.profiler.getReport();
    const timerReport = this.timers.getReport();

    return {
      testName,
      timestamp: new Date().toISOString(),
      durationSec,
      passed: assertions.passed,
      failures: assertions.failures,
      warnings: assertions.warnings,
      thresholds: this.thresholds,
      metrics: assertions.metrics,
      memory: {
        ...memoryReport,
        samples: this.profiler.getSamples()
      },
      timers: timerReport
    };
  }
}

/**
 * Write diagnostic report to file
 * @param {Object} report - Report from generateReport()
 * @param {string} outputDir - Directory to write report
 */
export async function writeReport(report, outputDir) {
  const fs = await import('fs/promises');
  const path = await import('path');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `memory-leak-${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(report, null, 2));

  console.log(`[LeakAssertions] Report written to: ${filepath}`);
  return filepath;
}

export default LeakAssertions;
