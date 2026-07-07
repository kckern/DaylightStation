/**
 * GarageFanAdapter — fires a Home Assistant smart-plug fan when a fanned
 * piece of equipment is being pedaled hard, a participant is in a warm-enough
 * HR zone, and the garage is warm enough. Trigger-on only (latches per session;
 * a separate system turns the fan off). Scans `equipment[].fan` so any bike can
 * have a fan with zero code changes.
 */
import { HaActionGuard } from './HaActionGuard.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { ZONE_ORDER } from '#domains/fitness/entities/Zone.mjs';

function zoneRank(zoneId) {
  if (!zoneId) return -1;
  return ZONE_ORDER.indexOf(String(zoneId).toLowerCase().trim());
}

function normalizeEntity(id, domain) {
  if (!id) return null;
  const s = String(id).trim();
  return s.includes('.') ? s : `${domain}.${s}`;
}

function cadenceIds(equipment) {
  const c = equipment?.cadence;
  if (c == null) return [];
  return (Array.isArray(c) ? c : [c]).map((x) => String(x));
}

export class GarageFanAdapter {
  #gateway;
  #loadFitnessConfig;
  #logger;
  #guard;
  #latched;

  constructor(config) {
    if (!config?.gateway) {
      throw new InfrastructureError('GarageFanAdapter requires gateway', { code: 'MISSING_DEPENDENCY', dependency: 'gateway' });
    }
    if (!config?.loadFitnessConfig) {
      throw new InfrastructureError('GarageFanAdapter requires loadFitnessConfig', { code: 'MISSING_DEPENDENCY', dependency: 'loadFitnessConfig' });
    }
    this.#gateway = config.gateway;
    this.#loadFitnessConfig = config.loadFitnessConfig;
    this.#logger = config.logger || console;
    this.#guard = new HaActionGuard({ logger: this.#logger, name: 'fitness.equipment_fan' });
    this.#latched = new Set();
  }

  #fannedEquipment(fitnessConfig) {
    const list = Array.isArray(fitnessConfig?.equipment) ? fitnessConfig.equipment : [];
    return list.filter((e) => e?.fan && e.fan.plug_entity);
  }

  #maxActiveZoneRank(zones) {
    let max = -1;
    for (const z of Array.isArray(zones) ? zones : []) {
      if (z?.isActive === false) continue;
      max = Math.max(max, zoneRank(z?.zoneId));
    }
    return max;
  }

  async evaluate({ rpm = {}, zones = [], sessionEnded = false, householdId } = {}) {
    const fitnessConfig = this.#loadFitnessConfig(householdId);
    const fanned = this.#fannedEquipment(fitnessConfig);
    if (fanned.length === 0) {
      return { ok: true, skipped: true, reason: 'no_fan_config' };
    }

    const maxZoneRank = this.#maxActiveZoneRank(zones);
    const results = [];

    for (const equipment of fanned) {
      const key = `${householdId || 'default'}:${equipment.id}`;
      const fan = equipment.fan;

      if (sessionEnded) {
        this.#latched.delete(key);
        results.push({ equipmentId: equipment.id, skipped: true, reason: 'session_ended' });
        continue;
      }
      if (this.#latched.has(key)) {
        results.push({ equipmentId: equipment.id, skipped: true, reason: 'latched' });
        continue;
      }

      const minRpm = Number(fan.min_rpm ?? 0);
      const maxRpm = cadenceIds(equipment).reduce((m, id) => Math.max(m, Number(rpm?.[id] ?? 0)), 0);
      if (maxRpm < minRpm) {
        results.push({ equipmentId: equipment.id, skipped: true, reason: 'rpm_below', maxRpm, minRpm });
        continue;
      }

      const minZoneRank = zoneRank(fan.min_hr_zone);
      if (minZoneRank < 0 || maxZoneRank < minZoneRank) {
        results.push({ equipmentId: equipment.id, skipped: true, reason: 'zone_below', maxZoneRank, minZoneRank });
        continue;
      }

      const tempEntity = normalizeEntity(fan.temp_entity, 'sensor');
      const minTemp = Number(fan.min_temp ?? -Infinity);
      const tempState = await this.#gateway.getState(tempEntity);
      const tempVal = parseFloat(tempState?.state);
      if (!Number.isFinite(tempVal)) {
        this.#logger.warn?.('fitness.equipment_fan.temp_unavailable', { tempEntity, state: tempState?.state, equipmentId: equipment.id });
        results.push({ equipmentId: equipment.id, skipped: true, reason: 'temp_unavailable' });
        continue;
      }
      if (tempVal <= minTemp) {
        results.push({ equipmentId: equipment.id, skipped: true, reason: 'temp_below', tempVal, minTemp });
        continue;
      }

      const plugEntity = normalizeEntity(fan.plug_entity, 'switch');
      // `force: true` bypasses the guard's dedup + throttle (so `throttleMs` here
      // is inert) because the per-session `#latched` Set already guarantees one
      // fire per session. The guard is retained for its circuit-breaker, which
      // runs first regardless of `force`.
      const runResult = await this.#guard.run({
        key,
        throttleMs: Number(fan.throttle_ms ?? 5000), // inert: bypassed by force:true (kept for parity)
        force: true,
        action: () => this.#gateway.callService('switch', 'turn_on', { entity_id: plugEntity })
      });

      if (runResult.ok && !runResult.skipped) {
        this.#latched.add(key);
        this.#logger.info?.('fitness.equipment_fan.activated', { equipmentId: equipment.id, plugEntity, maxRpm, tempVal, householdId });
        results.push({ equipmentId: equipment.id, activated: true, plugEntity, tempVal, maxRpm });
      } else if (runResult.ok) {
        results.push({ equipmentId: equipment.id, skipped: true, reason: runResult.reason });
      } else {
        results.push({ equipmentId: equipment.id, ok: false, error: runResult.error });
      }
    }

    return { ok: true, results };
  }

  getStatus(householdId) {
    const fitnessConfig = this.#loadFitnessConfig(householdId);
    const fanned = this.#fannedEquipment(fitnessConfig);
    return {
      enabled: fanned.length > 0,
      fans: fanned.map((e) => ({
        id: e.id,
        plug: normalizeEntity(e.fan.plug_entity, 'switch'),
        tempEntity: normalizeEntity(e.fan.temp_entity, 'sensor'),
        minTemp: e.fan.min_temp,
        minRpm: e.fan.min_rpm,
        minHrZone: e.fan.min_hr_zone,
        latched: this.#latched.has(`${householdId || 'default'}:${e.id}`)
      })),
      guard: this.#guard.getStatus()
    };
  }

  getMetrics() {
    return this.#guard.getMetrics();
  }

  reset() {
    this.#latched.clear();
    this.#guard.reset();
    return { ok: true, reset: true };
  }
}
