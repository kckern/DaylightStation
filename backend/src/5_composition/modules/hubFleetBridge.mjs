/**
 * HubFleetBridge factory — wires the playback-hub → Fleet projection into the
 * event bus and holds the app-scoped singleton.
 *
 * Mirrors the deviceLiveness.mjs module pattern: create-once factory with a
 * warn-and-return on double creation, plus getter/stopper for tests and
 * shutdown.
 *
 * Wiring (app.mjs): call right after `createDeviceLivenessService` so the
 * liveness service is already observing `device-state:*` when the bridge
 * starts publishing speaker lanes:
 *
 *   const { hubFleetBridge } = createHubFleetBridge({
 *     eventBus,
 *     logger: rootLogger.child({ module: 'hub-fleet-bridge' })
 *   });
 *
 * @module 5_composition/modules/hubFleetBridge
 */

import { HubFleetBridge } from '#apps/playback-hub/runtime/HubFleetBridge.mjs';

/** @type {HubFleetBridge | null} */
let instance = null;

/**
 * Create and start the HubFleetBridge singleton.
 *
 * @param {Object} config
 * @param {Object} config.eventBus - WebSocketEventBus instance
 * @param {Object} [config.logger]
 * @param {number} [config.heartbeatMs=10000]
 * @param {Object} [config.clock] - { now(): number } (defaults to Date)
 * @returns {{ hubFleetBridge: HubFleetBridge }}
 */
export function createHubFleetBridge(config) {
  const { eventBus, logger = console, heartbeatMs, clock } = config || {};

  if (!eventBus) {
    throw new Error('createHubFleetBridge requires eventBus');
  }

  if (instance) {
    logger.warn?.('hub-fleet-bridge.already_created');
    return { hubFleetBridge: instance };
  }

  const hubFleetBridge = new HubFleetBridge({
    eventBus,
    logger,
    heartbeatMs,
    clock,
  });

  hubFleetBridge.start();

  instance = hubFleetBridge;
  return { hubFleetBridge };
}

/**
 * Get the HubFleetBridge singleton (null if not yet created).
 * @returns {HubFleetBridge | null}
 */
export function getHubFleetBridge() {
  return instance;
}

/**
 * Stop and tear down the HubFleetBridge. Safe to call during shutdown or
 * test cleanup.
 */
export function stopHubFleetBridge() {
  if (instance) {
    try {
      instance.stop();
    } catch {
      // swallow — shutdown is best-effort
    }
    instance = null;
  }
}
