/**
 * ContentDispatcher — optimistic content posture: broadcast to the (likely-on)
 * screen, wait briefly for a content-ack, and fall back to the full wake-and-load
 * cycle only if the screen doesn't acknowledge. Ported from BarcodeScanService.
 *
 * Layer: APPLICATION (3_applications/trigger).
 * @module applications/trigger/ContentDispatcher
 */
const ACK_TIMEOUT_MS = 2000;

export class ContentDispatcher {
  #screenBroadcast; #waitForAck; #loadFallback; #onContentApproved; #logger;

  constructor({ screenBroadcast, waitForAck = null, loadFallback = null, onContentApproved = null, logger = console } = {}) {
    this.#screenBroadcast = screenBroadcast;
    this.#waitForAck = waitForAck;
    this.#loadFallback = loadFallback;
    this.#onContentApproved = onContentApproved;
    this.#logger = logger;
  }

  async optimistic(target, query, _loadOptions = {}) {
    if (this.#onContentApproved) {
      Promise.resolve(this.#onContentApproved(target)).catch(() => {});
    }
    this.#screenBroadcast?.(target, { ...query, source: 'trigger', targetScreen: target });

    if (!this.#loadFallback) return;

    if (this.#waitForAck) {
      try {
        await this.#waitForAck((msg) => msg.type === 'content-ack' && msg.screen === target, ACK_TIMEOUT_MS);
        this.#logger.info?.('trigger.content.ack', { target });
      } catch {
        this.#logger.info?.('trigger.content.ack_timeout', { target, timeoutMs: ACK_TIMEOUT_MS });
        // Fire-and-forget: wake-and-load takes 60-80s; do NOT block the trigger
        // ingress on it (parity with BarcodeScanService.#handleContent).
        this.#tryFallback(target, query);
      }
    } else {
      this.#logger.info?.('trigger.content.no_ack_channel', { target });
      // Fire-and-forget (see above).
      this.#tryFallback(target, query);
    }
  }

  async #tryFallback(target, query) {
    try {
      await this.#loadFallback(target, query);
    } catch (err) {
      this.#logger.warn?.('trigger.content.fallback_failed', { target, error: err.message });
    }
  }
}

export default ContentDispatcher;
