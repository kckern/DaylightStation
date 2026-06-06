// backend/src/1_adapters/fitness/HaActionGuard.mjs
/**
 * HaActionGuard — reusable guard rails around a single Home Assistant action.
 * Provides throttle, circuit-breaker, dedup, and metrics. Provider-agnostic;
 * the caller supplies `action` (an async fn returning { ok }).
 */
export class HaActionGuard {
  constructor({ logger, name = 'ha-action', maxFailures = 5 } = {}) {
    this.name = name;
    this.logger = logger || console;
    this.maxFailures = maxFailures;
    this.failureCount = 0;
    this.backoffUntil = 0;
    this.lastKey = null;
    this.lastRunAt = 0;
    this.metrics = {
      totalRequests: 0, ranCount: 0, failureCount: 0,
      skippedDuplicate: 0, skippedRateLimited: 0, skippedBackoff: 0,
      uptimeStart: Date.now()
    };
  }

  async run({ key, throttleMs = 2000, dedupe = true, force = false, action }) {
    this.metrics.totalRequests++;
    const now = Date.now();

    if (this.backoffUntil > now) {
      this.metrics.skippedBackoff++;
      return { ok: true, skipped: true, reason: 'backoff' };
    }
    if (dedupe && !force && key != null && key === this.lastKey) {
      this.metrics.skippedDuplicate++;
      return { ok: true, skipped: true, reason: 'duplicate', key };
    }
    if (!force && (now - this.lastRunAt) < throttleMs) {
      this.metrics.skippedRateLimited++;
      return { ok: true, skipped: true, reason: 'rate_limited' };
    }

    try {
      const result = await action();
      if (!result || result.ok === false) {
        throw new Error(result?.error || 'HA action failed');
      }
      this.failureCount = 0;
      if (key != null) this.lastKey = key;
      this.lastRunAt = now;
      this.metrics.ranCount++;
      return { ok: true, key, result };
    } catch (error) {
      this.failureCount++;
      this.metrics.failureCount++;
      if (this.failureCount >= this.maxFailures) {
        const backoffMs = Math.min(60000, 1000 * Math.pow(2, this.failureCount - this.maxFailures));
        this.backoffUntil = now + backoffMs;
        this.logger.error?.(`${this.name}.circuit_open`, { failureCount: this.failureCount, backoffMs, error: error.message });
      } else {
        this.logger.error?.(`${this.name}.failed`, { error: error.message, failureCount: this.failureCount });
      }
      return { ok: false, error: error.message, failureCount: this.failureCount };
    }
  }

  getStatus() {
    return {
      lastKey: this.lastKey,
      lastRunAt: this.lastRunAt,
      failureCount: this.failureCount,
      backoffUntil: this.backoffUntil,
      isInBackoff: this.backoffUntil > Date.now()
    };
  }

  getMetrics() {
    return { ...this.metrics, uptimeMs: Date.now() - this.metrics.uptimeStart };
  }

  reset() {
    this.failureCount = 0;
    this.backoffUntil = 0;
    this.lastKey = null;
    this.lastRunAt = 0;
    return { ok: true, reset: true };
  }
}
