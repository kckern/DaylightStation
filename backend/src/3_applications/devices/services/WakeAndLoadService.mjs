/**
 * WakeAndLoadService — orchestrates the full device wake + content load workflow.
 *
 * Replaces inline orchestration from the device router. Emits WebSocket progress
 * events at each step so the phone UI can show real-time feedback.
 *
 * Steps: power_on -> verify_display -> set_volume -> prepare_content -> load_content
 *
 * @module applications/devices/services
 */

const STEPS = ['power', 'verify', 'volume', 'prepare', 'prewarm', 'load'];
const VOLUME_TIMEOUT_MS = 3000;

export class WakeAndLoadService {
  #deviceService;
  #readinessPolicy;
  #broadcast;
  #eventBus;
  #prewarmService;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.deviceService - DeviceService for device lookup
   * @param {Object} deps.readinessPolicy - DisplayReadinessPolicy instance
   * @param {Function} deps.broadcast - broadcastEvent(payload) function
   * @param {Object} [deps.eventBus] - EventBus instance for WS-first delivery (optional)
   * @param {Object} [deps.prewarmService] - TranscodePrewarmService (optional)
   * @param {Object} [deps.logger]
   */
  /** @type {Map<string, Promise<Object>>} In-flight wake-and-load per device */
  #inflight = new Map();

  constructor(deps) {
    this.#deviceService = deps.deviceService;
    this.#readinessPolicy = deps.readinessPolicy;
    this.#broadcast = deps.broadcast;
    this.#eventBus = deps.eventBus || null;
    this.#prewarmService = deps.prewarmService || null;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the full wake-and-load workflow.
   * Deduplicates concurrent calls for the same device — a second call while
   * the first is in-flight returns the first call's result.
   *
   * @param {string} deviceId - Target device
   * @param {Object} query - Query params for content loading (e.g., { open: 'videocall/id' })
   * @returns {Promise<Object>} - Result with per-step outcomes
   */
  async execute(deviceId, query = {}) {
    if (this.#inflight.has(deviceId)) {
      this.#logger.info?.('wake-and-load.deduplicated', { deviceId });
      return this.#inflight.get(deviceId);
    }

    const promise = this.#executeInner(deviceId, query).finally(() => {
      this.#inflight.delete(deviceId);
    });
    this.#inflight.set(deviceId, promise);
    return promise;
  }

  async #executeInner(deviceId, query = {}) {
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
      allowOverride: false,
      coldWake: false,
      cameraAvailable: true
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
    // Skip redundant check if powerOn already confirmed the display is on,
    // or if the device has no sensor (verifySkipped). Only invoke the
    // readiness policy when power-on couldn't verify on its own.
    const alreadyVerified = powerResult.verified === true;
    const noSensor = powerResult.verifySkipped === 'no_state_sensor';

    if (alreadyVerified || noSensor) {
      const skipReason = alreadyVerified ? 'power_on_verified' : 'no_sensor';
      this.#emitProgress(topic, 'verify', 'done', { skipped: skipReason });
      this.#logger.info?.('wake-and-load.verify.skipped', { deviceId, reason: skipReason });
      result.steps.verify = { ready: true, skipped: skipReason };
    } else {
      this.#emitProgress(topic, 'verify', 'running');
      this.#logger.info?.('wake-and-load.verify.start', { deviceId });

      const readiness = await this.#readinessPolicy.isReady(deviceId);
      result.steps.verify = readiness;

      if (!readiness.ready) {
        this.#emitProgress(topic, 'verify', 'failed', { reason: readiness.reason });
        this.#logger.warn?.('wake-and-load.verify.failed', { deviceId, reason: readiness.reason });
        result.failedStep = 'verify';
        result.error = 'Display did not turn on';
        result.allowOverride = true; // Phone can choose "Connect anyway"
        result.totalElapsedMs = Date.now() - startTime;
        return result;
      }

      this.#emitProgress(topic, 'verify', 'done');
      this.#logger.info?.('wake-and-load.verify.done', { deviceId });
    }

    // --- Step 3: Set Volume ---
    const volumeLevel = query.volume != null ? Number(query.volume) : device.defaultVolume;

    if (volumeLevel != null && device.hasCapability('volume')) {
      this.#emitProgress(topic, 'volume', 'running');
      this.#logger.info?.('wake-and-load.volume.start', { deviceId, level: volumeLevel });

      try {
        const volumeResult = await Promise.race([
          device.setVolume(volumeLevel),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), VOLUME_TIMEOUT_MS))
        ]);
        result.steps.volume = volumeResult;
        this.#emitProgress(topic, 'volume', 'done', { level: volumeLevel });
        this.#logger.info?.('wake-and-load.volume.done', { deviceId, level: volumeLevel, ok: volumeResult.ok });
      } catch (err) {
        result.steps.volume = { ok: false, error: err.message };
        this.#emitProgress(topic, 'volume', 'done', { warning: err.message });
        this.#logger.warn?.('wake-and-load.volume.failed', { deviceId, level: volumeLevel, error: err.message });
      }
    } else {
      result.steps.volume = { skipped: true };
      this.#logger.debug?.('wake-and-load.volume.skipped', {
        deviceId,
        reason: volumeLevel == null ? 'no_volume_param' : 'no_volume_capability'
      });
    }

    // Remove volume from query so it's not passed to the frontend URL
    const contentQuery = { ...query };
    delete contentQuery.volume;

    // --- Step 4: Prepare Content ---
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

    const coldWake = !!prepResult.coldRestart;
    const cameraAvailable = prepResult.cameraAvailable !== false;

    // --- Step 4b: Re-verify TV power ---
    // The prepare phase can take 20-30s (ADB reconnect, companion apps, FKB
    // foreground verification). TVs with CEC auto-sleep or energy-saver may
    // power off during this window because no active content is displayed.
    // Re-check and power on again if needed before loading content.
    if (device.hasCapability('power')) {
      const postPreparePower = await device.powerOn();
      if (postPreparePower.ok && postPreparePower.wasPoweredOff) {
        this.#logger.warn?.('wake-and-load.power.re-verified', {
          deviceId,
          reason: 'tv-powered-off-during-prepare',
          elapsedMs: postPreparePower.elapsedMs
        });
        result.steps.powerRecheck = { restarted: true, elapsedMs: postPreparePower.elapsedMs };
      } else {
        this.#logger.debug?.('wake-and-load.power.still-on', { deviceId });
        result.steps.powerRecheck = { restarted: false };
      }
    }

    // --- Step 5: Pre-warm transcode (best-effort) ---
    let prewarmResult = null;
    if (this.#prewarmService && contentQuery.queue) {
      this.#emitProgress(topic, 'prewarm', 'running');
      this.#logger.info?.('wake-and-load.prewarm.start', { deviceId, queue: contentQuery.queue });

      try {
        prewarmResult = await this.#prewarmService.prewarm(contentQuery.queue, {
          shuffle: contentQuery.shuffle === '1' || contentQuery.shuffle === 'true'
        });
        if (prewarmResult) {
          contentQuery.prewarmToken = prewarmResult.token;
          contentQuery.prewarmContentId = prewarmResult.contentId;
          result.steps.prewarm = { ok: true, contentId: prewarmResult.contentId };
          this.#logger.info?.('wake-and-load.prewarm.done', {
            deviceId, contentId: prewarmResult.contentId, token: prewarmResult.token
          });
        } else {
          result.steps.prewarm = { skipped: true, reason: 'not applicable' };
          this.#logger.debug?.('wake-and-load.prewarm.skipped', { deviceId, reason: 'not applicable' });
        }
      } catch (err) {
        result.steps.prewarm = { ok: false, error: err.message };
        this.#logger.warn?.('wake-and-load.prewarm.failed', { deviceId, error: err.message });
      }
      this.#emitProgress(topic, 'prewarm', 'done');
    } else {
      result.steps.prewarm = { skipped: true, reason: contentQuery.queue ? 'no service' : 'no queue' };
    }

    // --- Step 6: Load Content ---
    this.#emitProgress(topic, 'load', 'running');
    this.#logger.info?.('wake-and-load.load.start', { deviceId, query: contentQuery });

    const screenPath = device.screenPath || '/tv';
    const hasContentQuery = Object.keys(contentQuery).length > 0;

    // --- WS-first delivery ---
    // If the screen is already loaded (warm prepare) and WS subscribers exist,
    // try delivering content via WebSocket for an instant, no-refresh switch.
    const warmPrepare = !coldWake && hasContentQuery && !!this.#eventBus;
    const subscriberCount = warmPrepare ? this.#eventBus.getTopicSubscriberCount(topic) : 0;
    let wsDelivered = false;

    if (warmPrepare) {
      this.#logger.info?.('wake-and-load.load.ws-check', { deviceId, topic, subscriberCount });

      if (subscriberCount > 0) {
        try {
          // Broadcast content command (targeted to this device)
          this.#broadcast({ topic, targetDevice: deviceId, ...contentQuery });

          // Wait for ack from the screen
          const ackStart = Date.now();
          await this.#eventBus.waitForMessage(
            (msg) => msg.type === 'content-ack' && msg.screen === deviceId,
            4000
          );

          const ackMs = Date.now() - ackStart;
          this.#logger.info?.('wake-and-load.load.ws-ack', { deviceId, ackMs });

          result.steps.load = { ok: true, method: 'websocket', ackMs };
          wsDelivered = true;
          this.#emitProgress(topic, 'load', 'done', { method: 'websocket' });
        } catch (err) {
          this.#logger.warn?.('wake-and-load.load.ws-failed', { deviceId, error: err.message });
          // Fall through to FKB loadURL
        }
      } else {
        this.#logger.info?.('wake-and-load.load.ws-skipped', { deviceId, reason: 'no-subscribers' });
      }
    }

    // --- FKB loadURL (primary or fallback) ---
    if (!wsDelivered) {
      const wsSkipReason = warmPrepare
        ? (subscriberCount === 0 ? 'no-subscribers' : undefined)
        : (coldWake ? 'cold-restart' : undefined);

      const loadResult = await device.loadContent(screenPath, contentQuery);

      if (loadResult.ok) {
        result.steps.load = {
          ...loadResult,
          ...(wsSkipReason ? { wsSkipped: wsSkipReason } : {}),
          ...(warmPrepare && !wsSkipReason ? { method: 'fkb-fallback', wsError: 'ack-timeout' } : {})
        };
        this.#emitProgress(topic, 'load', 'done');
      } else if (hasContentQuery) {
        // --- WebSocket Fallback (existing) ---
        // URL load failed but there IS content to deliver. The screen may already
        // be loaded at the base URL (without query params). Send the content
        // command via WebSocket so the screen's useScreenCommands handler can
        // pick it up and trigger playback.
        this.#logger.warn?.('wake-and-load.load.urlFailed-tryingWsFallback', {
          deviceId, error: loadResult.error, contentQuery
        });
        this.#emitProgress(topic, 'load', 'retrying', { method: 'websocket' });

        // Ensure the screen has time to load the base URL before sending WS
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Load the base URL first if it hasn't loaded yet
        const baseLoadResult = await device.loadContent(screenPath, {});
        if (baseLoadResult.ok) {
          this.#logger.info?.('wake-and-load.load.baseUrlLoaded', { deviceId });
        }

        // Give the screen framework time to mount and subscribe to WS
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Broadcast content command via WebSocket (targeted to this device)
        this.#broadcast({ targetDevice: deviceId, ...contentQuery });
        this.#logger.info?.('wake-and-load.load.wsFallbackSent', {
          deviceId, contentQuery
        });

        result.steps.load = {
          ok: true,
          method: 'websocket-fallback',
          urlError: loadResult.error,
          note: 'URL load failed; content delivered via WebSocket command'
        };
        this.#emitProgress(topic, 'load', 'done', { method: 'websocket-fallback' });
      } else {
        // No content query — just a plain screen load that failed
        this.#emitProgress(topic, 'load', 'failed', { error: loadResult.error });
        this.#logger.error?.('wake-and-load.load.failed', { deviceId, error: loadResult.error });
        result.error = loadResult.error;
        result.failedStep = 'load';
        result.totalElapsedMs = Date.now() - startTime;
        return result;
      }
    }

    // --- All steps passed ---
    result.ok = true;
    result.canProceed = true;
    result.coldWake = coldWake;
    result.cameraAvailable = cameraAvailable;
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
