/**
 * ScreenPresenceService factory — builds the presence→entity map from the device
 * config and wires the service into the event bus. Mirrors bootstrap/deviceLiveness.
 *
 * @module 0_system/bootstrap/screenPresence
 */

import { ScreenPresenceService } from '#apps/devices/services/ScreenPresenceService.mjs';

/** @type {ScreenPresenceService | null} */
let instance = null;

/**
 * @param {Object} config
 * @param {Object} config.eventBus
 * @param {{callService:Function}|null} config.haGateway
 * @param {Object<string,Object>} config.devicesConfig - per-device config map
 * @param {Object} [config.logger]
 * @param {{now:()=>number}} [config.clock]
 * @returns {{ presenceService: ScreenPresenceService|null }}
 */
export function createScreenPresenceService({ eventBus, haGateway, devicesConfig, logger = console, clock } = {}) {
  if (!eventBus) throw new Error('createScreenPresenceService requires eventBus');
  if (instance) {
    logger.warn?.('screen-presence.already_created');
    return { presenceService: instance };
  }

  const presenceByDevice = {};
  for (const [deviceId, cfg] of Object.entries(devicesConfig || {})) {
    if (cfg?.presence?.entity) {
      presenceByDevice[deviceId] = { entity: cfg.presence.entity, ttlMs: cfg.presence.ttlMs };
    }
  }

  if (!haGateway) {
    logger.warn?.('screen-presence.skipped_no_ha_gateway');
    return { presenceService: null };
  }
  if (Object.keys(presenceByDevice).length === 0) {
    logger.info?.('screen-presence.skipped_no_config');
    return { presenceService: null };
  }

  const presenceService = new ScreenPresenceService({ haGateway, presenceByDevice, logger, clock });
  presenceService.start(eventBus);
  instance = presenceService;
  return { presenceService };
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  if (instance) { try { instance.stop(); } catch { /* ignore */ } }
  instance = null;
}
