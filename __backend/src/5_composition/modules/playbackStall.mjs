/**
 * PlaybackStallDetector factory — holds the app-scoped singleton and starts it.
 *
 * Mirrors `deviceLiveness.mjs`: the detector rides the same `device-state:*`
 * pattern subscription, so wiring it is a matter of construct-and-start. It is
 * created later than liveness because its `onStall` handler needs the
 * notification stack, which is composed further down the startup sequence.
 *
 * @module 5_composition/modules/playbackStall
 */

import { PlaybackStallDetector } from '#apps/devices/services/PlaybackStallDetector.mjs';

/** @type {PlaybackStallDetector | null} */
let instance = null;

/**
 * Create and start the PlaybackStallDetector.
 *
 * @param {Object} config
 * @param {Object} config.eventBus - WebSocketEventBus instance
 * @param {Object} [config.logger]
 * @param {Object} [config.clock] - { now(): number }
 * @param {number} [config.stallThresholdMs]
 * @param {Function} [config.onStall]
 * @param {Function} [config.onRecover]
 * @returns {{ stallDetector: PlaybackStallDetector }}
 */
export function createPlaybackStallDetector(config) {
  const { presenceGateway, logger = console, clock, stallThresholdMs, onStall, onRecover } = config || {};

  if (!presenceGateway) {
    throw new Error('createPlaybackStallDetector requires presenceGateway');
  }

  if (instance) {
    logger.warn?.('playback-stall.already_created');
    return { stallDetector: instance };
  }

  const stallDetector = new PlaybackStallDetector({
    presenceGateway,
    logger,
    clock,
    stallThresholdMs,
    onStall,
    onRecover,
  });

  stallDetector.start();

  instance = stallDetector;
  return { stallDetector };
}

/**
 * Get the PlaybackStallDetector singleton (null if not yet created).
 * @returns {PlaybackStallDetector | null}
 */
export function getPlaybackStallDetector() {
  return instance;
}

/** Stop and tear down the detector. Safe during shutdown or test cleanup. */
export function stopPlaybackStallDetector() {
  if (instance) {
    try {
      instance.stop();
    } catch {
      // swallow — shutdown is best-effort
    }
    instance = null;
  }
}
