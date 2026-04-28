/**
 * CommandHandlerLivenessService — tracks per-device freshness of frontend
 * command handlers (the `useCommandAckPublisher` mount).
 *
 * Two ingest signals, both observed on the inbound-client-message stream
 * via eventBus.onClientMessage (NOT the internal pubsub — inbound acks
 * and presence beacons are not auto-republished to it):
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
 * @module applications/devices/services
 */

const DEFAULT_FRESHNESS_MS = 30_000;
const PRESENCE_TOPIC_PREFIX = 'command-handler-presence:';

export class CommandHandlerLivenessService {
  #eventBus;
  #logger;
  #clock;
  #freshnessMs;
  #lastSeenAt = new Map();
  #handler = null;
  #started = false;

  constructor(deps = {}) {
    if (!deps.eventBus) {
      throw new TypeError('CommandHandlerLivenessService requires eventBus');
    }
    if (typeof deps.eventBus.onClientMessage !== 'function') {
      throw new TypeError('CommandHandlerLivenessService requires eventBus.onClientMessage');
    }
    this.#eventBus = deps.eventBus;
    this.#logger = deps.logger || console;
    this.#clock = deps.clock || Date;
    this.#freshnessMs = typeof deps.freshnessMs === 'number' && deps.freshnessMs > 0
      ? deps.freshnessMs
      : DEFAULT_FRESHNESS_MS;
  }

  start() {
    if (this.#started) return;
    this.#started = true;

    this.#handler = (_clientId, message) => {
      if (!this.#started) return;
      const topic = message?.topic;
      if (typeof topic !== 'string') return;

      // Path 1: command-handler-presence:<deviceId>
      if (topic.startsWith(PRESENCE_TOPIC_PREFIX)) {
        const deviceId = message?.deviceId || topic.slice(PRESENCE_TOPIC_PREFIX.length);
        if (!deviceId) return;
        if (message?.online === false) {
          this.#lastSeenAt.delete(deviceId);
          this.#logger.debug?.('command-handler-liveness.offline', { deviceId });
        } else {
          this.#lastSeenAt.set(deviceId, this.#clock.now());
          this.#logger.debug?.('command-handler-liveness.presence', { deviceId });
        }
        return;
      }

      // Path 2: device-ack
      if (topic === 'device-ack') {
        const deviceId = message?.deviceId;
        if (!deviceId) return;
        this.#lastSeenAt.set(deviceId, this.#clock.now());
        this.#logger.debug?.('command-handler-liveness.ack', {
          deviceId, commandId: message?.commandId,
        });
      }
    };

    this.#eventBus.onClientMessage(this.#handler);
    this.#logger.info?.('command-handler-liveness.start', { freshnessMs: this.#freshnessMs });
  }

  stop() {
    if (!this.#started) return;
    this.#started = false;
    // WebSocketEventBus.onClientMessage doesn't expose unsubscribe.
    // Setting #started=false makes #handler a no-op; the array slot is
    // a small, fixed leak acceptable for the lifetime of the process.
    this.#handler = null;
    this.#lastSeenAt.clear();
    this.#logger.info?.('command-handler-liveness.stop');
  }

  isFresh(deviceId, windowMs) {
    const ts = this.#lastSeenAt.get(deviceId);
    if (!ts) return false;
    const limit = typeof windowMs === 'number' && windowMs > 0 ? windowMs : this.#freshnessMs;
    return (this.#clock.now() - ts) < limit;
  }

  snapshot() {
    return Object.freeze(Object.fromEntries(this.#lastSeenAt));
  }
}

export default CommandHandlerLivenessService;
