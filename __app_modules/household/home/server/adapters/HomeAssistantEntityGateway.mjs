/**
 * HomeAssistantEntityGateway — IHomeEntityGateway over the home-automation
 * gateway, in the shape of HomeAssistantDeviceAdapter: it owns no HTTP client,
 * only an injected IHomeAutomationGateway.
 *
 * The anti-corruption layer for entity reads: Home Assistant's attribute bag
 * (friendly_name, unit_of_measurement, brightness 0-255…) is translated here,
 * so the domain sees EntityReading and nothing else.
 *
 * Room data changes when someone reorganises Home Assistant, not on every
 * refresh, so it is cached; entity states are read live every call.
 *
 * @module adapters/HomeAssistantEntityGateway
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { IHomeEntityGateway } from "../application/home-automation/ports/IHomeEntityGateway.mjs";

const ROOMS_TTL_MS = 5 * 60 * 1000;
// A failed area lookup is retried this much later, not on every 10 s poll.
const ROOMS_RETRY_MS = 60 * 1000;

const finite = (v) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : undefined);

/**
 * @param {{entityId: string, state: string, attributes?: Object, lastChanged?: string}} raw
 * @returns {import('../application/home-automation/ports/IHomeEntityGateway.mjs').EntityReading}
 */
export function toEntityReading(raw) {
  const a = raw.attributes || {};
  const detail = {};
  const brightness = finite(a.brightness);
  if (brightness !== undefined) detail.brightnessPct = Math.round((brightness / 255) * 100);
  if (finite(a.current_temperature) !== undefined) detail.currentTemperature = finite(a.current_temperature);
  if (finite(a.temperature) !== undefined) detail.targetTemperature = finite(a.temperature);
  if (typeof a.hvac_action === 'string') detail.hvacAction = a.hvac_action;
  if (typeof a.media_title === 'string' && a.media_title) detail.mediaTitle = a.media_title;
  if (finite(a.percentage) !== undefined) detail.speedPct = finite(a.percentage);
  return {
    entityId: raw.entityId,
    state: raw.state ?? null,
    name: typeof a.friendly_name === 'string' && a.friendly_name ? a.friendly_name : null,
    deviceClass: typeof a.device_class === 'string' ? a.device_class : null,
    unit: typeof a.unit_of_measurement === 'string' && a.unit_of_measurement ? a.unit_of_measurement : null,
    lastChanged: raw.lastChanged || null,
    detail,
  };
}

export class HomeAssistantEntityGateway extends IHomeEntityGateway {
  #gateway;
  #logger;
  #now;
  #roomsTtlMs;
  #roomsCache = null;

  /**
   * @param {Object} [config]
   * @param {number} [config.roomsTtlMs]
   * @param {Object} deps
   * @param {Object} deps.gateway - IHomeAutomationGateway
   * @param {Object} [deps.logger]
   * @param {Function} [deps.now] - clock, for tests
   */
  constructor(config = {}, deps = {}) {
    super();
    if (!deps.gateway) {
      throw new InfrastructureError('HomeAssistantEntityGateway requires gateway', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'gateway',
      });
    }
    this.#gateway = deps.gateway;
    this.#logger = deps.logger || console;
    this.#now = deps.now || Date.now;
    this.#roomsTtlMs = config.roomsTtlMs ?? ROOMS_TTL_MS;
  }

  async listReadings() {
    const readings = await this.#gateway.listAllStates();
    // The gateway swallows transport errors into []. No real house has zero
    // entities, so empty means unreachable — say so instead of rendering an
    // empty dashboard that looks like a working one.
    if (!Array.isArray(readings) || readings.length === 0) {
      throw new InfrastructureError('Home Assistant returned no entities', {
        code: 'HOME_PLATFORM_UNREACHABLE',
      });
    }
    return readings.map(toEntityReading);
  }

  async listRooms() {
    const now = this.#now();
    if (this.#roomsCache && now < this.#roomsCache.until) return this.#roomsCache.value;
    if (typeof this.#gateway.listAreaAssignments !== 'function') {
      return { rooms: [], assignments: {} };
    }
    const { areas = [], assignments = {} } = await this.#gateway.listAreaAssignments();
    const value = { rooms: areas, assignments };
    // An empty answer is a failed render, not a house with no rooms: keep it
    // only briefly so a broken template is retried, but not on every poll.
    this.#roomsCache = { until: now + (areas.length ? this.#roomsTtlMs : ROOMS_RETRY_MS), value };
    this.#logger.debug?.('home.entities.rooms.loaded', { rooms: areas.length, assigned: Object.keys(assignments).length });
    return value;
  }
}

export default HomeAssistantEntityGateway;
