/**
 * BarcodeScanService - Orchestrates barcode scan → gatekeeper → screen broadcast.
 *
 * Receives parsed BarcodePayloads, resolves target screen and action from
 * device config and pipeline config, runs the gatekeeper, and broadcasts
 * approved scans to the target screen via WebSocket.
 *
 * @module applications/barcode/BarcodeScanService
 */
export class BarcodeScanService {
  #gatekeeper;
  #deviceConfig;
  #broadcastEvent;
  #pipelineConfig;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('#domains/barcode/BarcodeGatekeeper.mjs').BarcodeGatekeeper} deps.gatekeeper
   * @param {Object} deps.deviceConfig - Scanner device entries keyed by device ID
   * @param {Function} deps.broadcastEvent - (topic, payload) => void
   * @param {Object} deps.pipelineConfig - { default_action, actions }
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    this.#gatekeeper = deps.gatekeeper;
    this.#deviceConfig = deps.deviceConfig;
    this.#broadcastEvent = deps.broadcastEvent;
    this.#pipelineConfig = deps.pipelineConfig;
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
    const action = payload.action || this.#pipelineConfig.default_action;
    const policyGroup = scannerConfig.policy_group || 'default';

    const scanContext = {
      contentId: payload.contentId,
      targetScreen,
      action,
      device,
      timestamp: payload.timestamp,
      policyGroup,
    };

    const result = await this.#gatekeeper.evaluate(scanContext);

    if (!result.approved) {
      this.#logger.info?.('barcode.denied', {
        contentId: payload.contentId,
        device,
        reason: result.reason,
      });
      return;
    }

    this.#logger.info?.('barcode.approved', {
      contentId: payload.contentId,
      targetScreen,
      action,
      device,
    });

    this.#broadcastEvent(targetScreen, {
      action,
      contentId: payload.contentId,
      source: 'barcode',
      device,
    });
  }
}
