/**
 * MemoryProfiler - Lightweight memory profiling for leak detection
 *
 * Combines Chrome DevTools Protocol heap snapshots with performance.memory API
 * polling for continuous monitoring during tests.
 *
 * @example
 * const cdp = await page.context().newCDPSession(page);
 * const profiler = new MemoryProfiler(page, cdp);
 * await profiler.captureBaseline();
 * profiler.startSampling(10000); // Sample every 10s
 * // ... run test ...
 * profiler.stopSampling();
 * const growth = profiler.getTotalGrowth();
 */

export class MemoryProfiler {
  constructor(page, cdpSession = null) {
    this.page = page;
    this.cdp = cdpSession;
    this.samples = [];
    this.snapshots = [];
    this.baseline = null;
    this._sampler = null;
    this._sampleInterval = null;
  }

  /**
   * Capture baseline memory reading
   */
  async captureBaseline() {
    // Force GC if CDP available
    if (this.cdp) {
      try {
        await this.cdp.send('HeapProfiler.collectGarbage');
      } catch (e) {
        console.warn('[MemoryProfiler] Could not force GC:', e.message);
      }
    }

    const mem = await this._sampleMemory();
    this.baseline = mem;
    this.samples = [mem];
    return mem;
  }

  /**
   * Start continuous memory sampling
   * @param {number} intervalMs - Sampling interval in milliseconds
   */
  startSampling(intervalMs = 10000) {
    this.stopSampling(); // Clear any existing sampler
    this._sampleInterval = intervalMs;

    this._sampler = setInterval(async () => {
      try {
        const mem = await this._sampleMemory();
        this.samples.push(mem);
      } catch (e) {
        console.warn('[MemoryProfiler] Sample failed:', e.message);
      }
    }, intervalMs);
  }

  /**
   * Stop memory sampling
   */
  stopSampling() {
    if (this._sampler) {
      clearInterval(this._sampler);
      this._sampler = null;
    }
  }

  /**
   * Take a CDP heap snapshot (requires CDP session)
   * @param {string} label - Label for this snapshot
   */
  async takeSnapshot(label = 'snapshot') {
    if (!this.cdp) {
      console.warn('[MemoryProfiler] No CDP session - cannot take heap snapshot');
      return null;
    }

    try {
      // Force GC before snapshot for accurate measurement
      await this.cdp.send('HeapProfiler.collectGarbage');

      // Enable heap profiler
      await this.cdp.send('HeapProfiler.enable');

      // Collect snapshot chunks
      const chunks = [];
      this.cdp.on('HeapProfiler.addHeapSnapshotChunk', (params) => {
        chunks.push(params.chunk);
      });

      await this.cdp.send('HeapProfiler.takeHeapSnapshot', {
        reportProgress: false,
        treatGlobalObjectsAsRoots: true
      });

      const snapshotData = chunks.join('');
      const summary = this._parseSnapshotSummary(snapshotData);

      const snapshot = {
        label,
        timestamp: Date.now(),
        summary
      };

      this.snapshots.push(snapshot);
      return snapshot;
    } catch (e) {
      console.error('[MemoryProfiler] Snapshot failed:', e.message);
      return null;
    }
  }

  /**
   * Get total heap growth in MB
   */
  getTotalGrowth() {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first?.heapUsed || !last?.heapUsed) return 0;
    return (last.heapUsed - first.heapUsed) / (1024 * 1024);
  }

  /**
   * Get memory growth rate in MB/minute
   */
  getGrowthRate() {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first?.heapUsed || !last?.heapUsed) return 0;

    const durationMin = (last.timestamp - first.timestamp) / 60000;
    if (durationMin <= 0) return 0;

    const growthMB = (last.heapUsed - first.heapUsed) / (1024 * 1024);
    return growthMB / durationMin;
  }

  /**
   * Get peak memory usage in MB
   */
  getPeakUsage() {
    if (this.samples.length === 0) return 0;
    const peak = Math.max(...this.samples.map(s => s.heapUsed || 0));
    return peak / (1024 * 1024);
  }

  /**
   * Get all samples for analysis
   */
  getSamples() {
    return this.samples.map(s => ({
      ...s,
      heapUsedMB: s.heapUsed ? s.heapUsed / (1024 * 1024) : null,
      heapTotalMB: s.heapTotal ? s.heapTotal / (1024 * 1024) : null
    }));
  }

  /**
   * Generate summary report
   */
  getReport() {
    return {
      sampleCount: this.samples.length,
      durationMs: this.samples.length > 1
        ? this.samples[this.samples.length - 1].timestamp - this.samples[0].timestamp
        : 0,
      baseline: this.baseline ? {
        heapUsedMB: this.baseline.heapUsed / (1024 * 1024),
        heapTotalMB: this.baseline.heapTotal / (1024 * 1024)
      } : null,
      final: this.samples.length > 0 ? {
        heapUsedMB: this.samples[this.samples.length - 1].heapUsed / (1024 * 1024),
        heapTotalMB: this.samples[this.samples.length - 1].heapTotal / (1024 * 1024)
      } : null,
      totalGrowthMB: this.getTotalGrowth(),
      growthRateMBPerMin: this.getGrowthRate(),
      peakUsageMB: this.getPeakUsage(),
      snapshots: this.snapshots.map(s => ({ label: s.label, timestamp: s.timestamp }))
    };
  }

  /**
   * Internal: Sample current memory usage
   */
  async _sampleMemory() {
    const mem = await this.page.evaluate(() => {
      // performance.memory is Chrome-specific and requires --enable-precise-memory-info flag
      const memory = performance.memory;
      return {
        heapUsed: memory?.usedJSHeapSize ?? null,
        heapTotal: memory?.totalJSHeapSize ?? null,
        heapLimit: memory?.jsHeapSizeLimit ?? null,
        timestamp: Date.now()
      };
    });
    return mem;
  }

  /**
   * Internal: Parse heap snapshot for summary info
   */
  _parseSnapshotSummary(snapshotJson) {
    try {
      const snapshot = JSON.parse(snapshotJson);
      return {
        nodeCount: snapshot.snapshot?.node_count ?? 0,
        edgeCount: snapshot.snapshot?.edge_count ?? 0,
        totalSize: snapshot.snapshot?.meta?.total_size ?? 0
      };
    } catch (e) {
      return { parseError: e.message };
    }
  }
}

export default MemoryProfiler;
