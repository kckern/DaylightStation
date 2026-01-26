/**
 * AmbientLedAdapter - Controls ambient LED for fitness zones
 *
 * Provider-agnostic adapter that uses IHomeAutomationGateway to sync
 * ambient LED scenes with workout zone intensity.
 *
 * Features:
 * - Rate limiting to prevent excessive calls
 * - Circuit breaker for failure protection
 * - Deduplication to skip redundant scene changes
 * - Metrics for observability
 *
 * Works with any home automation provider (Home Assistant, Hubitat, etc.)
 */
import { ZONE_PRIORITY } from '../../1_domains/fitness/entities/Zone.mjs';
import { nowTs24 } from '../../0_infrastructure/utils/index.mjs';

const ZONE_ORDER = ['cool', 'active', 'warm', 'hot', 'fire'];
const ZONE_LOSS_GRACE_PERIOD_MS = 30000; // 30 seconds grace before turning off

/**
 * Format duration in human-readable format
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export class AmbientLedAdapter {
  #gateway;
  #loadFitnessConfig;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.gateway - IHomeAutomationGateway implementation
   * @param {Function} config.loadFitnessConfig - Function to load fitness config
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config?.gateway) {
      throw new Error('AmbientLedAdapter requires gateway');
    }
    if (!config?.loadFitnessConfig) {
      throw new Error('AmbientLedAdapter requires loadFitnessConfig');
    }

    this.#gateway = config.gateway;
    this.#loadFitnessConfig = config.loadFitnessConfig;
    this.#logger = config.logger || console;

    // State
    this.lastScene = null;
    this.lastActivatedAt = 0;

    // Circuit breaker
    this.failureCount = 0;
    this.maxFailures = 5;
    this.backoffUntil = 0;

    // Grace period for transient zone loss
    this.graceTimer = null;
    this.graceStartedAt = null;

    // Metrics
    this.metrics = {
      totalRequests: 0,
      activatedCount: 0,
      skippedDuplicate: 0,
      skippedRateLimited: 0,
      skippedBackoff: 0,
      skippedDisabled: 0,
      failureCount: 0,
      lastActivatedScene: null,
      lastActivatedTime: null,
      sceneHistogram: {},
      sessionStartCount: 0,
      sessionEndCount: 0,
      uptimeStart: Date.now()
    };
  }

  /**
   * Normalize zone ID to canonical form
   */
  normalizeZoneId(zoneId) {
    if (!zoneId) return null;
    const lower = String(zoneId).toLowerCase().trim();
    return ZONE_ORDER.includes(lower) ? lower : null;
  }

  /**
   * Check if ambient LED feature is enabled
   * @private
   */
  #isEnabled(fitnessConfig) {
    const ambientLed = fitnessConfig?.ambient_led;
    if (!ambientLed) return false;

    const scenes = ambientLed.scenes;
    if (!scenes || typeof scenes !== 'object') return false;
    if (!scenes.off) return false; // 'off' scene is required

    return true;
  }

  /**
   * Clear any active grace period timer
   * @private
   */
  #clearGraceTimer() {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
      this.graceStartedAt = null;
    }
  }

  /**
   * Resolve scene from config with fallback chain
   * @private
   */
  #resolveSceneFromConfig(sceneConfig, zoneKey) {
    if (!sceneConfig || typeof sceneConfig !== 'object') return null;

    // Direct lookup
    if (sceneConfig[zoneKey]) return sceneConfig[zoneKey];

    // Fallback chain for missing zone scenes
    if (zoneKey === 'fire_all') return sceneConfig.fire || sceneConfig.off || null;

    const zoneIndex = ZONE_ORDER.indexOf(zoneKey);
    if (zoneIndex > 0) {
      // Fall back to next lower zone
      for (let i = zoneIndex - 1; i >= 0; i--) {
        if (sceneConfig[ZONE_ORDER[i]]) return sceneConfig[ZONE_ORDER[i]];
      }
    }

    return sceneConfig.off || null;
  }

  /**
   * Resolve target scene based on active zones
   * @private
   */
  #resolveTargetScene(zones, sessionEnded, sceneConfig) {
    if (!sceneConfig) return null;

    if (sessionEnded) return this.#resolveSceneFromConfig(sceneConfig, 'off');

    const activeZones = zones
      .filter(z => z && z.isActive !== false)
      .map(z => this.normalizeZoneId(z.zoneId))
      .filter(Boolean);

    if (activeZones.length === 0) return this.#resolveSceneFromConfig(sceneConfig, 'off');

    const maxZone = activeZones.reduce((max, zone) =>
      ZONE_PRIORITY[zone] > ZONE_PRIORITY[max] ? zone : max
    , 'cool');

    // Special case: ALL users in fire zone → breathing effect
    if (maxZone === 'fire' && activeZones.every(z => z === 'fire')) {
      return this.#resolveSceneFromConfig(sceneConfig, 'fire_all');
    }

    return this.#resolveSceneFromConfig(sceneConfig, maxZone);
  }

  /**
   * Sync zone LED state
   */
  async syncZone({ zones = [], sessionEnded = false, householdId }) {
    this.metrics.totalRequests++;
    const now = Date.now();

    // Track session events
    if (sessionEnded) {
      this.metrics.sessionEndCount++;
    }

    // Load fitness config
    const fitnessConfig = this.#loadFitnessConfig(householdId);

    // Check if feature is enabled
    if (!this.#isEnabled(fitnessConfig)) {
      this.metrics.skippedDisabled++;
      this.#logger.debug?.('fitness.zone_led.skipped', {
        reason: 'feature_disabled',
        householdId
      });
      return {
        ok: true,
        skipped: true,
        reason: 'feature_disabled',
        message: 'ambient_led not configured or missing required scenes'
      };
    }

    const sceneConfig = fitnessConfig.ambient_led.scenes;
    const throttleMs = fitnessConfig.ambient_led.throttle_ms || 2000;

    // Circuit breaker: if too many failures, wait before retrying
    if (this.backoffUntil > now) {
      this.metrics.skippedBackoff++;
      this.#logger.warn?.('fitness.zone_led.backoff', {
        remainingMs: this.backoffUntil - now,
        failureCount: this.failureCount
      });
      return {
        ok: true,
        skipped: true,
        reason: 'backoff',
        scene: this.lastScene
      };
    }

    const targetScene = this.#resolveTargetScene(zones, sessionEnded, sceneConfig);

    // Grace period handling for transient zone loss during active sessions
    const isZoneEmpty = !zones.some(z => z && z.isActive !== false && this.normalizeZoneId(z.zoneId));
    const offScene = this.#resolveSceneFromConfig(sceneConfig, 'off');

    // Session end: always immediately turn off and clear grace
    if (sessionEnded) {
      this.#clearGraceTimer();
      // Continue to activation logic below
    }
    // Zone loss during active session: start grace period instead of immediate off
    else if (isZoneEmpty && targetScene === offScene && this.lastScene && this.lastScene !== offScene) {
      // Already in grace period? Just return, timer is running
      if (this.graceTimer) {
        this.#logger.debug?.('fitness.zone_led.grace_period.active', {
          elapsedMs: Date.now() - this.graceStartedAt,
          remainingMs: ZONE_LOSS_GRACE_PERIOD_MS - (Date.now() - this.graceStartedAt)
        });
        return {
          ok: true,
          skipped: true,
          reason: 'grace_period_active',
          scene: this.lastScene
        };
      }

      // Start grace period
      this.graceStartedAt = Date.now();
      this.graceTimer = setTimeout(async () => {
        this.graceTimer = null;
        this.graceStartedAt = null;

        // Fire the off scene after grace period expires
        try {
          const result = await this.#gateway.activateScene(offScene);
          if (result.ok) {
            const previousScene = this.lastScene;
            this.lastScene = offScene;
            this.lastActivatedAt = Date.now();
            this.failureCount = 0;

            this.metrics.activatedCount++;
            this.metrics.lastActivatedScene = offScene;
            this.metrics.lastActivatedTime = nowTs24();
            this.metrics.sceneHistogram[offScene] = (this.metrics.sceneHistogram[offScene] || 0) + 1;

            this.#logger.info?.('fitness.zone_led.grace_period.expired', {
              scene: offScene,
              previousScene,
              gracePeriodMs: ZONE_LOSS_GRACE_PERIOD_MS
            });
          }
        } catch (error) {
          this.failureCount++;
          this.metrics.failureCount++;
          this.#logger.error?.('fitness.zone_led.grace_period.failed', { error: error.message });
        }
      }, ZONE_LOSS_GRACE_PERIOD_MS);

      this.#logger.info?.('fitness.zone_led.grace_period.started', {
        currentScene: this.lastScene,
        gracePeriodMs: ZONE_LOSS_GRACE_PERIOD_MS
      });

      return {
        ok: true,
        gracePeriodStarted: true,
        scene: this.lastScene,
        gracePeriodMs: ZONE_LOSS_GRACE_PERIOD_MS
      };
    }
    // Zones returned: clear any grace period
    else if (!isZoneEmpty && this.graceTimer) {
      this.#logger.info?.('fitness.zone_led.grace_period.cancelled', {
        elapsedMs: Date.now() - this.graceStartedAt,
        newZones: zones.map(z => z.zoneId)
      });
      this.#clearGraceTimer();
    }

    if (!targetScene) {
      this.#logger.debug?.('fitness.zone_led.skipped', {
        reason: 'no_scene_configured',
        zones: zones.map(z => z.zoneId)
      });
      return {
        ok: true,
        skipped: true,
        reason: 'no_scene_configured',
        message: 'No scene configured for resolved zone'
      };
    }

    // Deduplication: skip if same scene (unless session ended - always send off)
    if (targetScene === this.lastScene && !sessionEnded) {
      this.metrics.skippedDuplicate++;
      this.#logger.debug?.('fitness.zone_led.skipped', {
        reason: 'duplicate',
        scene: targetScene
      });
      return {
        ok: true,
        skipped: true,
        reason: 'duplicate',
        scene: targetScene
      };
    }

    // Rate limiting: minimum interval between calls (session-end bypasses throttle)
    const elapsed = now - this.lastActivatedAt;
    if (elapsed < throttleMs && !sessionEnded) {
      this.metrics.skippedRateLimited++;
      this.#logger.debug?.('fitness.zone_led.skipped', {
        reason: 'rate_limited',
        elapsed,
        throttleMs
      });
      return {
        ok: true,
        skipped: true,
        reason: 'rate_limited',
        scene: this.lastScene
      };
    }

    // Activate scene via Home Assistant
    try {
      const activationStart = Date.now();
      const result = await this.#gateway.activateScene(targetScene);
      const activationDuration = Date.now() - activationStart;

      if (result.ok) {
        // Update state
        const previousScene = this.lastScene;
        this.lastScene = targetScene;
        this.lastActivatedAt = now;
        this.failureCount = 0;

        // Update metrics
        this.metrics.activatedCount++;
        this.metrics.lastActivatedScene = targetScene;
        this.metrics.lastActivatedTime = nowTs24();
        this.metrics.sceneHistogram[targetScene] =
          (this.metrics.sceneHistogram[targetScene] || 0) + 1;

        // Track session start (first non-off activation)
        if (!previousScene && targetScene !== sceneConfig.off) {
          this.metrics.sessionStartCount++;
        }

        this.#logger.info?.('fitness.zone_led.activated', {
          scene: targetScene,
          previousScene,
          activeCount: zones.filter(z => z && z.isActive !== false).length,
          sessionEnded,
          durationMs: activationDuration,
          householdId
        });

        return { ok: true, scene: targetScene };
      } else {
        throw new Error(result.error || 'HA activation failed');
      }
    } catch (error) {
      this.failureCount++;
      this.metrics.failureCount++;

      // Exponential backoff after repeated failures
      if (this.failureCount >= this.maxFailures) {
        const backoffMs = Math.min(60000, 1000 * Math.pow(2, this.failureCount - this.maxFailures));
        this.backoffUntil = Date.now() + backoffMs;

        this.#logger.error?.('fitness.zone_led.circuit_open', {
          failureCount: this.failureCount,
          backoffMs,
          error: error.message
        });
      } else {
        this.#logger.error?.('fitness.zone_led.failed', {
          error: error.message,
          failureCount: this.failureCount,
          totalFailures: this.metrics.failureCount
        });
      }

      return {
        ok: false,
        error: error.message,
        failureCount: this.failureCount
      };
    }
  }

  /**
   * Get current controller status
   */
  getStatus(householdId) {
    const fitnessConfig = this.#loadFitnessConfig(householdId);
    const enabled = this.#isEnabled(fitnessConfig);

    return {
      enabled,
      scenes: enabled ? fitnessConfig.ambient_led.scenes : null,
      throttleMs: enabled ? (fitnessConfig.ambient_led.throttle_ms || 2000) : null,
      state: {
        lastScene: this.lastScene,
        lastActivatedAt: this.lastActivatedAt,
        failureCount: this.failureCount,
        backoffUntil: this.backoffUntil,
        isInBackoff: this.backoffUntil > Date.now()
      }
    };
  }

  /**
   * Get detailed metrics
   */
  getMetrics() {
    const now = Date.now();
    const uptimeMs = now - this.metrics.uptimeStart;

    return {
      uptime: {
        ms: uptimeMs,
        formatted: formatDuration(uptimeMs),
        startedAt: new Date(this.metrics.uptimeStart).toISOString()
      },
      totals: {
        requests: this.metrics.totalRequests,
        activated: this.metrics.activatedCount,
        failures: this.metrics.failureCount,
        sessionStarts: this.metrics.sessionStartCount,
        sessionEnds: this.metrics.sessionEndCount
      },
      skipped: {
        duplicate: this.metrics.skippedDuplicate,
        rateLimited: this.metrics.skippedRateLimited,
        backoff: this.metrics.skippedBackoff,
        disabled: this.metrics.skippedDisabled
      },
      rates: {
        successRate: this.metrics.totalRequests > 0
          ? ((this.metrics.activatedCount / this.metrics.totalRequests) * 100).toFixed(2) + '%'
          : 'N/A',
        skipRate: this.metrics.totalRequests > 0
          ? (((this.metrics.skippedDuplicate + this.metrics.skippedRateLimited) / this.metrics.totalRequests) * 100).toFixed(2) + '%'
          : 'N/A',
        requestsPerMinute: uptimeMs > 60000
          ? (this.metrics.totalRequests / (uptimeMs / 60000)).toFixed(2)
          : 'N/A (uptime < 1min)'
      },
      sceneHistogram: this.metrics.sceneHistogram,
      lastActivation: {
        scene: this.metrics.lastActivatedScene,
        time: this.metrics.lastActivatedTime
      },
      circuitBreaker: {
        failureCount: this.failureCount,
        maxFailures: this.maxFailures,
        isOpen: this.backoffUntil > now,
        backoffRemaining: this.backoffUntil > now
          ? this.backoffUntil - now
          : 0
      }
    };
  }

  /**
   * Reset controller state
   */
  reset() {
    const previousState = {
      failureCount: this.failureCount,
      backoffUntil: this.backoffUntil,
      lastScene: this.lastScene
    };

    this.failureCount = 0;
    this.backoffUntil = 0;
    this.lastScene = null;
    this.lastActivatedAt = 0;

    this.#logger.info?.('fitness.zone_led.reset', { previousState });

    return { ok: true, previousState };
  }
}

export default AmbientLedAdapter;
