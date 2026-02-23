/**
 * WakeAndLoadService — orchestrates the full device wake + content load workflow.
 *
 * Replaces inline orchestration from the device router. Emits WebSocket progress
 * events at each step so the phone UI can show real-time feedback.
 *
 * Steps: power_on -> verify_display -> prepare_content -> load_content
 *
 * @module applications/devices/services
 */

const STEPS = ['power', 'verify', 'prepare', 'load'];

export class WakeAndLoadService {
  #deviceService;
  #readinessPolicy;
  #broadcast;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.deviceService - DeviceService for device lookup
   * @param {Object} deps.readinessPolicy - DisplayReadinessPolicy instance
   * @param {Function} deps.broadcast - broadcastEvent(payload) function
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    this.#deviceService = deps.deviceService;
    this.#readinessPolicy = deps.readinessPolicy;
    this.#broadcast = deps.broadcast;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the full wake-and-load workflow.
   *
   * @param {string} deviceId - Target device
   * @param {Object} query - Query params for content loading (e.g., { open: 'videocall/id' })
   * @returns {Promise<Object>} - Result with per-step outcomes
   */
  async execute(deviceId, query = {}) {
    const startTime = Date.now();
    const topic = `homeline:${deviceId}`;
    const device = this.#deviceService.get(deviceId);

    if (!device) {
      return { ok: false, error: 'Device not found', deviceId };
    }

    const result = {
      ok: false,
      deviceId,
      steps: {},
      canProceed: false,
      allowOverride: false
    };

    // --- Step 1: Power On ---
    this.#emitProgress(topic, 'power', 'running');
    this.#logger.info?.('wake-and-load.power.start', { deviceId });

    const powerResult = await device.powerOn();
    result.steps.power = powerResult;

    if (!powerResult.ok) {
      this.#emitProgress(topic, 'power', 'failed', { error: powerResult.error });
      this.#logger.error?.('wake-and-load.power.failed', { deviceId, error: powerResult.error });
      result.error = powerResult.error;
      result.failedStep = 'power';
      result.totalElapsedMs = Date.now() - startTime;
      return result;
    }

    this.#emitProgress(topic, 'power', 'done', { verified: powerResult.verified });
    this.#logger.info?.('wake-and-load.power.done', {
      deviceId, verified: powerResult.verified, elapsedMs: powerResult.elapsedMs
    });

    // --- Step 2: Verify Display ---
    this.#emitProgress(topic, 'verify', 'running');
    this.#logger.info?.('wake-and-load.verify.start', { deviceId });

    const readiness = await this.#readinessPolicy.isReady(deviceId);
    result.steps.verify = readiness;

    if (!readiness.ready) {
      this.#emitProgress(topic, 'verify', 'failed', { reason: readiness.reason });
      this.#logger.warn?.('wake-and-load.verify.failed', { deviceId, reason: readiness.reason });
      result.failedStep = 'verify';
      result.error = readiness.reason === 'no_sensor'
        ? 'No display sensor configured — cannot verify'
        : 'Display did not turn on';
      result.allowOverride = true; // Phone can choose "Connect anyway"
      result.totalElapsedMs = Date.now() - startTime;
      return result;
    }

    this.#emitProgress(topic, 'verify', 'done');
    this.#logger.info?.('wake-and-load.verify.done', { deviceId });

    // --- Step 3: Prepare Content ---
    this.#emitProgress(topic, 'prepare', 'running');
    this.#logger.info?.('wake-and-load.prepare.start', { deviceId });

    const prepResult = await device.prepareForContent();
    result.steps.prepare = prepResult;

    if (!prepResult.ok) {
      this.#emitProgress(topic, 'prepare', 'failed', { error: prepResult.error });
      this.#logger.error?.('wake-and-load.prepare.failed', { deviceId, error: prepResult.error });
      result.error = prepResult.error;
      result.failedStep = 'prepare';
      result.totalElapsedMs = Date.now() - startTime;
      return result;
    }

    this.#emitProgress(topic, 'prepare', 'done');
    this.#logger.info?.('wake-and-load.prepare.done', { deviceId });

    // --- Step 4: Load Content ---
    this.#emitProgress(topic, 'load', 'running');
    this.#logger.info?.('wake-and-load.load.start', { deviceId, query });

    const loadResult = await device.loadContent('/tv', query);
    result.steps.load = loadResult;

    if (!loadResult.ok) {
      this.#emitProgress(topic, 'load', 'failed', { error: loadResult.error });
      this.#logger.error?.('wake-and-load.load.failed', { deviceId, error: loadResult.error });
      result.error = loadResult.error;
      result.failedStep = 'load';
      result.totalElapsedMs = Date.now() - startTime;
      return result;
    }

    this.#emitProgress(topic, 'load', 'done');

    // --- All steps passed ---
    result.ok = true;
    result.canProceed = true;
    result.totalElapsedMs = Date.now() - startTime;

    this.#logger.info?.('wake-and-load.complete', {
      deviceId, totalElapsedMs: result.totalElapsedMs
    });

    return result;
  }

  /**
   * Emit a progress event over WebSocket.
   * @private
   */
  #emitProgress(topic, step, status, extra = {}) {
    this.#broadcast({
      topic,
      type: 'wake-progress',
      step,
      status,
      steps: STEPS,
      ...extra
    });
  }
}

export default WakeAndLoadService;
