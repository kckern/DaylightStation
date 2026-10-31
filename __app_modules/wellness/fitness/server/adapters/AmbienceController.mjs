import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * AmbienceController — starts/stops the Home Assistant script that an
 * `ambience` nav item names (e.g. the Halloween tab's
 * `ha_script: script.garage_led_halloween`).
 *
 * The client sends only the ambience id; the script entity is always read from
 * the fitness config, so a request can never run an arbitrary HA script. The
 * script owns its own lights/heat and cleanup: it is called with
 * `variables: { command: 'start' | 'stop' }`.
 *
 * While an ambience is running, `isActive()` is true and the zone-driven
 * AmbientLedAdapter stands down so heart-rate colors never paint over it.
 */
export class AmbienceController {
  #gateway;
  #loadFitnessConfig;
  #logger;
  #activeId = null;

  constructor({ gateway, loadFitnessConfig, logger } = {}) {
    if (!gateway) throw new InfrastructureError('AmbienceController requires gateway', { code: 'MISSING_DEPENDENCY', dependency: 'gateway' });
    if (!loadFitnessConfig) throw new InfrastructureError('AmbienceController requires loadFitnessConfig', { code: 'MISSING_DEPENDENCY', dependency: 'loadFitnessConfig' });
    this.#gateway = gateway;
    this.#loadFitnessConfig = loadFitnessConfig;
    this.#logger = logger || console;
  }

  /** The configured ambience nav item with this id, or null. */
  #find(householdId, ambienceId) {
    const root = this.#loadFitnessConfig(householdId) || {};
    const contentSource = root.content_source || 'plex';
    const content = root.content || root.plex || root[contentSource] || {};
    const items = Array.isArray(content.nav_items) ? content.nav_items : [];
    return items.find((item) => item?.type === 'ambience' && String(item?.target?.id) === String(ambienceId)) || null;
  }

  isActive() {
    return this.#activeId != null;
  }

  async start(householdId, ambienceId) {
    return this.#run(householdId, ambienceId, 'start');
  }

  async stop(householdId, ambienceId) {
    return this.#run(householdId, ambienceId, 'stop');
  }

  async #run(householdId, ambienceId, command) {
    const item = this.#find(householdId, ambienceId);
    if (!item) {
      this.#logger.warn?.('fitness.ambience.unknown', { ambienceId, command });
      return { ok: false, reason: 'unknown_ambience' };
    }
    const script = item.target?.ha_script;
    if (command === 'start') this.#activeId = String(ambienceId);
    else if (this.#activeId === String(ambienceId)) this.#activeId = null;
    if (typeof script !== 'string' || !script.startsWith('script.')) {
      this.#logger.info?.('fitness.ambience.no_script', { ambienceId, command });
      return { ok: true, skipped: true, reason: 'no_ha_script' };
    }
    // The gateway reports failure as { ok: false, error } rather than throwing.
    let result;
    try {
      result = await this.#gateway.callService('script', 'turn_on', { entity_id: script, variables: { command } });
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    if (result?.ok === false) {
      this.#logger.error?.(`fitness.ambience.${command}_failed`, { ambienceId, script, error: result.error ?? null });
      return { ok: false, reason: 'ha_error', error: result.error ?? null };
    }
    this.#logger.info?.(`fitness.ambience.${command}`, { ambienceId, script });
    return { ok: true, command, script };
  }
}

export default AmbienceController;
