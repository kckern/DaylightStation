/**
 * BarcodeScanService - Orchestrates barcode scan → gatekeeper → screen broadcast.
 *
 * Handles two payload types:
 * - **content**: resolve screen/action → gatekeeper → broadcast contentId
 * - **command**: resolve screen → look up command map → broadcast (skip gatekeeper)
 *
 * @module applications/barcode/BarcodeScanService
 */
export class BarcodeScanService {
  #gatekeeper;
  #deviceConfig;
  #broadcastEvent;
  #pipelineConfig;
  #commandResolver;
  #onContentApproved;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('#domains/barcode/BarcodeGatekeeper.mjs').BarcodeGatekeeper} deps.gatekeeper
   * @param {Object} deps.deviceConfig - Scanner device entries keyed by device ID
   * @param {Function} deps.broadcastEvent - (topic, payload) => void
   * @param {Object} deps.pipelineConfig - { default_action, actions }
   * @param {Function} deps.commandResolver - (command, arg) => wsPayload|null
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    this.#gatekeeper = deps.gatekeeper;
    this.#deviceConfig = deps.deviceConfig;
    this.#broadcastEvent = deps.broadcastEvent;
    this.#pipelineConfig = deps.pipelineConfig;
    this.#commandResolver = deps.commandResolver;
    this.#onContentApproved = deps.onContentApproved || null;
    this.#logger = deps.logger || console;
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
      device: payload.device,
    });

    // Turn on displays for the target screen (fire-and-forget)
    if (this.#onContentApproved) {
      this.#onContentApproved(targetScreen).catch(() => {});
    }

    this.#broadcastEvent(targetScreen, {
      action,
      contentId: payload.contentId,
      source: 'barcode',
      device: payload.device,
    });
  }
}
