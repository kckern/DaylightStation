/**
 * WakeAndLoadService — orchestrates the full device wake + content load workflow.
 *
 * Replaces inline orchestration from the device router. Emits WebSocket progress
 * events at each step so the phone UI can show real-time feedback.
 *
 * Steps: power_on -> verify_display -> set_volume -> prepare_content -> load_content
 *
 * Events published on `homeline:<deviceId>` carry a `dispatchId` correlator
 * (per technical spec §9.9). Callers may pass their own via the `dispatchId`
 * option on `execute`/`run`; otherwise a UUID is generated and used for every
 * event belonging to that run plus the final result.
 *
 * Adopt mode (spec §4.7): when invoked with `adoptSnapshot`, the service runs
 * the normal wake steps (power → verify → volume → prepare) but skips
 * transcode prewarm and replaces the final `load` step with an
 * `adopt-snapshot` command dispatched through SessionControlService. Requires
 * `sessionControlService` injection.
 *
 * @module applications/devices/services
 */

import { randomUUID } from 'node:crypto';
import { buildCommandEnvelope } from '#shared-contracts/media/envelopes.mjs';

const STEPS = ['power', 'verify', 'volume', 'prepare', 'prewarm', 'load'];
const VOLUME_TIMEOUT_MS = 3000;

export class WakeAndLoadService {
  #deviceService;
  #readinessPolicy;
  #broadcast;
  #eventBus;
  #prewarmService;
  #sessionControlService;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.deviceService - DeviceService for device lookup
   * @param {Object} deps.readinessPolicy - DisplayReadinessPolicy instance
   * @param {Function} deps.broadcast - broadcastEvent(payload) function
   * @param {Object} [deps.eventBus] - EventBus instance for WS-first delivery (optional)
   * @param {Object} [deps.prewarmService] - TranscodePrewarmService (optional)
   * @param {Object} [deps.sessionControlService] - ISessionControl for adopt-snapshot (optional)
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
    this.#sessionControlService = deps.sessionControlService || null;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the full wake-and-load workflow.
   * Deduplicates concurrent calls for the same device — a second call while
   * the first is in-flight returns the first call's result.
   *
   * @param {string} deviceId - Target device
   * @param {Object} [query] - Query params for content loading (e.g., { open: 'videocall/id' })
   * @param {Object} [options]
   * @param {string} [options.dispatchId] - Correlator surfaced on every wake-progress event.
   *   If omitted, a UUID is generated and shared across all events for this run.
   * @param {Object} [options.adoptSnapshot] - If present, run the wake steps but replace
   *   the final `load` step with an `adopt-snapshot` command dispatched via
   *   SessionControlService (Hand Off / §4.7). Skips transcode prewarm.
   * @returns {Promise<Object>} - Result with per-step outcomes + dispatchId
   */
  async execute(deviceId, query = {}, options = {}) {
    if (this.#inflight.has(deviceId)) {
      this.#logger.info?.('wake-and-load.deduplicated', { deviceId });
      return this.#inflight.get(deviceId);
    }

    const promise = this.#executeInner(deviceId, query, options).finally(() => {
      this.#inflight.delete(deviceId);
    });
    this.#inflight.set(deviceId, promise);
    return promise;
  }

  /**
   * Alias for `execute` — spec uses "run" terminology (§4.7). Both entry points
   * share the same dedup cache and option surface.
   */
  async run(deviceId, query = {}, options = {}) {
    return this.execute(deviceId, query, options);
  }

  async #executeInner(deviceId, query = {}, options = {}) {
    const startTime = Date.now();
    const topic = `homeline:${deviceId}`;
    const dispatchId = typeof options.dispatchId === 'string' && options.dispatchId.length > 0
      ? options.dispatchId
      : randomUUID();
    const adoptSnapshot = options.adoptSnapshot ?? null;
    const isAdopt = !!adoptSnapshot;
    const device = this.#deviceService.get(deviceId);

    if (!device) {
      return { ok: false, error: 'Device not found', deviceId, dispatchId };
    }

    if (isAdopt && !this.#sessionControlService) {
      return {
        ok: false,
        error: 'Session control not configured for adopt-snapshot',
        deviceId,
        dispatchId,
      };
    }

    const result = {
      ok: false,
      deviceId,
      dispatchId,
      steps: {},
      canProceed: false,
      allowOverride: false,
      coldWake: false,
      cameraAvailable: true
    };

    // --- Step 1: Power On ---
    this.#emitProgress(topic, dispatchId, 'power', 'running');
    this.#logger.info?.('wake-and-load.power.start', { deviceId, dispatchId });

    const powerResult = await device.powerOn();
    result.steps.power = powerResult;

    if (!powerResult.ok) {
      this.#emitProgress(topic, dispatchId, 'power', 'failed', { error: powerResult.error });
      this.#logger.error?.('wake-and-load.power.failed', { deviceId, dispatchId, error: powerResult.error });
      result.error = powerResult.error;
      result.failedStep = 'power';
      result.totalElapsedMs = Date.now() - startTime;
      return result;
    }

    this.#emitProgress(topic, dispatchId, 'power', 'done', { verified: powerResult.verified });
    this.#logger.info?.('wake-and-load.power.done', {
      deviceId, dispatchId, verified: powerResult.verified, elapsedMs: powerResult.elapsedMs
    });

    // --- Step 2: Verify Display ---
    // Skip redundant check if powerOn already confirmed the display is on,
    // or if the device has no sensor (verifySkipped). Only invoke the
    // readiness policy when power-on couldn't verify on its own.
    const alreadyVerified = powerResult.verified === true;
    const noSensor = powerResult.verifySkipped === 'no_state_sensor';

    if (alreadyVerified || noSensor) {
      const skipReason = alreadyVerified ? 'power_on_verified' : 'no_sensor';
      this.#emitProgress(topic, dispatchId, 'verify', 'done', { skipped: skipReason });
      this.#logger.info?.('wake-and-load.verify.skipped', { deviceId, dispatchId, reason: skipReason });
      result.steps.verify = { ready: true, skipped: skipReason };
    } else {
      this.#emitProgress(topic, dispatchId, 'verify', 'running');
      this.#logger.info?.('wake-and-load.verify.start', { deviceId, dispatchId });

      const readiness = await this.#readinessPolicy.isReady(deviceId);
      result.steps.verify = readiness;

      if (!readiness.ready) {
        this.#emitProgress(topic, dispatchId, 'verify', 'failed', { reason: readiness.reason });
        this.#logger.warn?.('wake-and-load.verify.failed', { deviceId, dispatchId, reason: readiness.reason });
        result.failedStep = 'verify';
        result.error = 'Display did not turn on';
        result.allowOverride = true; // Phone can choose "Connect anyway"
        result.totalElapsedMs = Date.now() - startTime;
        return result;
      }

      this.#emitProgress(topic, dispatchId, 'verify', 'done');
      this.#logger.info?.('wake-and-load.verify.done', { deviceId, dispatchId });
    }

    // --- Step 3: Set Volume ---
    const volumeLevel = query.volume != null ? Number(query.volume) : device.defaultVolume;

    if (volumeLevel != null && device.hasCapability('volume')) {
      this.#emitProgress(topic, dispatchId, 'volume', 'running');
      this.#logger.info?.('wake-and-load.volume.start', { deviceId, dispatchId, level: volumeLevel });

      try {
        const volumeResult = await Promise.race([
          device.setVolume(volumeLevel),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), VOLUME_TIMEOUT_MS))
        ]);
        result.steps.volume = volumeResult;
        this.#emitProgress(topic, dispatchId, 'volume', 'done', { level: volumeLevel });
        this.#logger.info?.('wake-and-load.volume.done', { deviceId, dispatchId, level: volumeLevel, ok: volumeResult.ok });
      } catch (err) {
        result.steps.volume = { ok: false, error: err.message };
        this.#emitProgress(topic, dispatchId, 'volume', 'done', { warning: err.message });
        this.#logger.warn?.('wake-and-load.volume.failed', { deviceId, dispatchId, level: volumeLevel, error: err.message });
      }
    } else {
      result.steps.volume = { skipped: true };
      this.#logger.debug?.('wake-and-load.volume.skipped', {
        deviceId,
        dispatchId,
        reason: volumeLevel == null ? 'no_volume_param' : 'no_volume_capability'
      });
    }

    // Remove volume from query so it's not passed to the frontend URL
    const contentQuery = { ...query };
    delete contentQuery.volume;

    // --- Step 4: Prepare Content ---
    this.#emitProgress(topic, dispatchId, 'prepare', 'running');
    this.#logger.info?.('wake-and-load.prepare.start', { deviceId, dispatchId });

    const prepResult = await device.prepareForContent();
    result.steps.prepare = prepResult;

    if (!prepResult.ok) {
      this.#emitProgress(topic, dispatchId, 'prepare', 'failed', { error: prepResult.error });
      this.#logger.error?.('wake-and-load.prepare.failed', { deviceId, dispatchId, error: prepResult.error });
      result.error = prepResult.error;
      result.failedStep = 'prepare';
      result.totalElapsedMs = Date.now() - startTime;
      return result;
    }

    this.#emitProgress(topic, dispatchId, 'prepare', 'done');
    this.#logger.info?.('wake-and-load.prepare.done', { deviceId, dispatchId });

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
          dispatchId,
          reason: 'tv-powered-off-during-prepare',
          elapsedMs: postPreparePower.elapsedMs
        });
        result.steps.powerRecheck = { restarted: true, elapsedMs: postPreparePower.elapsedMs };
      } else {
        this.#logger.debug?.('wake-and-load.power.still-on', { deviceId, dispatchId });
        result.steps.powerRecheck = { restarted: false };
      }
    }

    // --- Step 5: Pre-warm transcode (best-effort) ---
    // Skipped entirely on adopt path — the snapshot already describes the
    // intended media; no queue resolution or transcode needed.
    let prewarmResult = null;
    if (!isAdopt && this.#prewarmService && contentQuery.queue) {
      this.#emitProgress(topic, dispatchId, 'prewarm', 'running');
      this.#logger.info?.('wake-and-load.prewarm.start', { deviceId, dispatchId, queue: contentQuery.queue });

      try {
        prewarmResult = await this.#prewarmService.prewarm(contentQuery.queue, {
          shuffle: contentQuery.shuffle === '1' || contentQuery.shuffle === 'true'
        });
        if (prewarmResult) {
          contentQuery.prewarmToken = prewarmResult.token;
          contentQuery.prewarmContentId = prewarmResult.contentId;
          result.steps.prewarm = { ok: true, contentId: prewarmResult.contentId };
          this.#logger.info?.('wake-and-load.prewarm.done', {
            deviceId, dispatchId, contentId: prewarmResult.contentId, token: prewarmResult.token
          });
        } else {
          result.steps.prewarm = { skipped: true, reason: 'not applicable' };
          this.#logger.debug?.('wake-and-load.prewarm.skipped', { deviceId, dispatchId, reason: 'not applicable' });
        }
      } catch (err) {
        result.steps.prewarm = { ok: false, error: err.message };
        this.#logger.warn?.('wake-and-load.prewarm.failed', { deviceId, dispatchId, error: err.message });
      }
      this.#emitProgress(topic, dispatchId, 'prewarm', 'done');
    } else {
      const reason = isAdopt
        ? 'adopt-mode'
        : (contentQuery.queue ? 'no service' : 'no queue');
      result.steps.prewarm = { skipped: true, reason };
    }

    // --- Step 6: Load Content (or Adopt) ---
    const screenPath = device.screenPath || '/tv';

    if (isAdopt) {
      this.#emitProgress(topic, dispatchId, 'load', 'running', { method: 'adopt-snapshot' });
      this.#logger.info?.('wake-and-load.adopt.start', { deviceId, dispatchId });

      const envelope = buildCommandEnvelope({
        targetDevice: deviceId,
        command: 'adopt-snapshot',
        commandId: dispatchId,
        params: { snapshot: adoptSnapshot, autoplay: true },
      });

      const adoptResult = await this.#sessionControlService.sendCommand(envelope);
      if (adoptResult && adoptResult.ok === true) {
        result.steps.load = { ok: true, method: 'adopt-snapshot', commandId: dispatchId };
        this.#emitProgress(topic, dispatchId, 'load', 'done', { method: 'adopt-snapshot' });
        this.#logger.info?.('wake-and-load.adopt.done', { deviceId, dispatchId });
      } else {
        const errMsg = adoptResult?.error || 'adopt-snapshot failed';
        this.#emitProgress(topic, dispatchId, 'load', 'failed', {
          error: errMsg,
          code: adoptResult?.code,
        });
        this.#logger.error?.('wake-and-load.adopt.failed', {
          deviceId, dispatchId, error: errMsg, code: adoptResult?.code,
        });
        result.steps.load = {
          ok: false,
          method: 'adopt-snapshot',
          error: errMsg,
          code: adoptResult?.code,
        };
        result.error = errMsg;
        result.failedStep = 'load';
        result.totalElapsedMs = Date.now() - startTime;
        return result;
      }

      // Adopt completed — fall through to the "All steps passed" block.
      result.ok = true;
      result.canProceed = true;
      result.coldWake = coldWake;
      result.cameraAvailable = cameraAvailable;
      result.totalElapsedMs = Date.now() - startTime;
      this.#logger.info?.('wake-and-load.complete', {
        deviceId, dispatchId, totalElapsedMs: result.totalElapsedMs, mode: 'adopt',
      });
      return result;
    }

    this.#emitProgress(topic, dispatchId, 'load', 'running');
    this.#logger.info?.('wake-and-load.load.start', { deviceId, dispatchId, query: contentQuery });

    const screenName = screenPath.replace(/^\/screen\//, '');
    const hasContentQuery = Object.keys(contentQuery).length > 0;

    // --- WS-first delivery ---
    // If the screen is already loaded (warm prepare) and WS subscribers exist,
    // try delivering content via WebSocket for an instant, no-refresh switch.
    const warmPrepare = !coldWake && hasContentQuery && !!this.#eventBus;
    const subscriberCount = warmPrepare ? this.#eventBus.getTopicSubscriberCount(topic) : 0;
    let wsDelivered = false;

    if (warmPrepare) {
      this.#logger.info?.('wake-and-load.load.ws-check', { deviceId, dispatchId, topic, subscriberCount });

      if (subscriberCount > 0) {
        try {
          // Resolve contentId from the query using the same priority order as
          // WebSocketContentAdapter. If nothing resolves, skip WS-first and let
          // the FKB URL fallback handle it.
          const contentIdKeys = ['queue', 'play', 'plex', 'hymn', 'primary', 'scripture', 'contentId'];
          let resolvedContentId = null;
          let resolvedKey = null;
          for (const k of contentIdKeys) {
            if (typeof contentQuery[k] === 'string' && contentQuery[k].length > 0) {
              resolvedContentId = contentQuery[k];
              resolvedKey = k;
              break;
            }
          }
          if (!resolvedContentId) {
            throw new Error('ws-first.no-contentId');
          }

          const opts = { ...contentQuery };
          delete opts[resolvedKey];

          // Reuse dispatchId as commandId — matches the adopt-snapshot pattern
          // a few lines up and keeps all correlated logs tied to one id.
          const envelope = buildCommandEnvelope({
            targetDevice: deviceId,
            command: 'queue',
            commandId: dispatchId,
            // Spread opts first so a caller-supplied op or contentId can't
            // clobber the canonical values.
            params: { ...opts, op: 'play-now', contentId: resolvedContentId },
          });
          this.#broadcast({ topic, ...envelope });

          // Wait for device-ack from useCommandAckPublisher (frontend emits
          // this once the command reaches a handler).
          const ackStart = Date.now();
          await this.#eventBus.waitForMessage(
            (msg) =>
              msg?.topic === 'device-ack' &&
              msg?.deviceId === deviceId &&
              msg?.commandId === dispatchId,
            4000
          );

          const ackMs = Date.now() - ackStart;
          this.#logger.info?.('wake-and-load.load.ws-ack', { deviceId, dispatchId, ackMs });

          result.steps.load = { ok: true, method: 'websocket', ackMs };
          wsDelivered = true;
          this.#emitProgress(topic, dispatchId, 'load', 'done', { method: 'websocket' });
        } catch (err) {
          this.#logger.warn?.('wake-and-load.load.ws-failed', { deviceId, dispatchId, error: err.message });
          // Fall through to FKB loadURL
        }
      } else {
        this.#logger.info?.('wake-and-load.load.ws-skipped', { deviceId, dispatchId, reason: 'no-subscribers' });
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
        this.#emitProgress(topic, dispatchId, 'load', 'done');
      } else if (hasContentQuery) {
        // --- WebSocket Fallback (existing) ---
        // URL load failed but there IS content to deliver. The screen may already
        // be loaded at the base URL (without query params). Send the content
        // command via WebSocket so the screen's useScreenCommands handler can
        // pick it up and trigger playback.
        this.#logger.warn?.('wake-and-load.load.urlFailed-tryingWsFallback', {
          deviceId, dispatchId, error: loadResult.error, contentQuery
        });
        this.#emitProgress(topic, dispatchId, 'load', 'retrying', { method: 'websocket' });

        // Ensure the screen has time to load the base URL before sending WS
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Load the base URL first if it hasn't loaded yet
        const baseLoadResult = await device.loadContent(screenPath, {});
        if (baseLoadResult.ok) {
          this.#logger.info?.('wake-and-load.load.baseUrlLoaded', { deviceId, dispatchId });
        }

        // Give the screen framework time to mount and subscribe to WS
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Broadcast content command via WebSocket (targeted to this device)
        this.#broadcast({ targetDevice: deviceId, ...contentQuery });
        this.#logger.info?.('wake-and-load.load.wsFallbackSent', {
          deviceId, dispatchId, contentQuery
        });

        result.steps.load = {
          ok: true,
          method: 'websocket-fallback',
          urlError: loadResult.error,
          note: 'URL load failed; content delivered via WebSocket command'
        };
        this.#emitProgress(topic, dispatchId, 'load', 'done', { method: 'websocket-fallback' });
      } else {
        // No content query — just a plain screen load that failed
        this.#emitProgress(topic, dispatchId, 'load', 'failed', { error: loadResult.error });
        this.#logger.error?.('wake-and-load.load.failed', { deviceId, dispatchId, error: loadResult.error });
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
      deviceId, dispatchId, totalElapsedMs: result.totalElapsedMs
    });

    return result;
  }

  /**
   * Emit a progress event over WebSocket.
   * @private
   */
  #emitProgress(topic, dispatchId, step, status, extra = {}) {
    this.#broadcast({
      topic,
      type: 'wake-progress',
      dispatchId,
      step,
      status,
      steps: STEPS,
      ...extra
    });
  }
}

export default WakeAndLoadService;
