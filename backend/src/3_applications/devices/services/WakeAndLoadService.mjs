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
import { isLoadContentQueueOp } from '#shared-contracts/media/commands.mjs';
import { resolveContentId } from '../contentIdKeys.mjs';
import { contentRequiresCamera } from './contentRequiresCamera.mjs';

// Note: 'playback' is an optional trailing step emitted only by the playback
// watchdog (after load). Not in the sequential flow; frontend consumers may
// treat it as an out-of-band event.
const STEPS = ['power', 'verify', 'volume', 'prepare', 'prewarm', 'load', 'playback'];
const VOLUME_TIMEOUT_MS = 3000;

export class WakeAndLoadService {
  #deviceService;
  #readinessPolicy;
  #broadcast;
  #eventBus;
  #prewarmService;
  #sessionControlService;
  #haGateway;
  #commandHandlerLivenessService;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.deviceService - DeviceService for device lookup
   * @param {Object} deps.readinessPolicy - DisplayReadinessPolicy instance
   * @param {Function} deps.broadcast - broadcastEvent(payload) function
   * @param {Object} [deps.eventBus] - EventBus instance for WS-first delivery (optional)
   * @param {Object} [deps.prewarmService] - TranscodePrewarmService (optional)
   * @param {Object} [deps.sessionControlService] - ISessionControl for adopt-snapshot (optional)
   * @param {Object} [deps.commandHandlerLivenessService] - CommandHandlerLivenessService for WS-first liveness gate (optional)
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
    this.#haGateway = deps.haGateway || null;
    this.#commandHandlerLivenessService = deps.commandHandlerLivenessService || null;
    this.#logger = deps.logger || console;
    if (!this.#commandHandlerLivenessService) {
      this.#logger.warn?.('wake-and-load.no-liveness-service', {
        note: 'WS-first warm-switch will fall back to subscriber-count gate only',
      });
    }
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
    // Self-powered surfaces (touch panels, speakers) declare content_control but no
    // device_control: there is nothing to switch on and no state sensor to verify
    // against. Skip the step rather than hard-failing the whole dispatch.
    //
    // The predicate is 'deviceControl', NOT 'power' — getCapabilities() emits no
    // `power` key, so hasCapability('power') is always false. (That is exactly why
    // the Step 4b block at ~line 294 has never executed; see the plan's Known Issue.)
    const canPowerOn = device.hasCapability('deviceControl');

    this.#emitProgress(topic, dispatchId, 'power', 'running');
    this.#logger.info?.('wake-and-load.power.start', { deviceId, dispatchId, canPowerOn });

    const powerResult = canPowerOn
      ? await device.powerOn()
      : { ok: true, skipped: 'no_device_control' };
    result.steps.power = powerResult;

    // Three outcomes to distinguish:
    //   1. ok:false, no verifyFailed -> script dispatch failed. Fatal.
    //   2. ok:false, verifyFailed:true -> script dispatched, sensor didn't confirm
    //      within adapter budget. Non-fatal: fall through to verify step, which
    //      gets a second chance via DisplayReadinessPolicy.isReady().
    //   3. ok:true -> proceed normally.
    if (!powerResult.ok && !powerResult.verifyFailed) {
      this.#emitProgress(topic, dispatchId, 'power', 'failed', { error: powerResult.error });
      this.#logger.error?.('wake-and-load.power.failed', { deviceId, dispatchId, error: powerResult.error });
      result.error = powerResult.error;
      result.failedStep = 'power';
      result.totalElapsedMs = Date.now() - startTime;
      return result;
    }

    if (!powerResult.ok && powerResult.verifyFailed) {
      this.#emitProgress(topic, dispatchId, 'power', 'unverified', { error: powerResult.error });
      this.#logger.warn?.('wake-and-load.power.unverified', {
        deviceId, dispatchId, error: powerResult.error, elapsedMs: powerResult.elapsedMs
      });
    } else {
      this.#emitProgress(topic, dispatchId, 'power', 'done', { verified: powerResult.verified });
      this.#logger.info?.('wake-and-load.power.done', {
        deviceId, dispatchId, verified: powerResult.verified, elapsedMs: powerResult.elapsedMs
      });
    }

    // --- Step 2: Verify Display ---
    // Skip redundant check if powerOn already confirmed the display is on,
    // or if the device has no sensor (verifySkipped). Only invoke the
    // readiness policy when power-on couldn't verify on its own.
    const alreadyVerified = powerResult.verified === true;
    // `skipped` covers self-powered devices, which have no sensor to consult at all;
    // without this they fall into readinessPolicy.isReady() and fail with 'no_sensor'
    // plus a spurious 45s retry.
    const noSensor = powerResult.verifySkipped === 'no_state_sensor'
      || powerResult.skipped === 'no_device_control';

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
        if (!options._isRetry) this.#scheduleRetry(deviceId, query, options);
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

    // Trigger end-behavior — propagate to the frontend via both the WS envelope
    // params and the URL fallback. The Player appends a virtual side-effect
    // tail item to the queue when these are present (see useQueueController).
    if (options.endBehavior && options.endBehavior !== 'nothing') {
      contentQuery.endBehavior = options.endBehavior;
      contentQuery.endDeviceId = deviceId;
      if (options.endLocation) contentQuery.endLocation = options.endLocation;
    }

    // --- Step 4: Prepare Content ---
    this.#emitProgress(topic, dispatchId, 'prepare', 'running');
    // Camera check (~4s on cold trigger) only matters for camera-using flows.
    const skipCameraCheck = !contentRequiresCamera(contentQuery);
    this.#logger.info?.('wake-and-load.prepare.start', { deviceId, dispatchId, skipCameraCheck });

    const prepResult = await device.prepareForContent({ skipCameraCheck });
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
    // cameraAvailable propagation:
    //   - true:  camera verified present
    //   - false: camera verified missing/unreachable (gate camera-required flows)
    //   - null:  not checked (skipCameraCheck) — consumers must NOT treat as failure
    // When the adapter skipped the check, surface null so downstream callers can
    // distinguish "we didn't look" from "camera doesn't work".
    const cameraAvailable = prepResult.cameraSkipped
      ? null
      : prepResult.cameraAvailable !== false;

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
    // Runs for BOTH queue= and play= dispatches: prewarm resolves containers
    // (show/album → concrete first playable) through the same queue
    // resolution the screens use, which (a) warms the transcode before the
    // device asks for it and (b) gives the playback watchdog a concrete
    // child contentId — a play=<container> dispatch previously armed the
    // watchdog with the container id, which can never match the flat episode
    // key the device reports, causing false `playback: timeout` (2026-07-14
    // Bluey dispatch).
    let prewarmResult = null;
    const prewarmRef = contentQuery.queue || contentQuery.play;
    if (!isAdopt && this.#prewarmService && prewarmRef) {
      this.#emitProgress(topic, dispatchId, 'prewarm', 'running');
      this.#logger.info?.('wake-and-load.prewarm.start', { deviceId, dispatchId, contentRef: prewarmRef });

      try {
        prewarmResult = await this.#prewarmService.prewarm(prewarmRef, {
          shuffle: contentQuery.shuffle === '1' || contentQuery.shuffle === 'true'
        });
        if (prewarmResult?.status === 'ok') {
          contentQuery.prewarmToken = prewarmResult.token;
          contentQuery.prewarmContentId = prewarmResult.contentId;
          result.steps.prewarm = { ok: true, contentId: prewarmResult.contentId };
          this.#logger.info?.('wake-and-load.prewarm.done', {
            deviceId, dispatchId, contentId: prewarmResult.contentId, token: prewarmResult.token
          });
        } else if (prewarmResult?.status === 'failed') {
          result.steps.prewarm = {
            ok: false,
            reason: prewarmResult.reason,
            permanent: !!prewarmResult.permanent,
            error: prewarmResult.error,
          };
          this.#logger.warn?.('wake-and-load.prewarm.failed', {
            deviceId, dispatchId,
            reason: prewarmResult.reason,
            permanent: !!prewarmResult.permanent,
            error: prewarmResult.error,
          });

          if (prewarmResult.permanent) {
            this.#emitProgress(topic, dispatchId, 'prewarm', 'failed', {
              reason: prewarmResult.reason,
              permanent: true,
            });
            result.error = `Content unresolvable: ${prewarmResult.reason}`;
            result.failedStep = 'prewarm';
            result.permanent = true;
            result.totalElapsedMs = Date.now() - startTime;
            return result;
          }
        } else if (prewarmResult?.status === 'skipped') {
          result.steps.prewarm = { skipped: true, reason: prewarmResult.reason || 'unknown' };
          this.#logger.debug?.('wake-and-load.prewarm.skipped', {
            deviceId, dispatchId, reason: prewarmResult.reason || 'unknown'
          });
        } else {
          // Unknown/malformed return — treat as failure rather than hiding it
          result.steps.prewarm = { ok: false, reason: 'unknown-status', raw: prewarmResult };
          this.#logger.warn?.('wake-and-load.prewarm.unknown-status', {
            deviceId, dispatchId, raw: prewarmResult
          });
        }
      } catch (err) {
        result.steps.prewarm = { ok: false, error: err.message };
        this.#logger.warn?.('wake-and-load.prewarm.failed', { deviceId, dispatchId, error: err.message });
      }
      if (result.steps.prewarm?.ok !== false) {
        this.#emitProgress(topic, dispatchId, 'prewarm', 'done');
      } else if (!result.steps.prewarm?.permanent) {
        // Transient failure: emit done with warning so the frontend
        // wake-progress hook doesn't leave the step stuck on 'running'.
        // Permanent failures already emitted 'failed' above and short-circuited.
        this.#emitProgress(topic, dispatchId, 'prewarm', 'done', {
          warning: result.steps.prewarm.reason || result.steps.prewarm.error,
        });
      }
    } else {
      const reason = isAdopt
        ? 'adopt-mode'
        : (prewarmRef ? 'no service' : 'no content ref');
      result.steps.prewarm = { skipped: true, reason };
    }

    // --- Step 6: Load Content (or Adopt) ---
    // Fallback for a device without an explicit screen_path. The legacy /tv app
    // is retired; default to the living-room screen-framework screen.
    const screenPath = device.screenPath || '/screen/living-room';

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
    // Gate on TWO signals:
    //   1. subscriberCount > 0  — someone is listening on the homeline topic
    //   2. liveness.isFresh()    — a real command handler is mounted (Task 8)
    // Subscriber count alone trusts stale subscribers; liveness adds positive
    // proof a useCommandAckPublisher is actually running on the screen.
    const liveness = this.#commandHandlerLivenessService;
    const warmPrepare = !coldWake && hasContentQuery && !!this.#eventBus;
    const subscriberCount = warmPrepare ? this.#eventBus.getTopicSubscriberCount(topic) : 0;
    const handlerFresh = liveness ? liveness.isFresh(deviceId) : false;
    let wsDelivered = false;
    let wsSkipReason = null;

    if (warmPrepare) {
      this.#logger.info?.('wake-and-load.load.ws-check', {
        deviceId, dispatchId, topic, subscriberCount, handlerFresh,
      });

      if (subscriberCount === 0) {
        wsSkipReason = 'no-subscribers';
      } else if (liveness && !handlerFresh) {
        wsSkipReason = 'handler-stale';
      }

      if (!wsSkipReason) {
        try {
          // Resolve contentId from the query using the same priority order as
          // WebSocketContentAdapter. If nothing resolves, skip WS-first and let
          // the FKB URL fallback handle it.
          const resolved = resolveContentId(contentQuery);
          if (!resolved) {
            throw new Error('ws-first.no-contentId');
          }
          const { contentId: resolvedContentId, resolvedKey } = resolved;
          const requestedOp = isLoadContentQueueOp(contentQuery.op) ? contentQuery.op : 'play-now';
          const passThroughOpts = { ...contentQuery };
          delete passThroughOpts[resolvedKey];
          delete passThroughOpts.op;

          // op and contentId are stripped from `options` above; the canonical values
          // here cannot be clobbered by stray query keys.
          // Reuse dispatchId as commandId — matches the adopt-snapshot pattern
          // a few lines up and keeps all correlated logs tied to one id.
          const envelope = buildCommandEnvelope({
            targetDevice: deviceId,
            command: 'queue',
            commandId: dispatchId,
            params: { ...passThroughOpts, op: requestedOp, contentId: resolvedContentId },
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
          wsSkipReason = 'ws-error';
        }
      } else {
        this.#logger.info?.('wake-and-load.load.ws-skipped', {
          deviceId, dispatchId, reason: wsSkipReason,
        });
      }
    } else if (coldWake) {
      wsSkipReason = 'cold-restart';
    } else if (!hasContentQuery) {
      wsSkipReason = 'no-content';
    } else {
      wsSkipReason = 'no-event-bus';
    }

    // --- FKB loadURL (primary or fallback) ---
    if (!wsDelivered) {
      // verifyAsync: don't block on FKB currentUrl polling. The playback
      // watchdog (#armPlaybackWatchdog) is the authoritative "user is seeing
      // media" signal — strictly more useful than currentUrl. The verify
      // poll runs in the background and just logs the outcome.
      const loadResult = await device.loadContent(screenPath, contentQuery, { verifyAsync: true });

      if (loadResult.ok) {
        const isFkbFallback = !!wsSkipReason;
        result.steps.load = {
          ...loadResult,
          ...(isFkbFallback ? { method: 'fkb-fallback', wsSkipped: wsSkipReason } : {}),
          ...(wsSkipReason === 'ws-error' ? { wsError: 'ack-timeout' } : {}),
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

        // Broadcast content command via CommandEnvelope (targeted to this device).
        const fbResolved = resolveContentId(contentQuery);
        if (!fbResolved) {
          this.#logger.warn?.('wake-and-load.load.wsFallback.no-contentId', {
            deviceId, dispatchId, queryKeys: Object.keys(contentQuery),
          });
        } else {
          const { contentId: fbContentId, resolvedKey: fbResolvedKey } = fbResolved;
          const fbOp = isLoadContentQueueOp(contentQuery.op) ? contentQuery.op : 'play-now';
          const fbPassThrough = { ...contentQuery };
          delete fbPassThrough[fbResolvedKey];
          delete fbPassThrough.op;

          // op and contentId are stripped from `options` above; the canonical values
          // here cannot be clobbered by stray query keys.
          // Reuse dispatchId as commandId (same rationale as the WS-first path).
          const fbEnvelope = buildCommandEnvelope({
            targetDevice: deviceId,
            command: 'queue',
            commandId: dispatchId,
            params: { ...fbPassThrough, op: fbOp, contentId: fbContentId },
          });
          this.#broadcast({ topic, ...fbEnvelope });
          this.#logger.info?.('wake-and-load.load.wsFallbackSent', {
            deviceId, dispatchId, contentId: fbContentId,
          });
        }

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

    // Arm the playback watchdog — non-blocking. The response returns now;
    // the watchdog fires asynchronously if playback never starts.
    // Armed for ANY resolvable content query (queue, play, play-next, …) —
    // gating on `queue` alone let play-next dispatches fail silently
    // (2026-07-07 NFC bug: trigger.fired ok:true, nothing played, no alarm).
    // #armPlaybackWatchdog no-ops when no content id resolves.
    if (result.ok && !isAdopt) {
      this.#armPlaybackWatchdog({
        deviceId, dispatchId, topic, contentQuery
      });
    }

    return result;
  }

  /**
   * Schedule one deferred retry after 45s. Fires HA push notification on failure.
   * The _isRetry flag prevents cascading retries.
   * @private
   */
  #scheduleRetry(deviceId, query, options) {
    const RETRY_DELAY_MS = 45_000;
    const timer = setTimeout(async () => {
      this.#logger.info?.('wake-and-load.retry.start', { deviceId, delayMs: RETRY_DELAY_MS });
      try {
        const result = await this.execute(deviceId, query, { ...options, _isRetry: true });
        if (result.ok) {
          this.#logger.info?.('wake-and-load.retry.success', { deviceId });
        } else {
          this.#logger.warn?.('wake-and-load.retry.failed', { deviceId, failedStep: result.failedStep });
          await this.#notifyPowerFailure(deviceId);
        }
      } catch (err) {
        this.#logger.error?.('wake-and-load.retry.error', { deviceId, error: err.message });
        await this.#notifyPowerFailure(deviceId);
      }
    }, RETRY_DELAY_MS);
    if (timer.unref) timer.unref();
  }

  /**
   * Send HA push notification that a device failed to power on.
   * @private
   */
  async #notifyPowerFailure(deviceId) {
    const device = this.#deviceService.get(deviceId);
    const notifyService = device?.notifyService;
    if (!notifyService || !this.#haGateway) return;
    try {
      await this.#haGateway.callService('notify', notifyService, {
        title: 'TV failed to turn on',
        message: `${deviceId} did not respond after retry`
      });
      this.#logger.info?.('wake-and-load.notify.sent', { deviceId, notifyService });
    } catch (err) {
      this.#logger.error?.('wake-and-load.notify.failed', { deviceId, notifyService, error: err.message });
    }
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

  /**
   * After a successful load, subscribe to playback.log events for N seconds.
   * If none arrive for the loaded content, log + broadcast a timeout so the
   * phone UI (or an ops dashboard) can surface the silent failure.
   *
   * Non-blocking: the load() response has already been returned to the caller;
   * this runs asynchronously in the background.
   *
   * @private
   */
  #armPlaybackWatchdog({ deviceId, dispatchId, topic, contentQuery, timeoutMs = 90_000 }) {
    if (!this.#eventBus || typeof this.#eventBus.subscribe !== 'function') return;

    // Extract content identifiers for watchdog matching. We accept a match
    // against ANY of: prewarmContentId (concrete first playable resolved by
    // prewarm — for container dispatches this is the only id the device will
    // actually report, since Plex child keys are flat and never prefix-match
    // their container), explicit contentId, and the shared CONTENT_ID_KEYS
    // resolution (queue, play, play-next, hymn, …). resolveContentId keeps
    // this in lockstep with the WS-envelope delivery paths, so play-next
    // dispatches are watched too (2026-07-07 bug).
    // Menu/list opens resolve to null and correctly do not arm — a browse
    // action never emits playback.log, so arming would false-timeout.
    const expectedContentIds = [...new Set([
      contentQuery.prewarmContentId,
      contentQuery.contentId,
      resolveContentId(contentQuery)?.contentId,
    ].filter(Boolean))];
    if (!expectedContentIds.length) return;
    const expectedContentId = expectedContentIds[0]; // primary, for logging

    let resolved = false;
    let timer = null;
    let unsubscribe = null;

    const cleanup = () => {
      resolved = true;
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
    };

    unsubscribe = this.#eventBus.subscribe('playback.log', (payload) => {
      if (resolved) return;
      const incoming = payload?.contentId;
      if (!incoming) return;
      // Match if the incoming contentId equals, or is a hierarchical
      // descendant/ancestor of, ANY expected candidate. Using `:` as a
      // boundary prevents false positives with numeric Plex IDs (e.g.
      // `plex:1` vs `plex:12`), while preserving matches like `plex:1` vs
      // `plex:1:episode`.
      const matches = expectedContentIds.some((expected) =>
        incoming === expected ||
        incoming.startsWith(`${expected}:`) ||
        expected.startsWith(`${incoming}:`));
      if (matches) {
        cleanup();
        this.#logger.info?.('wake-and-load.playback.confirmed', {
          deviceId, dispatchId, contentId: incoming
        });
        // Positive confirmation for the sender's UI ("▶ Playing on …") —
        // without this broadcast the tray can only ever show "sent" or the
        // negative timeout.
        this.#emitProgress(topic, dispatchId, 'playback', 'confirmed', {
          contentId: incoming
        });
      }
    });

    timer = setTimeout(() => {
      if (resolved) return;
      cleanup();
      this.#logger.warn?.('wake-and-load.playback.timeout', {
        deviceId, dispatchId, expectedContentId, timeoutMs
      });
      this.#emitProgress(topic, dispatchId, 'playback', 'timeout', {
        expectedContentId, timeoutMs
      });
    }, timeoutMs);

    if (timer.unref) timer.unref();
  }
}

export default WakeAndLoadService;
