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
  #lastBpmSentAt = -Infinity;
  #lastBpmValue = null;

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
    let flagFailed = false;
    if (cfg.partyModeFlag) {
      try {
        // Raise the HA party-mode flag BEFORE touching any lights so the
        // garage deactivation guards yield to the party.
        await this.#gateway.callService('input_boolean', 'turn_on', { entity_id: cfg.partyModeFlag });
      } catch (error) {
        flagFailed = true;
        this.#logger.warn?.('fitness.dance.lighting.party_flag_on_failed', { entity: cfg.partyModeFlag, error: error.message });
      }
    }
    try {
      // If the flag failed to raise, skip the white-lights turn_off so the
      // unguarded deactivation trigger can't fire; party proceeds with overheads on.
      if (cfg.whiteLights.length && !flagFailed) {
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

  /**
   * Mirror the music's live BPM into the configured HA input_number so
   * HA-side strobe scripts (which re-read it on every flip) follow the song
   * tempo. Storm guards: unchanged values are dropped, and sends are
   * rate-capped (bpmMinIntervalMs); value clamps to the entity's 10–200 range.
   */
  async setBpm(householdId, bpm, now = Date.now()) {
    const cfg = this.#config(householdId);
    if (!cfg.enabled || !cfg.bpmEntity) {
      return { ok: true, skipped: true, reason: 'bpm_entity_not_configured' };
    }
    const value = Math.round(Number(bpm));
    if (!Number.isFinite(value)) {
      return { ok: false, error: 'invalid_bpm' };
    }
    const clamped = Math.min(200, Math.max(10, value));
    if (clamped === this.#lastBpmValue) {
      return { ok: true, skipped: true, reason: 'unchanged' };
    }
    if (now - this.#lastBpmSentAt < cfg.bpmMinIntervalMs) {
      return { ok: true, skipped: true, reason: 'rate_limited' };
    }
    this.#lastBpmSentAt = now;
    this.#lastBpmValue = clamped;
    try {
      await this.#gateway.callService('input_number', 'set_value', { entity_id: cfg.bpmEntity, value: clamped });
      this.#logger.info?.('fitness.dance.lighting.bpm_set', { entity: cfg.bpmEntity, bpm: clamped });
      return { ok: true, bpm: clamped };
    } catch (error) {
      // Allow the next attempt to resend the same value after a failure.
      this.#lastBpmValue = null;
      this.#logger.error?.('fitness.dance.lighting.bpm_set_failed', { error: error.message });
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
    } catch (error) {
      this.#logger.error?.('fitness.dance.lighting.stop_failed', { error: error.message });
      return { ok: false, error: error.message };
    }
    if (cfg.partyModeFlag) {
      try {
        // Clear the HA party-mode flag AFTER restoring lights; the 4h HA
        // auto-expire automation is the backstop if this fails.
        await this.#gateway.callService('input_boolean', 'turn_off', { entity_id: cfg.partyModeFlag });
      } catch (error) {
        this.#logger.warn?.('fitness.dance.lighting.party_flag_off_failed', { entity: cfg.partyModeFlag, error: error.message });
      }
    }
    return { ok: true, stopped: true };
  }
}

export default DanceLightingController;
