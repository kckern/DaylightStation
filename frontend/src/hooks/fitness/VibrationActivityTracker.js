import getLogger from '../../lib/logging/Logger.js';

const DEFAULTS = {
  idle_timeout_seconds: 5,
  session_reset_seconds: 30,
  impact_magnitude_threshold: 400,
  impact_multiplier: 1.5,
  intensity_levels: [400, 800, 1200],
  history_window_seconds: 30
};

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child
    ? getLogger().child({ component: 'VibrationActivityTracker' })
    : getLogger();
  return _logger;
}

/**
 * Classifies a magnitude into an intensity level based on configured thresholds.
 * @param {number} mag - The computed magnitude
 * @param {number[]} levels - Array of three ascending thresholds [low, medium, high]
 * @returns {'none'|'low'|'medium'|'high'}
 */
function classifyIntensity(mag, levels) {
  if (mag <= 0) return 'none';
  if (mag >= levels[2]) return 'high';
  if (mag >= levels[1]) return 'medium';
  if (mag >= levels[0]) return 'low';
  return 'none';
}

/**
 * VibrationActivityTracker — per-equipment stateful object that ingests raw
 * vibration sensor events and accumulates session/impact/intensity state.
 *
 * State machine:
 *   idle → active  when vibration event arrives with magnitude above threshold
 *   active → idle  when no events for idle_timeout_seconds (checked via tick())
 *   Counters held during idle, reset after session_reset_seconds of idle
 */
export class VibrationActivityTracker {
  /**
   * @param {string} equipmentId - Identifier for the equipment being tracked
   * @param {object} config - Optional config overrides merged with DEFAULTS
   */
  constructor(equipmentId, config = {}) {
    this._equipmentId = equipmentId;
    this._config = { ...DEFAULTS, ...config };

    // State
    this._status = 'idle';           // 'idle' | 'active'
    this._sessionStartedAt = null;   // timestamp of first impact in current session
    this._lastEventTimestamp = null;  // timestamp of most recent above-threshold event
    this._idleSince = null;          // timestamp when status transitioned to idle

    // Counters
    this._detectedImpacts = 0;
    this._currentIntensity = 0;      // magnitude of most recent above-threshold event
    this._peakIntensity = 0;

    // Rolling history of { magnitude, timestamp } for above-threshold events
    this._recentHistory = [];

    // Session duration tracking: accumulated ms of active time
    // (accounts for multiple active/idle cycles within one session)
    this._accumulatedActiveMs = 0;
    this._lastActiveStart = null;

    // Callback
    this._onStateChange = null;

    logger().debug('constructor', { equipmentId, config: this._config });
  }

  /**
   * Ingest a raw vibration sensor event.
   * @param {object} payload - { vibration: bool, x_axis: number, y_axis: number, z_axis: number, timestamp: number }
   */
  ingest(payload) {
    const { vibration, x_axis, y_axis, z_axis, timestamp } = payload;

    const mag = Math.round(
      Math.sqrt(x_axis * x_axis + y_axis * y_axis + z_axis * z_axis)
    );

    // Only count as impact if vibration flag is true AND magnitude meets threshold
    if (!vibration || mag < this._config.impact_magnitude_threshold) {
      logger().debug('ingest.below-threshold', {
        equipmentId: this._equipmentId,
        vibration,
        magnitude: mag,
        threshold: this._config.impact_magnitude_threshold
      });
      return;
    }

    // Above-threshold impact
    this._detectedImpacts += 1;
    this._currentIntensity = mag;
    this._lastEventTimestamp = timestamp;

    if (mag > this._peakIntensity) {
      this._peakIntensity = mag;
    }

    // Add to rolling history
    this._recentHistory.push({ magnitude: mag, timestamp });
    this._trimHistory(timestamp);

    // Transition to active if idle
    if (this._status === 'idle') {
      const prevStatus = this._status;
      this._status = 'active';
      this._idleSince = null;
      this._lastActiveStart = timestamp;

      if (this._sessionStartedAt === null) {
        this._sessionStartedAt = timestamp;
      }

      logger().info('state-change', {
        equipmentId: this._equipmentId,
        from: prevStatus,
        to: 'active',
        magnitude: mag
      });

      this._fireStateChange('active', prevStatus);
    }

    logger().debug('ingest.impact', {
      equipmentId: this._equipmentId,
      magnitude: mag,
      detectedImpacts: this._detectedImpacts,
      intensityLevel: classifyIntensity(mag, this._config.intensity_levels)
    });
  }

  /**
   * Periodic tick — checks idle timeout and session reset.
   * @param {number} now - Current timestamp in ms
   */
  tick(now) {
    if (this._status === 'active') {
      const elapsed = now - this._lastEventTimestamp;
      if (elapsed >= this._config.idle_timeout_seconds * 1000) {
        // Accumulate the active time from this active period
        if (this._lastActiveStart !== null) {
          this._accumulatedActiveMs += this._lastEventTimestamp - this._lastActiveStart;
          this._lastActiveStart = null;
        }

        const prevStatus = this._status;
        this._status = 'idle';
        this._idleSince = now;

        logger().info('state-change', {
          equipmentId: this._equipmentId,
          from: prevStatus,
          to: 'idle',
          idleMs: elapsed
        });

        this._fireStateChange('idle', prevStatus);
      }
    }

    // Check session reset: if idle for session_reset_seconds, zero everything
    if (this._status === 'idle' && this._idleSince !== null) {
      const idleDuration = now - this._idleSince;
      if (idleDuration >= this._config.session_reset_seconds * 1000) {
        logger().info('session-reset', {
          equipmentId: this._equipmentId,
          idleDurationMs: idleDuration
        });
        this._resetCounters();
      }
    }
  }

  /**
   * Full state clear — resets everything to initial values.
   */
  reset() {
    this._status = 'idle';
    this._idleSince = null;
    this._resetCounters();

    logger().info('reset', { equipmentId: this._equipmentId });
  }

  /**
   * Set a callback to be invoked on status transitions.
   * @param {function} callback - Called with (newStatus, previousStatus)
   */
  setOnStateChange(callback) {
    this._onStateChange = typeof callback === 'function' ? callback : null;
  }

  /**
   * Returns an immutable snapshot of the current state.
   */
  get snapshot() {
    const now = Date.now();
    let sessionDurationMs = this._accumulatedActiveMs;

    if (this._status === 'active' && this._lastActiveStart !== null) {
      sessionDurationMs += now - this._lastActiveStart;
    }

    const intensityLevel = this._status === 'idle'
      ? 'none'
      : classifyIntensity(this._currentIntensity, this._config.intensity_levels);

    return Object.freeze({
      equipmentId: this._equipmentId,
      status: this._status,
      sessionDurationMs,
      sessionStartedAt: this._sessionStartedAt,
      detectedImpacts: this._detectedImpacts,
      estimatedImpacts: Math.round(this._detectedImpacts * this._config.impact_multiplier),
      currentIntensity: this._currentIntensity,
      intensityLevel,
      peakIntensity: this._peakIntensity,
      recentIntensityHistory: [...this._recentHistory]
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Reset counters and session state (but not status or idleSince).
   */
  _resetCounters() {
    this._sessionStartedAt = null;
    this._lastEventTimestamp = null;
    this._detectedImpacts = 0;
    this._currentIntensity = 0;
    this._peakIntensity = 0;
    this._recentHistory = [];
    this._accumulatedActiveMs = 0;
    this._lastActiveStart = null;
  }

  /**
   * Trim history entries outside the rolling window.
   * @param {number} now - Current timestamp for window calculation
   */
  _trimHistory(now) {
    const windowMs = this._config.history_window_seconds * 1000;
    const cutoff = now - windowMs;
    this._recentHistory = this._recentHistory.filter(
      (entry) => entry.timestamp >= cutoff
    );
  }

  /**
   * Fire the state change callback if registered.
   */
  _fireStateChange(newStatus, prevStatus) {
    if (this._onStateChange) {
      try {
        this._onStateChange(newStatus, prevStatus);
      } catch (err) {
        logger().error('state-change-callback-error', {
          equipmentId: this._equipmentId,
          error: err.message
        });
      }
    }
  }
}
