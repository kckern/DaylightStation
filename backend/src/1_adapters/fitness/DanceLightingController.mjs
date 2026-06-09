import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { resolveDanceLightingConfig } from './danceLightingConfig.mjs';

/**
 * DanceLightingController — drives the garage Hue strips for "Party Mode":
 * white lights off + colorloop base, rate-capped strobe accents, simple restore.
 * Reuses IHomeAutomationGateway. Leaves the zone-driven AmbientLedAdapter alone.
 */
export class DanceLightingController {
  #gateway;
  #loadFitnessConfig;
  #logger;
  #lastAccentAt = -Infinity;

  constructor({ gateway, loadFitnessConfig, logger } = {}) {
    if (!gateway) throw new InfrastructureError('DanceLightingController requires gateway', { code: 'MISSING_DEPENDENCY', dependency: 'gateway' });
    if (!loadFitnessConfig) throw new InfrastructureError('DanceLightingController requires loadFitnessConfig', { code: 'MISSING_DEPENDENCY', dependency: 'loadFitnessConfig' });
    this.#gateway = gateway;
    this.#loadFitnessConfig = loadFitnessConfig;
    this.#logger = logger || console;
  }

  #config(householdId) {
    return resolveDanceLightingConfig(this.#loadFitnessConfig(householdId));
  }

  async start(householdId) {
    const cfg = this.#config(householdId);
    if (!cfg.enabled || cfg.colorStrips.length === 0) {
      return { ok: true, skipped: true, reason: 'lighting_not_configured' };
    }
    try {
      if (cfg.whiteLights.length) {
        await this.#gateway.callService('light', 'turn_off', { entity_id: cfg.whiteLights });
      }
      await this.#gateway.callService('light', 'turn_on', { entity_id: cfg.colorStrips, effect: cfg.baseEffect });
      this.#lastAccentAt = -Infinity;
      this.#logger.info?.('fitness.dance.lighting.start', { strips: cfg.colorStrips.length, effect: cfg.baseEffect });
      return { ok: true, started: true };
    } catch (error) {
      this.#logger.error?.('fitness.dance.lighting.start_failed', { error: error.message });
      return { ok: false, error: error.message };
    }
  }

  async accent(householdId, now = Date.now()) {
    const cfg = this.#config(householdId);
    if (!cfg.enabled || cfg.colorStrips.length === 0) {
      return { ok: true, skipped: true, reason: 'lighting_not_configured' };
    }
    if (now - this.#lastAccentAt < cfg.accent.minIntervalMs) {
      return { ok: true, skipped: true, reason: 'rate_limited' };
    }
    this.#lastAccentAt = now;
    try {
      const pop = cfg.accent.mode === 'flash'
        ? { entity_id: cfg.colorStrips, flash: 'short' }
        : { entity_id: cfg.colorStrips, effect: cfg.accent.mode };
      await this.#gateway.callService('light', 'turn_on', pop);
      // Re-assert the base effect so colorloop resumes after the pop.
      await this.#gateway.callService('light', 'turn_on', { entity_id: cfg.colorStrips, effect: cfg.baseEffect });
      return { ok: true, accented: true };
    } catch (error) {
      this.#logger.error?.('fitness.dance.lighting.accent_failed', { error: error.message });
      return { ok: false, error: error.message };
    }
  }

  async stop(householdId) {
    const cfg = this.#config(householdId);
    try {
      if (cfg.whiteLights.length) {
        await this.#gateway.callService('light', 'turn_on', { entity_id: cfg.whiteLights });
      }
      if (cfg.colorStrips.length) {
        await this.#gateway.callService('light', 'turn_off', { entity_id: cfg.colorStrips });
      }
      this.#logger.info?.('fitness.dance.lighting.stop', {});
      return { ok: true, stopped: true };
    } catch (error) {
      this.#logger.error?.('fitness.dance.lighting.stop_failed', { error: error.message });
      return { ok: false, error: error.message };
    }
  }
}

export default DanceLightingController;
