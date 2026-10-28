/**
 * EntityCatalogPolicy — which home entities the dashboard shows, what type each
 * one is, and which ones a person may switch from it.
 *
 * A value object built from the household's `entities:` dashboard config, with
 * every key optional: an absent file means the defaults below. Provider
 * vocabulary (domains, device classes) is the shared language of every home
 * platform this app speaks to, so it lives here rather than in the adapter.
 *
 * @module home-automation/EntityCatalogPolicy
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/** Dashboard entity types, in display order. */
export const ENTITY_TYPES = Object.freeze([
  Object.freeze({ id: 'light', label: 'Lights' }),
  Object.freeze({ id: 'power', label: 'Power' }),
  Object.freeze({ id: 'climate', label: 'Climate' }),
  Object.freeze({ id: 'presence', label: 'Motion & presence' }),
  Object.freeze({ id: 'openings', label: 'Doors & windows' }),
  Object.freeze({ id: 'media', label: 'Media' }),
  Object.freeze({ id: 'battery', label: 'Batteries' }),
  Object.freeze({ id: 'switch', label: 'Switches' }),
  Object.freeze({ id: 'sensor', label: 'Sensors' }),
  Object.freeze({ id: 'other', label: 'Other' }),
]);

const DEFAULTS = Object.freeze({
  domains: ['light', 'switch', 'fan', 'cover', 'climate', 'media_player', 'sensor',
    'binary_sensor', 'input_boolean', 'lock', 'vacuum', 'siren', 'humidifier', 'water_heater'],
  // A sensor is shown when its device class is one a person reads; voltage,
  // frequency, signal strength and the like are diagnostics.
  sensorDeviceClasses: ['temperature', 'humidity', 'illuminance', 'power', 'energy', 'battery',
    'carbon_dioxide', 'pm25', 'pm10', 'pressure', 'gas', 'moisture', 'aqi', 'volatile_organic_compounds'],
  binarySensorDeviceClasses: ['motion', 'occupancy', 'presence', 'door', 'window', 'opening',
    'garage_door', 'moisture', 'smoke', 'gas', 'problem', 'safety', 'lock', 'plug', 'power', 'running'],
  exclude: ['*_led_state', '*permit_join*', '*_linkquality', '*_rssi', '*_signal_strength', '*_do_not_disturb'],
  include: [],
  // Only lights by default. A plug can be feeding a TV, a set-top box or a
  // speaker someone is using; the household opts those in by type or by id.
  controllableTypes: ['light'],
  controllable: [],
  inferRooms: true,
  // First match wins; household rules are tried before these.
  typeRules: [
    { type: 'light', domains: ['light'] },
    { type: 'light', domains: ['switch'], match: ['*light*', '*lamp*', '*sconce*', '*chandelier*'] },
    { type: 'power', domains: ['switch'], match: ['*plug*', '*outlet*', '*socket*'] },
    { type: 'power', domains: ['sensor'], deviceClasses: ['power', 'energy', 'current', 'voltage', 'apparent_power'] },
    { type: 'battery', domains: ['sensor'], deviceClasses: ['battery'] },
    { type: 'climate', domains: ['climate', 'fan', 'humidifier', 'water_heater'] },
    { type: 'climate', domains: ['sensor'],
      deviceClasses: ['temperature', 'humidity', 'pressure', 'carbon_dioxide', 'pm25', 'pm10', 'aqi', 'volatile_organic_compounds'] },
    { type: 'presence', domains: ['binary_sensor'], deviceClasses: ['motion', 'occupancy', 'presence'] },
    { type: 'openings', domains: ['cover', 'lock'] },
    { type: 'openings', domains: ['binary_sensor'], deviceClasses: ['door', 'window', 'opening', 'garage_door', 'lock'] },
    { type: 'media', domains: ['media_player'] },
    { type: 'switch', domains: ['switch', 'input_boolean'] },
    { type: 'sensor', domains: ['sensor', 'binary_sensor'] },
  ],
});

// Domains whose turn_on / turn_off / toggle services mean what a switch means.
const SWITCHABLE_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean', 'siren', 'humidifier']);

const globCache = new Map();
function globToRegExp(glob) {
  if (!globCache.has(glob)) {
    const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    globCache.set(glob, new RegExp(`^${escaped}$`));
  }
  return globCache.get(glob);
}

/** Matches the whole entity id, or the part after the domain ("*_plug" hits "switch.tv_plug"). */
function matchesAny(entityId, globs) {
  const objectId = entityId.slice(entityId.indexOf('.') + 1);
  return globs.some((g) => globToRegExp(g).test(entityId) || globToRegExp(g).test(objectId));
}

function stringList(value, key) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ValidationError(`dashboard entities.${key} must be a list of strings`, { code: 'INVALID_ENTITY_POLICY', field: key, value });
  }
  return value;
}

function stringMap(value, key) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`dashboard entities.${key} must be a map`, { code: 'INVALID_ENTITY_POLICY', field: key, value });
  }
  return { ...value };
}

function normalizeRule(rule, index) {
  if (!rule || typeof rule.type !== 'string') {
    throw new ValidationError(`dashboard entities.types[${index}] needs a type`, { code: 'INVALID_ENTITY_POLICY', field: 'types', value: rule });
  }
  return Object.freeze({
    type: rule.type,
    domains: stringList(rule.domains, `types[${index}].domains`),
    deviceClasses: stringList(rule.device_classes ?? rule.deviceClasses, `types[${index}].device_classes`),
    match: stringList(rule.match, `types[${index}].match`),
  });
}

export class EntityCatalogPolicy {
  #p;

  constructor(props) {
    this.#p = Object.freeze(props);
    Object.freeze(this);
  }

  /**
   * Build from the `entities:` section of the household dashboard config.
   * @param {Object} [raw] - YAML object (snake_case keys); absent keys take defaults
   * @returns {EntityCatalogPolicy}
   */
  static fromConfig(raw = {}) {
    const cfg = raw || {};
    const householdRules = Array.isArray(cfg.types) ? cfg.types.map(normalizeRule) : [];
    return new EntityCatalogPolicy({
      domains: stringList(cfg.domains, 'domains') ?? DEFAULTS.domains,
      sensorDeviceClasses: stringList(cfg.sensor_device_classes, 'sensor_device_classes') ?? DEFAULTS.sensorDeviceClasses,
      binarySensorDeviceClasses: stringList(cfg.binary_sensor_device_classes, 'binary_sensor_device_classes') ?? DEFAULTS.binarySensorDeviceClasses,
      exclude: [...DEFAULTS.exclude, ...(stringList(cfg.exclude, 'exclude') ?? [])],
      include: stringList(cfg.include, 'include') ?? DEFAULTS.include,
      controllableTypes: stringList(cfg.controllable_types, 'controllable_types') ?? DEFAULTS.controllableTypes,
      controllable: stringList(cfg.controllable, 'controllable') ?? DEFAULTS.controllable,
      inferRooms: cfg.infer_rooms ?? DEFAULTS.inferRooms,
      roomAliases: stringMap(cfg.room_aliases, 'room_aliases'),
      roomOverrides: stringMap(cfg.rooms, 'rooms'),
      names: stringMap(cfg.names, 'names'),
      typeRules: [...householdRules, ...DEFAULTS.typeRules.map(normalizeRule)],
      haUrl: typeof cfg.ha_url === 'string' && cfg.ha_url ? cfg.ha_url.replace(/\/$/, '') : null,
    });
  }

  get haUrl() { return this.#p.haUrl; }
  get inferRooms() { return this.#p.inferRooms !== false; }
  get roomAliases() { return this.#p.roomAliases; }
  get roomOverrides() { return this.#p.roomOverrides; }

  /** Types a household rule introduced are listed after the built-ins. */
  get types() {
    const known = new Set(ENTITY_TYPES.map((t) => t.id));
    const added = [...new Set(this.#p.typeRules.map((r) => r.type))].filter((id) => !known.has(id))
      .map((id) => Object.freeze({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }));
    return [...ENTITY_TYPES, ...added];
  }

  /**
   * Whether the dashboard shows this entity.
   * @param {string} entityId
   * @param {Object} [opts]
   * @param {string|null} [opts.deviceClass]
   * @param {boolean} [opts.hasRoom] - the provider placed it in a room
   */
  admits(entityId, { deviceClass = null, hasRoom = false } = {}) {
    if (this.#p.include.includes(entityId)) return true;
    if (matchesAny(entityId, this.#p.exclude)) return false;
    const domain = entityId.split('.')[0];
    if (!this.#p.domains.includes(domain)) return false;
    if (domain === 'sensor') return this.#classAdmitted(deviceClass, this.#p.sensorDeviceClasses, hasRoom);
    if (domain === 'binary_sensor') return this.#classAdmitted(deviceClass, this.#p.binarySensorDeviceClasses, hasRoom);
    return true;
  }

  // An unclassed sensor someone bothered to put in a room is worth showing.
  #classAdmitted(deviceClass, allowed, hasRoom) {
    return deviceClass ? allowed.includes(deviceClass) : hasRoom;
  }

  /** @returns {string} an entity type id */
  typeOf(entityId, { deviceClass = null } = {}) {
    const domain = entityId.split('.')[0];
    for (const rule of this.#p.typeRules) {
      if (rule.domains && !rule.domains.includes(domain)) continue;
      if (rule.deviceClasses && !rule.deviceClasses.includes(deviceClass)) continue;
      if (rule.match && !matchesAny(entityId, rule.match)) continue;
      return rule.type;
    }
    return 'other';
  }

  /**
   * Whether a person may switch this entity from the dashboard. Decided from the
   * id alone (no live state); only on/off domains ever qualify.
   */
  isControllable(entityId, { deviceClass = null } = {}) {
    const domain = entityId.split('.')[0];
    if (!SWITCHABLE_DOMAINS.has(domain)) return false;
    if (this.#p.controllable.includes(entityId)) return true;
    if (matchesAny(entityId, this.#p.exclude)) return false;
    if (!this.#p.domains.includes(domain) && !this.#p.include.includes(entityId)) return false;
    return this.#p.controllableTypes.includes(this.typeOf(entityId, { deviceClass }));
  }

  /** @returns {string|null} the household's name for the entity, if it set one */
  nameFor(entityId) {
    const name = this.#p.names[entityId];
    return typeof name === 'string' && name ? name : null;
  }
}

export default EntityCatalogPolicy;
