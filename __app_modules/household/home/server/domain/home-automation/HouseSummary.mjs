/**
 * HouseSummary — what the house is doing right now, as household policy
 * decides it: which sensor is the whole-house meter, below what percentage a
 * battery is "low", how recent "recent motion" is, and which entities never
 * count as news (an always-on plug, an automation flag).
 *
 * `HouseSummaryPolicy` is a value object built from the `now:` and `power:`
 * sections of the household dashboard config; `summarizeHouse` applies it to
 * a list of HomeEntity-shaped readings and returns entity ids, not copies —
 * presentation (grouping by room, wording) joins them back.
 *
 * @module home-automation/HouseSummary
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

const DEFAULTS = Object.freeze({
  lowBatteryPct: 20,
  motionWindowMinutes: 15,
  // A light or a plug that is on is news; a wall switch feeding who-knows-what
  // and an input_boolean automation flag are not, unless the household says so.
  onTypes: ['light', 'power', 'media'],
  ignore: [],
  wholeHouse: null,
  energyToday: null,
  energyThisMonth: null,
  // A UPS reports its rated capacity with the power device class; a rating is
  // not a reading, and would sit near the top of every ranking.
  powerExclude: ['*_nominal_*'],
  top: 5,
});

function invalid(message, field, value) {
  return new ValidationError(`dashboard ${message}`, { code: 'INVALID_HOUSE_SUMMARY_POLICY', field, value });
}

function optionalNumber(value, key, { min, max }) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw invalid(`${key} must be a number from ${min} to ${max}`, key, value);
  }
  return value;
}

function optionalId(value, key) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value.includes('.')) throw invalid(`${key} must be an entity id`, key, value);
  return value;
}

function optionalList(value, key) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v)) {
    throw invalid(`${key} must be a list of strings`, key, value);
  }
  return value;
}

const globCache = new Map();
function globToRegExp(glob) {
  if (!globCache.has(glob)) {
    const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    globCache.set(glob, new RegExp(`^${escaped}$`));
  }
  return globCache.get(glob);
}

function matchesAny(entityId, globs) {
  const objectId = entityId.slice(entityId.indexOf('.') + 1);
  return globs.some((g) => globToRegExp(g).test(entityId) || globToRegExp(g).test(objectId));
}

export class HouseSummaryPolicy {
  #p;

  constructor(props) {
    this.#p = Object.freeze(props);
    Object.freeze(this);
  }

  /**
   * @param {Object} [sections]
   * @param {Object} [sections.now] - the `now:` YAML section
   * @param {Object} [sections.power] - the `power:` YAML section
   */
  static fromConfig({ now = {}, power = {} } = {}) {
    const n = now || {};
    const p = power || {};
    return new HouseSummaryPolicy({
      lowBatteryPct: optionalNumber(n.low_battery_pct, 'now.low_battery_pct', { min: 0, max: 100 }) ?? DEFAULTS.lowBatteryPct,
      motionWindowMinutes: optionalNumber(n.motion_window_minutes, 'now.motion_window_minutes', { min: 0, max: 1440 }) ?? DEFAULTS.motionWindowMinutes,
      onTypes: optionalList(n.on_types, 'now.on_types') ?? DEFAULTS.onTypes,
      ignore: optionalList(n.ignore, 'now.ignore') ?? DEFAULTS.ignore,
      wholeHouse: optionalId(p.whole_house, 'power.whole_house') ?? DEFAULTS.wholeHouse,
      energyToday: optionalId(p.energy_today, 'power.energy_today') ?? DEFAULTS.energyToday,
      energyThisMonth: optionalId(p.energy_this_month, 'power.energy_this_month') ?? DEFAULTS.energyThisMonth,
      powerExclude: [...DEFAULTS.powerExclude, ...(optionalList(p.exclude, 'power.exclude') ?? [])],
      top: optionalNumber(p.top, 'power.top', { min: 1, max: 50 }) ?? DEFAULTS.top,
    });
  }

  get lowBatteryPct() { return this.#p.lowBatteryPct; }
  get motionWindowMinutes() { return this.#p.motionWindowMinutes; }
  get onTypes() { return this.#p.onTypes; }
  get wholeHouse() { return this.#p.wholeHouse; }
  get energyToday() { return this.#p.energyToday; }
  get energyThisMonth() { return this.#p.energyThisMonth; }
  get top() { return this.#p.top; }

  /** Entities the household never wants reported on the Now view. */
  isIgnored(entityId) { return matchesAny(entityId, this.#p.ignore); }

  /** Meters left out of the top-consumers list (a UPS inside a monitored circuit). */
  isExcludedFromPower(entityId) { return matchesAny(entityId, this.#p.powerExclude); }
}

function numberOf(state) {
  if (state == null || (typeof state === 'string' && state.trim() === '')) return null;
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

/** Power readings in watts, whatever unit the platform reports. */
function wattsOf(entity) {
  const n = numberOf(entity.state);
  if (n == null) return null;
  const unit = (entity.unit || '').toLowerCase();
  if (unit === 'kw') return n * 1000;
  if (unit === 'mw') return n / 1000;
  return n;
}

function kwhOf(entity) {
  const n = numberOf(entity.state);
  if (n == null) return null;
  const unit = (entity.unit || '').toLowerCase();
  if (unit === 'wh') return n / 1000;
  if (unit === 'mwh') return n * 1000;
  return n;
}

const isPowerMeter = (e) => e.type === 'power' && e.domain === 'sensor' && e.deviceClass === 'power' && e.stateClass === 'reading';
const isEnergyMeter = (e) => e.type === 'power' && e.domain === 'sensor' && e.deviceClass === 'energy' && e.stateClass === 'reading';

/**
 * Pick the whole-house meter: the configured one, else the largest live power
 * reading — a panel total is by construction at least every circuit under it.
 */
function pickWholeHouse(meters, policy) {
  if (policy.wholeHouse) return meters.find((e) => e.id === policy.wholeHouse) || null;
  return meters.reduce((best, e) => (best == null || wattsOf(e) > wattsOf(best) ? e : best), null);
}

/** The energy sensor the household named, else the meter's sibling by naming convention. */
function pickEnergy(energyMeters, configuredId, wholeHouse, suffix) {
  if (configuredId) return energyMeters.find((e) => e.id === configuredId) || null;
  if (!wholeHouse || !wholeHouse.id.endsWith('_power')) return null;
  const sibling = wholeHouse.id.replace(/_power$/, suffix);
  return energyMeters.find((e) => e.id === sibling) || null;
}

/**
 * @param {Array<{id: string, domain: string, type: string, state: string|null, stateClass: string,
 *   unit?: string|null, deviceClass?: string|null, lastChanged?: string|null}>} entities
 *   HomeEntity instances or their DTOs; only getters common to both are read
 * @param {HouseSummaryPolicy} policy
 * @param {{now: number}} opts - the caller's clock (ms), for the motion window; the domain has none
 */
export function summarizeHouse(entities, policy, { now } = {}) {
  if (!Number.isFinite(now)) {
    throw new ValidationError('summarizeHouse needs the current time', { code: 'MISSING_CLOCK', field: 'now', value: now });
  }
  const live = entities.filter((e) => !policy.isIgnored(e.id));

  const powerMeters = live.filter(isPowerMeter);
  const energyMeters = live.filter(isEnergyMeter);
  const wholeHouse = pickWholeHouse(powerMeters, policy);
  const energyToday = pickEnergy(energyMeters, policy.energyToday, wholeHouse, '_energy_today');
  const energyThisMonth = pickEnergy(energyMeters, policy.energyThisMonth, wholeHouse, '_energy_this_month');
  const topConsumers = powerMeters
    .filter((e) => e !== wholeHouse && !policy.isExcludedFromPower(e.id))
    .map((e) => ({ entityId: e.id, watts: wattsOf(e) }))
    .filter((c) => c.watts > 0)
    .sort((a, b) => b.watts - a.watts)
    .slice(0, policy.top);

  const windowMs = policy.motionWindowMinutes * 60_000;
  const recent = (e) => {
    const t = Date.parse(e.lastChanged);
    return Number.isFinite(t) && now - t <= windowMs;
  };

  return {
    power: {
      wholeHouse: wholeHouse ? { entityId: wholeHouse.id, watts: wattsOf(wholeHouse) } : null,
      energyToday: energyToday ? { entityId: energyToday.id, kwh: kwhOf(energyToday) } : null,
      energyThisMonth: energyThisMonth ? { entityId: energyThisMonth.id, kwh: kwhOf(energyThisMonth) } : null,
      topConsumers,
    },
    on: live.filter((e) => e.stateClass === 'on' && policy.onTypes.includes(e.type)).map((e) => e.id),
    open: live.filter((e) => e.type === 'openings' && e.stateClass === 'on').map((e) => e.id),
    motion: live.filter((e) => e.type === 'presence' && (e.stateClass === 'on' || (e.stateClass === 'off' && recent(e)))).map((e) => e.id),
    lowBattery: live
      .filter((e) => e.type === 'battery' && e.stateClass === 'reading')
      .map((e) => ({ entityId: e.id, pct: numberOf(e.state) }))
      .filter((b) => b.pct != null && b.pct <= policy.lowBatteryPct)
      .sort((a, b) => a.pct - b.pct),
    unavailable: live.filter((e) => e.stateClass === 'unavailable').map((e) => e.id),
    thresholds: { lowBatteryPct: policy.lowBatteryPct, motionWindowMinutes: policy.motionWindowMinutes },
  };
}

export default HouseSummaryPolicy;
