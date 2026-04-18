/**
 * DeviceLivenessService factory — wires the service into the event bus and
 * holds the app-scoped singleton.
 *
 * Extracted from bootstrap.mjs so unit tests can exercise the wiring logic
 * without pulling in the entire backend composition root.
 *
 * @module 0_system/bootstrap/deviceLiveness
 */

import { DeviceLivenessService } from '#apps/devices/services/DeviceLivenessService.mjs';

/** @type {DeviceLivenessService | null} */
let instance = null;

/**
 * Create and start the DeviceLivenessService, wire it into the event bus.
 *
 * @param {Object} config
 * @param {Object} config.eventBus - WebSocketEventBus instance
 * @param {Object} [config.logger]
 * @param {Object} [config.clock] - { now(): number } (defaults to Date)
 * @param {number} [config.offlineTimeoutMs=15000]
 * @returns {{ livenessService: DeviceLivenessService }}
 */
export function createDeviceLivenessService(config) {
  const { eventBus, logger = console, clock, offlineTimeoutMs } = config || {};

  if (!eventBus) {
    throw new Error('createDeviceLivenessService requires eventBus');
  }

  if (instance) {
    logger.warn?.('device-liveness.already_created');
    return { livenessService: instance };
  }

  const livenessService = new DeviceLivenessService({
    eventBus,
    logger,
    clock,
    offlineTimeoutMs,
  });

  livenessService.start();

  // Wire into the event bus for replay-on-subscribe (Task 2.3).
  if (typeof eventBus.setLivenessService === 'function') {
    eventBus.setLivenessService(livenessService);
  } else {
    logger.warn?.('device-liveness.bus_missing_setter', {
      note: 'eventBus.setLivenessService not available — replay disabled',
    });
  }

  instance = livenessService;
  return { livenessService };
}

/**
 * Get the DeviceLivenessService singleton (null if not yet created).
 * @returns {DeviceLivenessService | null}
 */
export function getDeviceLivenessService() {
  return instance;
}

/**
 * Stop and tear down the DeviceLivenessService. Safe to call during
 * shutdown or before a test cleanup.
 */
export function stopDeviceLivenessService() {
  if (instance) {
    try {
      instance.stop();
    } catch {
      // swallow — shutdown is best-effort
    }
    instance = null;
  }
}
