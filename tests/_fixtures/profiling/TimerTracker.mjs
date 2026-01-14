/**
 * TimerTracker - Instrument setInterval/setTimeout to detect leaks
 *
 * Injects tracking code into the page to monitor timer creation/cleanup.
 * Captures stack traces for leak identification.
 *
 * @example
 * await page.addInitScript(TIMER_TRACKER_SCRIPT);
 * await page.goto('/fitness');
 * const tracker = new TimerTracker(page);
 * await tracker.captureBaseline();
 * // ... run test ...
 * await tracker.captureFinal();
 * console.log(`Timer growth: ${tracker.getGrowth()}`);
 */

/**
 * Script to inject via page.addInitScript() BEFORE navigation
 * Must be added before any page code runs.
 */
export const TIMER_TRACKER_SCRIPT = `
(function() {
  if (window.__timerTracker) return; // Already installed

  window.__timerTracker = {
    intervals: new Map(),
    timeouts: new Map(),
    _nextId: 1,
    _installed: false,

    install() {
      if (this._installed) return;
      this._installed = true;

      const self = this;
      const origSetInterval = window.setInterval.bind(window);
      const origClearInterval = window.clearInterval.bind(window);
      const origSetTimeout = window.setTimeout.bind(window);
      const origClearTimeout = window.clearTimeout.bind(window);

      window.setInterval = function(fn, ms, ...args) {
        const id = origSetInterval(fn, ms, ...args);
        const stack = new Error().stack || '';
        self.intervals.set(id, {
          created: Date.now(),
          ms: ms,
          stack: stack.split('\\n').slice(2, 7).join('\\n')
        });
        return id;
      };

      window.clearInterval = function(id) {
        self.intervals.delete(id);
        return origClearInterval(id);
      };

      window.setTimeout = function(fn, ms, ...args) {
        const id = origSetTimeout(fn, ms, ...args);
        const stack = new Error().stack || '';
        self.timeouts.set(id, {
          created: Date.now(),
          ms: ms,
          stack: stack.split('\\n').slice(2, 7).join('\\n')
        });
        // Auto-remove on completion (approximate)
        origSetTimeout(() => self.timeouts.delete(id), ms + 100);
        return id;
      };

      window.clearTimeout = function(id) {
        self.timeouts.delete(id);
        return origClearTimeout(id);
      };

      console.log('[TimerTracker] Installed - monitoring setInterval/setTimeout');
    },

    getStats() {
      const now = Date.now();
      return {
        activeIntervals: this.intervals.size,
        activeTimeouts: this.timeouts.size,
        intervalDetails: Array.from(this.intervals.entries()).map(([id, info]) => ({
          id,
          ms: info.ms,
          ageMs: now - info.created,
          stack: info.stack
        })),
        timeoutDetails: Array.from(this.timeouts.entries()).map(([id, info]) => ({
          id,
          ms: info.ms,
          ageMs: now - info.created,
          stack: info.stack
        }))
      };
    },

    // Get intervals older than threshold (likely leaks)
    getStaleIntervals(thresholdMs = 60000) {
      const now = Date.now();
      return Array.from(this.intervals.entries())
        .filter(([id, info]) => now - info.created > thresholdMs)
        .map(([id, info]) => ({
          id,
          ms: info.ms,
          ageMs: now - info.created,
          stack: info.stack
        }));
    },

    reset() {
      this.intervals.clear();
      this.timeouts.clear();
    }
  };

  // Auto-install
  window.__timerTracker.install();
})();
`;

/**
 * TimerTracker class for test assertions
 */
export class TimerTracker {
  constructor(page) {
    this.page = page;
    this.baselineCount = 0;
    this.baselineDetails = [];
    this.finalCount = 0;
    this.finalDetails = [];
  }

  /**
   * Capture baseline timer count
   * Call this after page has loaded and stabilized
   */
  async captureBaseline() {
    const stats = await this.page.evaluate(() => {
      return window.__timerTracker?.getStats() ?? { activeIntervals: 0, intervalDetails: [] };
    });
    this.baselineCount = stats.activeIntervals;
    this.baselineDetails = stats.intervalDetails;
    return {
      count: this.baselineCount,
      details: this.baselineDetails
    };
  }

  /**
   * Capture final timer count
   * Call this at end of test
   */
  async captureFinal() {
    const stats = await this.page.evaluate(() => {
      return window.__timerTracker?.getStats() ?? { activeIntervals: 0, intervalDetails: [] };
    });
    this.finalCount = stats.activeIntervals;
    this.finalDetails = stats.intervalDetails;
    return {
      count: this.finalCount,
      details: this.finalDetails
    };
  }

  /**
   * Get current timer stats (live)
   */
  async getCurrentStats() {
    return await this.page.evaluate(() => {
      return window.__timerTracker?.getStats() ?? { activeIntervals: 0, activeTimeouts: 0 };
    });
  }

  /**
   * Get stale intervals (likely leaks)
   * @param {number} thresholdMs - Consider intervals older than this as stale
   */
  async getStaleIntervals(thresholdMs = 60000) {
    return await this.page.evaluate((threshold) => {
      return window.__timerTracker?.getStaleIntervals(threshold) ?? [];
    }, thresholdMs);
  }

  /**
   * Get timer count growth from baseline to final
   */
  getGrowth() {
    return this.finalCount - this.baselineCount;
  }

  /**
   * Get details of leaked timers (timers in final but not baseline)
   */
  getLeakedTimers() {
    const baselineIds = new Set(this.baselineDetails.map(d => d.id));
    return this.finalDetails.filter(d => !baselineIds.has(d.id));
  }

  /**
   * Get stack traces of leaked timers
   */
  getLeakedStacks() {
    return this.getLeakedTimers().map(t => ({
      id: t.id,
      ms: t.ms,
      ageMs: t.ageMs,
      stack: t.stack
    }));
  }

  /**
   * Generate summary report
   */
  getReport() {
    const leaked = this.getLeakedTimers();
    return {
      baselineCount: this.baselineCount,
      finalCount: this.finalCount,
      growth: this.getGrowth(),
      leakedCount: leaked.length,
      leakedTimers: leaked.map(t => ({
        id: t.id,
        intervalMs: t.ms,
        ageMs: t.ageMs,
        stack: t.stack
      }))
    };
  }
}

export default TimerTracker;
