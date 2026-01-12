/**
 * ShimMetrics - Tracks shim usage for migration monitoring
 *
 * Records each time a shim is used and provides reporting
 * to help identify when legacy endpoints can be removed.
 */
export class ShimMetrics {
  constructor() {
    this._metrics = new Map();
  }

  /**
   * Record a shim being used
   * @param {string} shimName - Name of the shim
   */
  record(shimName) {
    const existing = this._metrics.get(shimName);
    const now = new Date().toISOString();

    if (existing) {
      this._metrics.set(shimName, {
        totalRequests: existing.totalRequests + 1,
        lastSeen: now,
      });
    } else {
      this._metrics.set(shimName, {
        totalRequests: 1,
        lastSeen: now,
      });
    }
  }

  /**
   * Get usage report for all tracked shims
   * @returns {Array<{shim: string, totalRequests: number, lastSeen: string, daysSinceLastUse: number}>}
   */
  getReport() {
    const now = new Date();
    const report = [];

    for (const [shim, data] of this._metrics) {
      const lastSeenDate = new Date(data.lastSeen);
      const diffMs = now.getTime() - lastSeenDate.getTime();
      const daysSinceLastUse = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      report.push({
        shim,
        totalRequests: data.totalRequests,
        lastSeen: data.lastSeen,
        daysSinceLastUse,
      });
    }

    return report;
  }

  /**
   * Clear all recorded metrics
   */
  reset() {
    this._metrics.clear();
  }
}
