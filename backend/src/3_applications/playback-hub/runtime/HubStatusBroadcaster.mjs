/**
 * HubStatusBroadcaster - long-running snapshot publisher.
 *
 * Started at container boot. Polls IPlaybackHubGateway.getStatus() every
 * `intervalMs` (default 3000 — matches the design's 3s tick); publishes the
 * snapshot to the event bus under topic `playback-hub:status` with type
 * `playback-hub.status.snapshot`.
 *
 * Loop semantics (per design):
 *   - SERIAL — never two concurrent gateway calls (no overlap).
 *   - SUBTRACT elapsed from interval (so 3s tick stays a 3s cadence even
 *     when fetches take 200ms).
 *   - On gateway failure: increment `consecutiveFailures`, log warn,
 *     exponential backoff capped at `maxBackoffMs` (default 30000):
 *       backoffMs = min(maxBackoff, interval * 2 ** min(failures, 4))
 *   - On any success: reset `consecutiveFailures` to 0.
 *
 * Lifecycle:
 *   - start() is idempotent; stop() awaits the in-flight iteration so test
 *     teardown is clean.
 *
 * Testability:
 *   - `sleepFn(ms)` is injectable so tests can skip real waits and inspect the
 *     requested cadence directly.
 */

export class HubStatusBroadcaster {
  /** @type {import('../ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway} */ #gateway;
  /** @type {{ publish: Function }} */ #eventPublisher;
  /** @type {object} */ #logger;
  /** @type {number} */ #intervalMs;
  /** @type {number} */ #maxBackoffMs;
  /** @type {(ms:number)=>Promise<void>} */ #sleepFn;

  #running = false;
  #loopPromise = null;
  /** @type {{ devices: object[], fetchedAt: Date }|null} */ #lastSnapshot = null;

  /**
   * @param {{
   *   gateway: import('../ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway,
   *   eventPublisher: { publish: Function },
   *   logger?: object,
   *   intervalMs?: number,
   *   maxBackoffMs?: number,
   *   sleepFn?: (ms:number)=>Promise<void>
   * }} deps
   */
  constructor({
    gateway,
    eventPublisher,
    logger,
    intervalMs = 3000,
    maxBackoffMs = 30000,
    sleepFn
  } = {}) {
    if (!gateway) throw new Error('HubStatusBroadcaster: gateway required');
    if (!eventPublisher || typeof eventPublisher.publish !== 'function') {
      throw new Error('HubStatusBroadcaster: eventPublisher with publish() required');
    }
    this.#gateway = gateway;
    this.#eventPublisher = eventPublisher;
    this.#logger = logger || console;
    this.#intervalMs = intervalMs;
    this.#maxBackoffMs = maxBackoffMs;
    this.#sleepFn = sleepFn || ((ms) => new Promise(r => setTimeout(r, ms)));
  }

  /**
   * Start the loop. Idempotent — no-op if already running.
   */
  start() {
    if (this.#running) return;
    this.#running = true;
    this.#loopPromise = this.#run();
  }

  /**
   * Stop the loop. Awaits the in-flight iteration.
   */
  async stop() {
    this.#running = false;
    if (this.#loopPromise) {
      await this.#loopPromise;
      this.#loopPromise = null;
    }
  }

  /**
   * @returns {{ devices: object[], fetchedAt: Date }|null}
   */
  getLastSnapshot() {
    return this.#lastSnapshot;
  }

  async #run() {
    let consecutiveFailures = 0;
    while (this.#running) {
      const startedAt = Date.now();
      try {
        const devices = await this.#gateway.getStatus();
        this.#lastSnapshot = { devices, fetchedAt: new Date() };
        this.#eventPublisher.publish({
          topic: 'playback-hub:status',
          type: 'playback-hub.status.snapshot',
          data: this.#lastSnapshot
        });
        this.#logger.debug?.('playback-hub.broadcaster.publish', {
          deviceCount: devices.length
        });
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures += 1;
        this.#logger.warn?.('playback-hub.broadcaster.fetch_failed', {
          consecutiveFailures,
          error: err.message
        });
      }
      if (!this.#running) break;
      const elapsed = Date.now() - startedAt;
      const target = consecutiveFailures === 0
        ? this.#intervalMs
        : Math.min(
            this.#maxBackoffMs,
            this.#intervalMs * 2 ** Math.min(consecutiveFailures, 4)
          );
      await this.#sleepFn(Math.max(0, target - elapsed));
    }
  }
}

export default HubStatusBroadcaster;
