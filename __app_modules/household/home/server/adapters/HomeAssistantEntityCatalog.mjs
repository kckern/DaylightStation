/**
 * HomeAssistantEntityCatalog — IHomeEntityCatalog over the home-automation
 * gateway, in the shape of HomeAssistantDeviceAdapter: it owns no HTTP client,
 * only an injected IHomeAutomationGateway.
 *
 * Room data changes when someone reorganises Home Assistant, not on every
 * refresh, so it is cached; entity states are read live every call.
 *
 * @module adapters/HomeAssistantEntityCatalog
 */

import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { IHomeEntityCatalog } from "../application/home-automation/ports/IHomeEntityCatalog.mjs";

const ROOMS_TTL_MS = 5 * 60 * 1000;

export class HomeAssistantEntityCatalog extends IHomeEntityCatalog {
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
      throw new InfrastructureError('HomeAssistantEntityCatalog requires gateway', {
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
    return readings;
  }

  async listRooms() {
    const now = this.#now();
    if (this.#roomsCache && now - this.#roomsCache.at < this.#roomsTtlMs) return this.#roomsCache.value;
    if (typeof this.#gateway.listAreaAssignments !== 'function') {
      return { rooms: [], assignments: {} };
    }
    const { areas = [], assignments = {} } = await this.#gateway.listAreaAssignments();
    const value = { rooms: areas, assignments };
    // An empty answer is a failed render, not a house with no rooms: retry next call.
    if (areas.length) this.#roomsCache = { at: now, value };
    this.#logger.debug?.('home.entities.rooms.loaded', { rooms: areas.length, assigned: Object.keys(assignments).length });
    return value;
  }
}

export default HomeAssistantEntityCatalog;
