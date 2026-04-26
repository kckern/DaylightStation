/**
 * ResilientContentAdapter - Content control with ADB fallback recovery
 *
 * Wraps a primary IContentControl adapter (e.g., FullyKiosk) and uses
 * an AdbAdapter to recover when the primary is unreachable. When the
 * primary fails with a connection error, this adapter:
 * 1. Connects via ADB
 * 2. Launches the target app activity
 * 3. Waits for boot
 * 4. Retries the primary adapter
 *
 * @module adapters/devices
 */

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_WAIT_MS = 20000;
const CONNREFUSED = 'ECONNREFUSED';

export class ResilientContentAdapter {
  #primary;
  #adb;
  #launchActivity;
  #logger;
  #metrics;
  // Cache of the most recent options passed to prepareForContent(). The load()
  // recovery path replays prepareForContent after ADB recovery; without this
  // cache, that retry would silently drop options like skipCameraCheck and
  // re-run prepare with default behavior.
  #lastPrepareOptions = {};

  /**
   * @param {Object} config
   * @param {Object} config.primary - Primary IContentControl adapter (e.g., FullyKioskContentAdapter)
   * @param {Object} config.recovery - AdbAdapter instance
   * @param {string} config.launchActivity - Android activity to launch for recovery
   * @param {Object} [deps]
   * @param {Object} [deps.logger]
   */
  constructor(config, deps = {}) {
    this.#primary = config.primary;
    this.#adb = config.recovery;
    this.#launchActivity = config.launchActivity;
    this.#logger = deps.logger || console;

    this.#metrics = {
      startedAt: Date.now(),
      recoveryAttempts: 0,
      recoverySuccesses: 0
    };
  }

  // ===========================================================================
  // IContentControl Implementation
  // ===========================================================================

  /**
   * Prepare device for content loading, with ADB recovery on failure
   * @param {Object} [options] - Forwarded to the primary adapter (e.g. skipCameraCheck).
   * @returns {Promise<Object>}
   */
  async prepareForContent(options = {}) {
    // Cache so the load() retry path can replay these same options post-recovery.
    this.#lastPrepareOptions = options;
    const result = await this.#primary.prepareForContent(options);

    if (result.ok) return result;

    if (!this.#isConnectionError(result.error)) {
      return result;
    }

    // Primary unreachable — attempt ADB recovery
    this.#logger.warn?.('resilient.prepareForContent.primaryFailed', {
      error: result.error,
      attemptingRecovery: true
    });

    const recovered = await this.#attemptRecovery();
    if (!recovered.ok) {
      return {
        ok: false,
        error: recovered.error || result.error,
        recovery: { attempted: true, error: recovered.error }
      };
    }

    // Retry primary after recovery
    this.#logger.info?.('resilient.prepareForContent.retrying');
    const retryResult = await this.#primary.prepareForContent(options);

    if (retryResult.ok) {
      this.#logger.info?.('resilient.prepareForContent.recoverySuccess');
    } else {
      this.#logger.error?.('resilient.prepareForContent.recoveryFailed', {
        retryError: retryResult.error
      });
    }

    return {
      ...retryResult,
      recovery: { attempted: true, success: retryResult.ok }
    };
  }

  /**
   * Load content on device, with ADB recovery on failure
   * @param {string} path
   * @param {Object} [query]
   * @returns {Promise<Object>}
   */
  async load(path, query = {}) {
    const result = await this.#primary.load(path, query);

    if (result.ok) return result;

    if (!this.#isConnectionError(result.error)) {
      return result;
    }

    this.#logger.warn?.('resilient.load.primaryFailed', {
      path,
      error: result.error,
      attemptingRecovery: true
    });

    const recovered = await this.#attemptRecovery();
    if (!recovered.ok) {
      return {
        ...result,
        recovery: { attempted: true, error: recovered.error }
      };
    }

    // Retry: prepare + load. Replay the last prepareForContent options so
    // flags like skipCameraCheck stay consistent across the original call
    // and the post-recovery retry.
    this.#logger.info?.('resilient.load.retrying', { path });
    const prepResult = await this.#primary.prepareForContent(this.#lastPrepareOptions);
    if (!prepResult.ok) {
      this.#logger.error?.('resilient.load.retryPrepareFailed', { error: prepResult.error });
      return {
        ok: false,
        error: prepResult.error,
        recovery: { attempted: true, success: false, step: 'prepare' }
      };
    }

    const retryResult = await this.#primary.load(path, query);

    if (retryResult.ok) {
      this.#logger.info?.('resilient.load.recoverySuccess', { path });
    } else {
      this.#logger.error?.('resilient.load.recoveryFailed', { path, error: retryResult.error });
    }

    return {
      ...retryResult,
      recovery: { attempted: true, success: retryResult.ok }
    };
  }

  /**
   * Get content control status (delegates to primary)
   * @returns {Promise<Object>}
   */
  async getStatus() {
    const status = await this.#primary.getStatus();
    return {
      ...status,
      resilient: true,
      recoveryAvailable: true,
      recoveryMetrics: {
        attempts: this.#metrics.recoveryAttempts,
        successes: this.#metrics.recoverySuccesses
      }
    };
  }

  /**
   * Get adapter metrics (primary + recovery stats)
   * @returns {Object}
   */
  getMetrics() {
    return {
      ...this.#primary.getMetrics(),
      resilient: true,
      recovery: {
        ...this.#adb.getMetrics(),
        attempts: this.#metrics.recoveryAttempts,
        successes: this.#metrics.recoverySuccesses
      }
    };
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  /**
   * Attempt to recover the primary adapter via ADB
   * @private
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async #attemptRecovery() {
    this.#metrics.recoveryAttempts++;
    const startTime = Date.now();

    this.#logger.info?.('resilient.recovery.start', {
      activity: this.#launchActivity,
      attempt: this.#metrics.recoveryAttempts
    });

    // Step 1: Connect ADB
    const connectResult = await this.#adb.connect();
    if (!connectResult.ok) {
      const isAuthError = this.#isAdbAuthError(connectResult.error);
      this.#logger.error?.('resilient.recovery.connectFailed', {
        error: connectResult.error,
        isAuthError
      });
      return {
        ok: false,
        error: isAuthError
          ? 'ADB authorization required — approve the prompt on the Shield TV'
          : `ADB connect failed: ${connectResult.error}`
      };
    }

    // Step 2: Launch the app activity
    const launchResult = await this.#adb.launchActivity(this.#launchActivity);
    if (!launchResult.ok) {
      const isAuthError = this.#isAdbAuthError(launchResult.error);
      this.#logger.error?.('resilient.recovery.launchFailed', {
        error: launchResult.error,
        isAuthError
      });
      return {
        ok: false,
        error: isAuthError
          ? 'ADB authorization required — approve the prompt on the Shield TV'
          : `ADB launch failed: ${launchResult.error}`
      };
    }

    // Step 3: Poll for FKB readiness instead of flat wait
    this.#logger.info?.('resilient.recovery.pollingForBoot', { maxWaitMs: POLL_MAX_WAIT_MS });
    const ready = await this.#pollPrimaryReady(POLL_MAX_WAIT_MS, POLL_INTERVAL_MS);

    if (!ready) {
      const elapsedMs = Date.now() - startTime;
      this.#logger.error?.('resilient.recovery.bootTimeout', { elapsedMs });
      return { ok: false, error: 'Kiosk app launched but did not become reachable' };
    }

    this.#metrics.recoverySuccesses++;
    const elapsedMs = Date.now() - startTime;

    this.#logger.info?.('resilient.recovery.complete', {
      elapsedMs,
      totalAttempts: this.#metrics.recoveryAttempts,
      totalSuccesses: this.#metrics.recoverySuccesses
    });

    return { ok: true, elapsedMs };
  }

  /**
   * Poll the primary adapter until it responds or timeout.
   * @private
   * @param {number} maxWaitMs - Maximum time to poll
   * @param {number} intervalMs - Delay between polls
   * @returns {Promise<boolean>} true if primary became reachable
   */
  async #pollPrimaryReady(maxWaitMs, intervalMs) {
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, intervalMs));
      attempt++;

      try {
        const status = await this.#primary.getStatus();
        this.#logger.debug?.('resilient.recovery.poll', { attempt, ready: status.ready });
        if (status.ready) return true;
      } catch {
        this.#logger.debug?.('resilient.recovery.poll', { attempt, ready: false });
      }
    }

    return false;
  }

  /**
   * Check if an ADB error indicates authorization is needed
   * @private
   */
  #isAdbAuthError(errorMessage) {
    if (!errorMessage) return false;
    return errorMessage.includes('authoriz') ||
           errorMessage.includes('unauthorized');
  }

  /**
   * Check if an error indicates the primary is unreachable
   * @private
   */
  #isConnectionError(errorMessage) {
    if (!errorMessage) return false;
    return errorMessage.includes(CONNREFUSED) ||
           errorMessage.includes('ETIMEDOUT') ||
           errorMessage.includes('EHOSTUNREACH');
  }
}

export default ResilientContentAdapter;
