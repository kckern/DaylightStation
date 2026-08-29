/**
 * CommandHandlerLivenessService — tracks per-device freshness of frontend
 * command handlers (the `useCommandAckPublisher` mount).
 *
 * Two semantic activity signals are observed through the presence gateway:
 *
 *   1. `topic: 'device-ack'` — definitive proof a handler ran in response
 *      to a queue/playback/seek/etc. command.
 *   2. `topic: 'command-handler-presence:<deviceId>'` — periodic heartbeat
 *      from the publisher (mounted/unmount edge events too). `online: false`
 *      immediately marks the device stale (page unmount).
 *
 * Used by WakeAndLoadService (Task 8) to gate the WS-first warm-switch path:
 * a non-zero subscriber count plus a fresh ack/presence (≤30s) means a
 * handler is alive and will ack a new queue command. Subscriber count
 * alone is the canonical "stale subscriber" — the WS connection is alive
 * but useScreenCommands/useCommandAckPublisher aren't mounted.
 *
 * The dispatcher closure is registered exactly once in the constructor;
 * start()/stop() are flag flips and the dispatcher returns early when stopped.
 *
 * @module applications/devices/services
 */

const DEFAULT_FRESHNESS_MS = 30_000;

export class CommandHandlerLivenessService {
  #presenceGateway;
  #logger;
  #clock;
  #freshnessMs;
  #lastSeenAt = new Map();
  #dispatch;
  #started = false;

  constructor(deps = {}) {
    if (typeof deps.presenceGateway?.subscribeHandlerActivity !== 'function') {
      throw new TypeError('CommandHandlerLivenessService requires presenceGateway');
    }
    this.#presenceGateway = deps.presenceGateway;
    this.#logger = deps.logger || console;
    this.#clock = deps.clock || Date;
    this.#freshnessMs = typeof deps.freshnessMs === 'number' && deps.freshnessMs > 0
      ? deps.freshnessMs
      : DEFAULT_FRESHNESS_MS;

    // Register the inbound-message dispatcher once, here.
    // start()/stop() are flag flips; the dispatcher gates itself on #started.
    this.#dispatch = (activity) => this.#handleActivity(activity);
    this.#presenceGateway.subscribeHandlerActivity(this.#dispatch);
  }

  #handleActivity(activity) {
    if (!this.#started) return;
    if (activity?.kind === 'presence') {
      const { deviceId } = activity;
      if (!deviceId) return;
      if (activity.online === false) {
        this.#lastSeenAt.delete(deviceId);
        this.#logger.debug?.('command-handler-liveness.offline', { deviceId });
      } else {
        this.#lastSeenAt.set(deviceId, this.#clock.now());
        this.#logger.debug?.('command-handler-liveness.presence', { deviceId });
      }
      return;
    }

    if (activity?.kind === 'ack') {
      const deviceId = activity.deviceId;
      if (!deviceId) return;
      this.#lastSeenAt.set(deviceId, this.#clock.now());
      this.#logger.debug?.('command-handler-liveness.ack', {
        deviceId, commandId: activity.commandId,
      });
    }
  }

  start() {
    if (this.#started) return;
    this.#started = true;
    this.#logger.info?.('command-handler-liveness.start', { freshnessMs: this.#freshnessMs });
  }

  stop() {
    if (!this.#started) return;
    this.#started = false;
    this.#lastSeenAt.clear();
    this.#logger.info?.('command-handler-liveness.stop');
  }

  isFresh(deviceId, windowMs) {
    const ts = this.#lastSeenAt.get(deviceId);
    if (!ts) return false;
    const limit = typeof windowMs === 'number' && windowMs > 0 ? windowMs : this.#freshnessMs;
    return (this.#clock.now() - ts) <= limit;
  }

  snapshot() {
    return Object.freeze(Object.fromEntries(this.#lastSeenAt));
  }
}

export default CommandHandlerLivenessService;
