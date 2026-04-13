/**
 * BarcodeScanService - Orchestrates barcode scan → gatekeeper → screen broadcast.
 *
 * Handles two payload types:
 * - **content**: resolve screen/action → gatekeeper → broadcast contentId
 *   → wait for screen ack → fall back to direct device load if no ack
 * - **command**: resolve screen → look up command map → broadcast (skip gatekeeper)
 *
 * @module applications/barcode/BarcodeScanService
 */

const ACK_TIMEOUT_MS = 2000;

export class BarcodeScanService {
  #gatekeeper;
  #deviceConfig;
  #broadcastEvent;
  #pipelineConfig;
  #commandResolver;
  #onContentApproved;
  #loadFallback;
  #waitForAck;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('#domains/barcode/BarcodeGatekeeper.mjs').BarcodeGatekeeper} deps.gatekeeper
   * @param {Object} deps.deviceConfig - Scanner device entries keyed by device ID
   * @param {Function} deps.broadcastEvent - (topic, payload) => void
   * @param {Object} deps.pipelineConfig - { default_action, actions }
   * @param {Function} deps.commandResolver - (command, arg) => wsPayload|null
   * @param {Function} [deps.waitForAck] - (predicate, timeoutMs) => Promise - waits for a client message
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    this.#gatekeeper = deps.gatekeeper;
    this.#deviceConfig = deps.deviceConfig;
    this.#broadcastEvent = deps.broadcastEvent;
    this.#pipelineConfig = deps.pipelineConfig;
    this.#commandResolver = deps.commandResolver;
    this.#onContentApproved = deps.onContentApproved || null;
    this.#waitForAck = deps.waitForAck || null;
    this.#loadFallback = null;
    this.#logger = deps.logger || console;
  }

  /**
   * Set a fallback loader for when the screen doesn't acknowledge
   * the WS broadcast (TV off / FKB not running / stale connection).
   * Called with (targetScreen, query).
   */
  setLoadFallback(fn) {
    this.#loadFallback = fn;
  }

  /**
   * Handle a parsed barcode scan.
   * @param {import('#domains/barcode/BarcodePayload.mjs').BarcodePayload} payload
   */
  async handle(payload) {
    const device = payload.device;
    const scannerConfig = this.#deviceConfig[device];

    if (!scannerConfig) {
      this.#logger.warn?.('barcode.unknownDevice', { device });
      return;
    }

    const targetScreen = payload.targetScreen || scannerConfig.target_screen;

    if (payload.type === 'command') {
      return this.#handleCommand(payload, targetScreen);
    }

    return this.#handleContent(payload, targetScreen, scannerConfig);
  }

  #handleCommand(payload, targetScreen) {
    const wsPayload = this.#commandResolver(payload.command, payload.commandArg);

    if (!wsPayload) {
      this.#logger.warn?.('barcode.unknownCommand', {
        command: payload.command,
        device: payload.device,
      });
      return;
    }

    this.#logger.info?.('barcode.command', {
      command: payload.command,
      commandArg: payload.commandArg,
      targetScreen,
      device: payload.device,
    });

    this.#broadcastEvent(targetScreen, {
      ...wsPayload,
      source: 'barcode',
      device: payload.device,
      targetScreen,
    });
  }

  async #handleContent(payload, targetScreen, scannerConfig) {
    const action = payload.action || this.#pipelineConfig.default_action;
    const policyGroup = scannerConfig.policy_group || 'default';

    const scanContext = {
      contentId: payload.contentId,
      targetScreen,
      action,
      device: payload.device,
      timestamp: payload.timestamp,
      policyGroup,
    };

    const result = await this.#gatekeeper.evaluate(scanContext);

    if (!result.approved) {
      this.#logger.info?.('barcode.denied', {
        contentId: payload.contentId,
        device: payload.device,
        reason: result.reason,
      });
      return;
    }

    this.#logger.info?.('barcode.approved', {
      contentId: payload.contentId,
      targetScreen,
      action,
      options: payload.options,
      device: payload.device,
    });

    // Turn on displays for the target screen (fire-and-forget)
    if (this.#onContentApproved) {
      this.#onContentApproved(targetScreen).catch(() => {});
    }

    // Broadcast content via WS to the target screen
    this.#broadcastEvent(targetScreen, {
      action,
      contentId: payload.contentId,
      ...(payload.options || {}),
      source: 'barcode',
      device: payload.device,
      targetScreen,
    });

    // Wait for the screen to acknowledge it's handling the content.
    // If no ack arrives within the timeout, the screen isn't active —
    // fall back to the full wake-and-load cycle (FKB loadURL).
    if (this.#loadFallback) {
      const query = { [action]: payload.contentId, ...(payload.options || {}) };

      if (this.#waitForAck) {
        try {
          await this.#waitForAck(
            (msg) => msg.type === 'content-ack' && msg.screen === targetScreen,
            ACK_TIMEOUT_MS
          );
          this.#logger.info?.('barcode.ack.received', { targetScreen });
        } catch {
          this.#logger.info?.('barcode.ack.timeout', { targetScreen, timeoutMs: ACK_TIMEOUT_MS });
          this.#loadFallback(targetScreen, query).catch(err => {
            this.#logger.warn?.('barcode.loadFallback.failed', { targetScreen, error: err.message });
          });
        }
      } else {
        // No ack mechanism available — trigger fallback immediately
        this.#logger.info?.('barcode.loadFallback.noAck', { targetScreen });
        this.#loadFallback(targetScreen, query).catch(err => {
          this.#logger.warn?.('barcode.loadFallback.failed', { targetScreen, error: err.message });
        });
      }
    }
  }
}
