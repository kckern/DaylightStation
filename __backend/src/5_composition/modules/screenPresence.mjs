/**
 * ScreenPresenceService factory — builds the presence→entity map from the device
 * config and wires the service into the event bus. Mirrors bootstrap/deviceLiveness.
 *
 * @module 5_composition/modules/screenPresence
 */

import { ScreenPresenceService } from '#apps/devices/services/ScreenPresenceService.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { ConfigScreenPresenceProjection } from '#adapters/devices/ConfigScreenPresenceProjection.mjs';

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
export function createScreenPresenceService({ presenceGateway, haGateway, devicesConfig, logger = console, clock } = {}) {
  if (!presenceGateway) throw new Error('createScreenPresenceService requires presenceGateway');
  if (instance) {
    logger.warn?.('screen-presence.already_created');
    return { presenceService: instance };
  }

  const presenceByDevice = new ConfigScreenPresenceProjection({ devicesConfig }).read();

  if (!haGateway) {
    logger.warn?.('screen-presence.skipped_no_ha_gateway');
    return { presenceService: null };
  }
  if (Object.keys(presenceByDevice).length === 0) {
    logger.info?.('screen-presence.skipped_no_config');
    return { presenceService: null };
  }

  const presenceService = new ScreenPresenceService({
    haGateway, presenceByDevice, presenceGateway,
    scheduler: new NodeApplicationScheduler(), logger, clock,
  });
  presenceService.start();
  instance = presenceService;
  return { presenceService };
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  if (instance) { try { instance.stop(); } catch { /* ignore */ } }
  instance = null;
}
