/**
 * HomeEntity — one device or reading in the house as the dashboard shows it:
 * what it is (type), where it is (room), and what it is doing (state class).
 *
 * Value object, built from a provider reading by `HomeEntity.fromReading`.
 *
 * @module home-automation/HomeEntity
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/** State classes, in display order. */
export const STATE_CLASSES = Object.freeze([
  Object.freeze({ id: 'on', label: 'On / active' }),
  Object.freeze({ id: 'off', label: 'Off / idle' }),
  Object.freeze({ id: 'reading', label: 'Readings' }),
  Object.freeze({ id: 'unavailable', label: 'Unavailable' }),
]);

const ON_OFF_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean', 'siren', 'humidifier', 'binary_sensor']);
const ACTIVE_STATES = {
  cover: ['open', 'opening'],
  lock: ['unlocked', 'unlocking', 'open'],
  media_player: ['playing', 'paused', 'on', 'buffering'],
  vacuum: ['cleaning', 'returning'],
};
// Attributes a tile can use; the rest of a provider's attribute bag stays behind.
const KEPT_ATTRIBUTES = ['brightness', 'current_temperature', 'temperature', 'hvac_action', 'media_title', 'percentage'];

/**
 * @param {string} domain
 * @param {string} state
 * @returns {'on'|'off'|'reading'|'unavailable'}
 */
export function stateClassOf(domain, state) {
  if (state == null || state === 'unavailable' || state === 'unknown') return 'unavailable';
  if (ON_OFF_DOMAINS.has(domain)) return state === 'on' ? 'on' : 'off';
  if (ACTIVE_STATES[domain]) return ACTIVE_STATES[domain].includes(state) ? 'on' : 'off';
  if (domain === 'climate' || domain === 'water_heater') return state === 'off' ? 'off' : 'on';
  return 'reading';
}

export class HomeEntity {
  #p;

  constructor({ id, name, state, type, room = null, unit = null, deviceClass = null,
    lastChanged = null, controllable = false, attributes = {} }) {
    if (typeof id !== 'string' || !id.includes('.')) {
      throw new ValidationError('HomeEntity id must be "domain.object_id"', { code: 'INVALID_ENTITY_ID', field: 'id', value: id });
    }
    const domain = id.split('.')[0];
    const stateClass = stateClassOf(domain, state);
    this.#p = Object.freeze({
      id, domain, name: name || id, state: state ?? null, stateClass, type,
      room: room ? Object.freeze({ ...room }) : null,
      unit, deviceClass, lastChanged,
      // Switching something that is not answering would only queue a surprise.
      controllable: Boolean(controllable) && stateClass !== 'unavailable',
      attributes: Object.freeze({ ...attributes }),
    });
    Object.freeze(this);
  }

  /**
   * @param {{entityId: string, state: string, attributes?: Object, lastChanged?: string}} reading
   * @param {Object} ctx
   * @param {import('./EntityCatalogPolicy.mjs').EntityCatalogPolicy} ctx.policy
   * @param {{id: string, name: string, source: string}|null} ctx.room
   * @returns {HomeEntity}
   */
  static fromReading(reading, { policy, room }) {
    const attrs = reading.attributes || {};
    const deviceClass = attrs.device_class || null;
    const kept = {};
    for (const key of KEPT_ATTRIBUTES) if (attrs[key] != null) kept[key] = attrs[key];
    return new HomeEntity({
      id: reading.entityId,
      name: policy.nameFor(reading.entityId) || attrs.friendly_name,
      state: reading.state,
      type: policy.typeOf(reading.entityId, { deviceClass }),
      room,
      unit: attrs.unit_of_measurement || null,
      deviceClass,
      lastChanged: reading.lastChanged || null,
      controllable: policy.isControllable(reading.entityId, { deviceClass }),
      attributes: kept,
    });
  }

  get id() { return this.#p.id; }
  get domain() { return this.#p.domain; }
  get name() { return this.#p.name; }
  get state() { return this.#p.state; }
  get stateClass() { return this.#p.stateClass; }
  get type() { return this.#p.type; }
  get room() { return this.#p.room; }
  get controllable() { return this.#p.controllable; }
  get unit() { return this.#p.unit; }
  get deviceClass() { return this.#p.deviceClass; }
  get lastChanged() { return this.#p.lastChanged; }
  get attributes() { return this.#p.attributes; }
}

export default HomeEntity;
