/**
 * JumpropeSessionState - Manages jumprope state for a fitness session
 *
 * Tracks baseline revolutions and derives RPM from rolling window.
 * Frontend-side calculation since backend only sends raw revolution count.
 */

export class JumpropeSessionState {
  constructor(deviceId) {
    this.deviceId = deviceId;
    this.baselineRevolutions = null;
    this.latestRevolutions = 0;
    this.history = [];
    this.maxHistorySize = 100;
    this.rpmWindowMs = 10000; // 10 second window for RPM calc
  }

  /**
   * Process incoming revolution data
   * @param {number} revolutions - Monotonic counter from backend
   * @param {number} timestamp - Packet timestamp (ms)
   * @returns {{sessionJumps: number, rpm: number}}
   */
  ingest(revolutions, timestamp) {
    if (this.baselineRevolutions === null) {
      this.baselineRevolutions = revolutions;
    }

    this.latestRevolutions = revolutions;
    this.history.push({ revolutions, timestamp });

    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }

    return {
      sessionJumps: this.getSessionJumps(),
      rpm: this.deriveRPM()
    };
  }

  /**
   * Get jumps since session started
   */
  getSessionJumps() {
    if (this.baselineRevolutions === null) return 0;
    return this.latestRevolutions - this.baselineRevolutions;
  }

  /**
   * Derive RPM from rolling window
   * @returns {number} Calculated RPM (0 if insufficient data or stale)
   */
  deriveRPM() {
    const now = Date.now();
    const cutoff = now - this.rpmWindowMs;
    const windowSamples = this.history.filter((s) => s.timestamp >= cutoff);

    if (windowSamples.length < 2) return 0;

    windowSamples.sort((a, b) => a.timestamp - b.timestamp);

    const oldest = windowSamples[0];
    const newest = windowSamples[windowSamples.length - 1];

    const revDelta = newest.revolutions - oldest.revolutions;
    const timeDeltaMs = newest.timestamp - oldest.timestamp;

    if (timeDeltaMs <= 0 || revDelta <= 0) return 0;

    return Math.round((revDelta / timeDeltaMs) * 60000);
  }

  /**
   * Reset state (call on session end or device reconnect)
   */
  reset() {
    this.baselineRevolutions = null;
    this.latestRevolutions = 0;
    this.history = [];
  }
}

export default JumpropeSessionState;
