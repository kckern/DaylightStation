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

import { buildCommandEnvelope } from '#shared-contracts/media/envelopes.mjs';
import { decodeItemAction } from '#shared-contracts/media/item-action.mjs';
import { isLoadContentQueueOp } from '#shared-contracts/media/commands.mjs';
import { resolveContentId } from '../ports/contentControlQuery.mjs';
import { contentRequiresCamera } from './contentRequiresCamera.mjs';
import { pushData, titleCaseId } from '#domains/notification/push/pushText.mjs';

// Note: 'playback' is an optional trailing step emitted only by the playback
// watchdog (after load). Not in the sequential flow; frontend consumers may
// treat it as an out-of-band event.

/** brief=1|<seconds>|true asks to show OVER the programme; brief=0 does not. */
function isBriefQuery(query) {
  const v = query?.brief;
  if (v === undefined || v === null || v === '' || v === false) return false;
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}

// Show briefly to a cold screen: how long to wait for it to subscribe.
const BRIEF_SUBSCRIBE_TIMEOUT_MS = 30_000;
const BRIEF_SUBSCRIBE_POLL_MS = 500;

const STEPS = ['power', 'verify', 'volume', 'prepare', 'prewarm', 'load', 'playback'];
// Origin of a dispatch no caller named (HA buttons, schedules, triggers).
const AUTOMATION_ORIGIN = Object.freeze({ kind: 'routine', name: 'Automation' });
const VOLUME_TIMEOUT_MS = 3000;
const URL_RECEIVER_ACK_TIMEOUT_MS = 15_000;
// Prewarm is best-effort and resolves the queue through Plex, which serializes
// requests: under load it can take minutes (2026-10-03: 12 min). It must never
// hold the load hostage — past this deadline the dispatch proceeds unprewarmed.
const DEFAULT_PREWARM_DEADLINE_MS = 10_000;

export class WakeAndLoadService {
  #deviceService;
  #readinessPolicy;
  #broadcast;
  #eventBus;
  #prewarmService;
  #sessionControlService;
  #haGateway;
  #commandHandlerLivenessService;
  #deviceLivenessService;
  #logger;
  #clock;
  #createDispatchId;
  #scheduler;
  #prewarmDeadlineMs;

  /**
   * @param {Object} deps
   * @param {Object} deps.deviceService - DeviceService for device lookup
   * @param {Object} deps.readinessPolicy - DisplayReadinessPolicy instance
   * @param {Function} deps.broadcast - broadcastEvent(payload) function
   * @param {Object} [deps.eventBus] - EventBus instance for WS-first delivery (optional)
   * @param {Object} [deps.prewarmService] - TranscodePrewarmService (optional)
   * @param {Object} [deps.sessionControlService] - ISessionControl for adopt-snapshot (optional)
   * @param {Object} [deps.commandHandlerLivenessService] - CommandHandlerLivenessService for WS-first liveness gate (optional)
   * @param {number} [deps.prewarmDeadlineMs=10000] - Bound on the best-effort prewarm step; past it the load proceeds unprewarmed
   * @param {Object} [deps.logger]
   */
  /** @type {Map<string, Promise<Object>>} In-flight wake-and-load per device */
  #inflight = new Map();
  #dispatchCorrelation = new Map();

  constructor(deps) {
    if (!deps.clock?.now || typeof deps.createDispatchId !== 'function'
      || !deps.scheduler?.wait || !deps.scheduler?.after || !deps.scheduler?.withDeadline) {
      throw new Error('WakeAndLoadService requires clock, createDispatchId, and scheduler');
    }
    this.#deviceService = deps.deviceService;
    this.#readinessPolicy = deps.readinessPolicy;
    this.#broadcast = typeof deps.broadcast === 'function' ? deps.broadcast : () => {};
    this.#eventBus = deps.eventBus || null;
    this.#prewarmService = deps.prewarmService || null;
    this.#sessionControlService = deps.sessionControlService || null;
    this.#haGateway = deps.haGateway || null;
    this.#commandHandlerLivenessService = deps.commandHandlerLivenessService || null;
    this.#deviceLivenessService = deps.deviceLivenessService || null;
    this.#logger = deps.logger || console;
    this.#clock = deps.clock;
    this.#createDispatchId = deps.createDispatchId;
    this.#scheduler = deps.scheduler;
    this.#prewarmDeadlineMs = Number.isFinite(deps.prewarmDeadlineMs) && deps.prewarmDeadlineMs > 0
      ? deps.prewarmDeadlineMs : DEFAULT_PREWARM_DEADLINE_MS;
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
      // Distinct queue intents must not be mistaken for a repeated wake tap.
      // Serialize operation envelopes through the existing per-screen wake.
      if (query.itemAction) {
        await this.#inflight.get(deviceId).catch(() => {});
        return this.execute(deviceId, query, options);
      }
      this.#logger.info?.('wake-and-load.deduplicated', { deviceId });
      return this.#inflight.get(deviceId);
    }

    let completedDispatchId = options.dispatchId;
    const promise = this.#executeInner(deviceId, query, options)
      .then(result => { completedDispatchId = result?.dispatchId || completedDispatchId; return result; })
      .finally(() => {
        this.#inflight.delete(deviceId);
        if (completedDispatchId) this.#dispatchCorrelation.delete(completedDispatchId);
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
    const startTime = this.#clock.now();
    const topic = `homeline:${deviceId}`;
    // A caller that supplies its own dispatchId can correlate the whole cast
    // in its own logs; one that doesn't gets a server-minted id and is
    // invisible from the client side. Record WHICH, so "the app logged the
    // steps but never logged initiating them" is answerable from one line
    // instead of a code audit (2026-08-12 session review).
    const clientSuppliedDispatchId = typeof options.dispatchId === 'string' && options.dispatchId.length > 0;
    const dispatchId = clientSuppliedDispatchId ? options.dispatchId : this.#createDispatchId();
    if (options.correlation && typeof options.correlation === 'object') {
      const correlation = Object.fromEntries(Object.entries(options.correlation)
        .filter(([key]) => ['callId', 'attemptId', 'callerId', 'phonePeerId', 'tvPeerId', 'state'].includes(key)));
      this.#dispatchCorrelation.set(dispatchId, correlation);
      this.#logger.info?.('wake-and-load.correlated', { deviceId, dispatchId, ...correlation });
    }
    const adoptSnapshot = options.adoptSnapshot ?? null;
    // Who started this (RQ-STEER-21, RQ-PLAY-10). A dispatch nobody named —
    // Home Assistant buttons, schedules, triggers — is an automation: screens
    // name it in notes and never turn it into an Add-only append.
    const commandOrigin = options.origin && typeof options.origin === 'object'
      ? options.origin : AUTOMATION_ORIGIN;
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
    const stopIfCancelled = (afterStep) => {
      if (!options.isCancelled?.()) return false;
      result.error = 'Dispatch cancelled';
      result.cancelled = true;
      result.failedStep = afterStep;
      result.totalElapsedMs = this.#clock.now() - startTime;
      this.#logger.info?.('wake-and-load.cancelled', { deviceId, dispatchId, afterStep });
      return true;
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
    this.#logger.info?.('wake-and-load.power.start', {
      deviceId,
      dispatchId,
      canPowerOn,
      dispatchIdSource: clientSuppliedDispatchId ? 'client' : 'server',
    });

    const powerResult = canPowerOn
      ? await device.powerOn()
      : { ok: true, skipped: 'no_device_control' };
    result.steps.power = powerResult;
    if (stopIfCancelled('power')) return result;

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
      result.totalElapsedMs = this.#clock.now() - startTime;
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
        result.totalElapsedMs = this.#clock.now() - startTime;
        if (!options._isRetry && options.deferredRetry !== false) {
          this.#scheduleRetry(deviceId, query, options);
        }
        return result;
      }

      this.#emitProgress(topic, dispatchId, 'verify', 'done');
      this.#logger.info?.('wake-and-load.verify.done', { deviceId, dispatchId });
    }

    if (stopIfCancelled('verify')) return result;

    // --- Step 3: Set Volume ---
    const volumeLevel = query.volume != null ? Number(query.volume) : device.defaultVolume;

    if (volumeLevel != null && device.hasCapability('volume')) {
      this.#emitProgress(topic, dispatchId, 'volume', 'running');
      this.#logger.info?.('wake-and-load.volume.start', { deviceId, dispatchId, level: volumeLevel });

      try {
        const volumeResult = await this.#scheduler.withDeadline(device.setVolume(volumeLevel), {
          milliseconds: VOLUME_TIMEOUT_MS,
          errorFactory: () => new Error('timeout'),
        });
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

    if (stopIfCancelled('volume')) return result;

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
    if (stopIfCancelled('prepare')) return result;

    if (!prepResult.ok) {
      this.#emitProgress(topic, dispatchId, 'prepare', 'failed', { error: prepResult.error });
      this.#logger.error?.('wake-and-load.prepare.failed', { deviceId, dispatchId, error: prepResult.error });
      result.error = prepResult.error;
      result.failedStep = 'prepare';
      result.totalElapsedMs = this.#clock.now() - startTime;
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
    //
    // Bounded by an injected deadline: the result is only read if it arrives
    // in time, and it is applied here — never by a late continuation — so a
    // prewarm that lands after the load cannot touch the in-flight query.
    let prewarmResult = null;
    // Concrete ids of the resolved queue (for the playback watchdog). Kept out
    // of contentQuery: they are evidence, not something to send the screen.
    let resolvedQueueContentIds = [];
    let prewarmTimedOut = false;
    const prewarmRef = contentQuery.queue || contentQuery.play || contentQuery['play-next'];
    // A camera (Show briefly, RQ-PLAY-11) is a live feed, not catalog content:
    // there is nothing to resolve or transcode.
    const isCameraRef = typeof prewarmRef === 'string' && prewarmRef.startsWith('camera:');
    if (!isAdopt && this.#prewarmService && prewarmRef && !isCameraRef) {
      this.#emitProgress(topic, dispatchId, 'prewarm', 'running');
      this.#logger.info?.('wake-and-load.prewarm.start', { deviceId, dispatchId, contentRef: prewarmRef });

      const deadlineMs = this.#prewarmDeadlineMs;
      const deadlineError = new Error('timeout');
      const prewarmWork = Promise.resolve().then(() => this.#prewarmService.prewarm(prewarmRef, {
        shuffle: contentQuery.shuffle === '1' || contentQuery.shuffle === 'true'
      }));
      try {
        try {
          prewarmResult = await this.#scheduler.withDeadline(prewarmWork, {
            milliseconds: deadlineMs,
            errorFactory: () => deadlineError,
          });
        } catch (err) {
          if (err !== deadlineError) throw err;
          prewarmTimedOut = true;
          prewarmResult = null;
          result.steps.prewarm = { ok: false, reason: 'timeout', deadlineMs };
          this.#logger.warn?.('wake-and-load.prewarm.timeout', {
            deviceId, dispatchId, contentRef: prewarmRef, deadlineMs,
          });
          // Observe the abandoned work so a late result is visible and a late
          // rejection is never unhandled. It is logged only — never applied.
          prewarmWork.then(
            (late) => this.#logger.warn?.('wake-and-load.prewarm.late', {
              deviceId, dispatchId, contentRef: prewarmRef, status: late?.status ?? null,
              contentId: late?.contentId ?? null, elapsedMs: this.#clock.now() - startTime,
            }),
            (lateErr) => this.#logger.warn?.('wake-and-load.prewarm.late', {
              deviceId, dispatchId, contentRef: prewarmRef, error: lateErr?.message ?? String(lateErr),
              elapsedMs: this.#clock.now() - startTime,
            }),
          );
        }
        if (Array.isArray(prewarmResult?.queueContentIds)) {
          resolvedQueueContentIds = prewarmResult.queueContentIds.filter((id) => typeof id === 'string' && id);
        }
        if (prewarmTimedOut) {
          // result.steps.prewarm already records the timeout.
        } else if (prewarmResult?.status === 'ok') {
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
            result.totalElapsedMs = this.#clock.now() - startTime;
            return result;
          }
        } else if (prewarmResult?.status === 'skipped') {
          result.steps.prewarm = { skipped: true, reason: prewarmResult.reason || 'unknown' };
          this.#logger.info?.('wake-and-load.prewarm.skipped', {
            deviceId, dispatchId, reason: prewarmResult.reason || 'unknown',
            resolvedQueueItems: resolvedQueueContentIds.length,
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
    // Composition resolves a missing screen_path (fuzzy match, then default)
    // when the device is built; this guard only covers a device constructed
    // without that resolver. The legacy /tv app is retired.
    const screenPath = device.screenPath || '/screen/living-room';
    if (stopIfCancelled('prewarm')) return result;

    if (isAdopt) {
      this.#emitProgress(topic, dispatchId, 'load', 'running', { method: 'adopt-snapshot' });
      this.#logger.info?.('wake-and-load.adopt.start', { deviceId, dispatchId });

      const envelope = buildCommandEnvelope({
        targetDevice: deviceId,
        command: 'adopt-snapshot',
        commandId: dispatchId,
        // A paused screen moved to an idle one stays paused (RQ-PLACE-13).
        params: { snapshot: adoptSnapshot, autoplay: adoptSnapshot?.state !== 'paused' },
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
        result.totalElapsedMs = this.#clock.now() - startTime;
        return result;
      }

      // Adopt completed — fall through to the "All steps passed" block.
      result.ok = true;
      result.canProceed = true;
      result.coldWake = coldWake;
      result.cameraAvailable = cameraAvailable;
      result.totalElapsedMs = this.#clock.now() - startTime;
      this.#logger.info?.('wake-and-load.complete', {
        deviceId, dispatchId, totalElapsedMs: result.totalElapsedMs, mode: 'adopt',
      });
      return result;
    }

    this.#emitProgress(topic, dispatchId, 'load', 'running');
    this.#logger.info?.('wake-and-load.load.start', { deviceId, dispatchId, query: contentQuery });

    const screenName = screenPath.replace(/^\/screen\//, '');
    const hasContentQuery = Object.keys(contentQuery).length > 0;
    const hasAcknowledgedContent = !!resolveContentId(contentQuery);

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
    let outcomeCommandAcknowledged = false;
    // Set when the receiver applied the command differently than asked —
    // Add only turns a play-now into an add (RQ-PLAY-10).
    let receiverAppliedAs = null;
    const outcomeBaseline = this.#deviceLivenessService?.getLastSnapshot?.(deviceId)?.snapshot ?? null;

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
            params: decodeItemAction(contentQuery.itemAction) ?? { ...passThroughOpts, op: requestedOp, contentId: resolvedContentId },
            origin: commandOrigin,
          });
          this.#broadcast({ topic, ...envelope });

          // Wait for device-ack from useCommandAckPublisher (frontend emits
          // this once the command reaches a handler).
          const ackStart = this.#clock.now();
          const ack = await this.#eventBus.waitForMessage(
            (msg) =>
              msg?.topic === 'device-ack' &&
              msg?.deviceId === deviceId &&
              msg?.commandId === dispatchId,
            4000
          );
          if (ack?.ok !== true) {
            throw new Error(ack?.error || ack?.code || 'receiver rejected command');
          }
          outcomeCommandAcknowledged = true;
          receiverAppliedAs = typeof ack.appliedAs === 'string' && ack.appliedAs !== requestedOp ? ack.appliedAs : null;

          const ackMs = this.#clock.now() - ackStart;
          this.#logger.info?.('wake-and-load.load.ws-ack', { deviceId, dispatchId, ackMs, ...(receiverAppliedAs ? { appliedAs: receiverAppliedAs, requestedOp } : {}) });

          result.steps.load = { ok: true, method: 'websocket', ackMs, ...(receiverAppliedAs ? { appliedAs: receiverAppliedAs } : {}) };
          if (receiverAppliedAs) result.appliedAs = receiverAppliedAs;
          wsDelivered = true;
          this.#emitProgress(topic, dispatchId, 'load', 'done', { method: 'websocket', ...(receiverAppliedAs ? { appliedAs: receiverAppliedAs } : {}) });
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
      // receiver outcome state is the authoritative "user is seeing media"
      // signal — strictly more useful than currentUrl. The verify
      // poll runs in the background and just logs the outcome.
      // Arm before loadURL: the page can parse the URL and publish its applied
      // ack before the device adapter's HTTP call returns.
      const urlAckPromise = hasAcknowledgedContent && this.#eventBus?.waitForMessage
        ? this.#eventBus.waitForMessage(
          (msg) => msg?.topic === 'device-ack'
            && msg?.deviceId === deviceId
            && msg?.commandId === dispatchId,
          URL_RECEIVER_ACK_TIMEOUT_MS,
        ).catch((error) => ({ ok: false, error: error?.message ?? String(error) }))
        : null;
      // DeviceContentDispatchService correctly lifts dispatchId out of the
      // content query into execute options. Put it back only at the receiver
      // delivery boundary so URL parsers/adapters can publish the same
      // commandId without contaminating content resolution.
      const receiverContentQuery = hasAcknowledgedContent
        ? { ...contentQuery, dispatchId }
        : contentQuery;
      // Show briefly / a camera (RQ-PLAY-11) is a command the page's own
      // handler runs OVER its programme. A page URL cannot carry it (its
      // autoplay parser would turn `camera:<id>` into a plain play the Player
      // cannot render, and drop `brief`), so a cold or unsubscribed screen
      // gets the base page and then the same envelope as a warm one.
      const briefOnly = isCameraRef || (hasContentQuery && isBriefQuery(contentQuery));
      const loadResult = briefOnly
        ? { ok: false, error: 'brief-needs-websocket' }
        : await device.loadContent(screenPath, receiverContentQuery, { verifyAsync: true });

      if (loadResult.ok) {
        if (urlAckPromise) {
          const ack = await urlAckPromise;
          outcomeCommandAcknowledged = ack?.ok === true;
          if (!outcomeCommandAcknowledged) {
            this.#logger.warn?.('wake-and-load.load.url-ack-missing', {
              deviceId, dispatchId, error: ack?.error,
            });
          }
        }
        const isFkbFallback = !!wsSkipReason;
        result.steps.load = {
          ...loadResult,
          ...(isFkbFallback ? { method: 'fkb-fallback', wsSkipped: wsSkipReason } : {}),
          ...(wsSkipReason === 'ws-error' ? { wsError: 'ack-timeout' } : {}),
        };
        this.#emitProgress(topic, dispatchId, 'load', 'done');
      } else if (hasContentQuery && /not connected/i.test(String(loadResult.error ?? ''))) {
        // The content adapter itself says no receiver is subscribed (a
        // WebSocket-only screen has no page it could load first): a fallback
        // broadcast would reach no one and then report ok. A press that
        // reached nothing is not delivered (PR-10, RELY.6a). A zero subscriber
        // count ALONE is not this: a cold FKB screen has none until its page
        // loads, which is exactly what the fallback below does.
        this.#emitProgress(topic, dispatchId, 'load', 'failed', { error: 'Screen not connected' });
        this.#logger.warn?.('wake-and-load.load.no-receiver', {
          deviceId, dispatchId, wsSkipReason, urlError: loadResult.error ?? null,
        });
        result.error = 'Screen not connected';
        result.failedStep = 'load';
        result.totalElapsedMs = this.#clock.now() - startTime;
        return result;
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

        // Ensure the screen has time to load the base URL before sending WS.
        // A brief is the one command that must not be fired into the void, so
        // it waits for a subscriber instead (below).
        if (!briefOnly) await this.#scheduler.wait(3000);

        // Load the base URL first if it hasn't loaded yet
        const baseLoadResult = await device.loadContent(screenPath, {});
        if (baseLoadResult.ok) {
          this.#logger.info?.('wake-and-load.load.baseUrlLoaded', { deviceId, dispatchId });
        } else if (this.#eventBus?.getTopicSubscriberCount?.(topic) === 0) {
          // The base page could not be loaded either (e.g. FKB unreachable) and
          // still nothing is subscribed: a fallback broadcast would reach no
          // one and then report ok. Not delivered (PR-10, re-verify 2).
          this.#emitProgress(topic, dispatchId, 'load', 'failed', { error: 'Screen not connected' });
          this.#logger.warn?.('wake-and-load.load.no-receiver', {
            deviceId, dispatchId, urlError: loadResult.error ?? null, baseError: baseLoadResult.error ?? null,
          });
          result.error = 'Screen not connected';
          result.failedStep = 'load';
          result.totalElapsedMs = this.#clock.now() - startTime;
          return result;
        }

        // Give the screen framework time to mount and subscribe to WS
        if (briefOnly) {
          // Show briefly (RQ-PLAY-11) goes out once, over the programme: poll
          // for a real subscriber (bounded, injected clock/scheduler) rather
          // than guess with a fixed wait, and report a miss as a failed load.
          const subscribed = await this.#awaitSubscriber(topic, deviceId);
          if (!subscribed) {
            this.#emitProgress(topic, dispatchId, 'load', 'failed', { error: 'Screen not connected' });
            this.#logger.warn?.('wake-and-load.load.brief-no-subscriber', {
              deviceId, dispatchId, waitedMs: BRIEF_SUBSCRIBE_TIMEOUT_MS,
            });
            result.error = 'Screen not connected';
            result.failedStep = 'load';
            result.totalElapsedMs = this.#clock.now() - startTime;
            return result;
          }
        } else {
          await this.#scheduler.wait(2000);
        }

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
            params: decodeItemAction(contentQuery.itemAction) ?? { ...fbPassThrough, op: fbOp, contentId: fbContentId },
            origin: commandOrigin,
          });
          this.#broadcast({ topic, ...fbEnvelope });
          this.#logger.info?.('wake-and-load.load.wsFallbackSent', {
            deviceId, dispatchId, contentId: fbContentId,
          });
          if (urlAckPromise) {
            const ack = await urlAckPromise;
            outcomeCommandAcknowledged = ack?.ok === true;
            if (outcomeCommandAcknowledged && typeof ack.appliedAs === 'string' && ack.appliedAs !== fbOp) {
              receiverAppliedAs = ack.appliedAs;
              result.appliedAs = receiverAppliedAs;
            }
            if (!outcomeCommandAcknowledged) {
              this.#logger.warn?.('wake-and-load.load.wsFallback-ack-missing', {
                deviceId, dispatchId, error: ack?.error,
              });
              if (briefOnly) {
                // A brief goes out once; with no handler ack it reached no one.
                this.#emitProgress(topic, dispatchId, 'load', 'failed', { error: 'Screen not connected' });
                result.error = 'Screen not connected';
                result.failedStep = 'load';
                result.totalElapsedMs = this.#clock.now() - startTime;
                return result;
              }
            }
          }
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
        result.totalElapsedMs = this.#clock.now() - startTime;
        return result;
      }
    }

    // --- All steps passed ---
    result.ok = true;
    result.canProceed = true;
    result.coldWake = coldWake;
    result.cameraAvailable = cameraAvailable;
    result.totalElapsedMs = this.#clock.now() - startTime;

    this.#logger.info?.('wake-and-load.complete', {
      deviceId, dispatchId, totalElapsedMs: result.totalElapsedMs
    });

    // Arm the receiver-outcome watchdog — non-blocking. A matching command
    // acknowledgement is only receipt/application evidence; the user-facing
    // result waits for a later state from this exact target and owner.
    if (result.ok && !isAdopt) {
      this.#armReceiverOutcomeWatchdog({
        deviceId, dispatchId, topic, contentQuery, outcomeBaseline,
        commandAcknowledged: outcomeCommandAcknowledged,
        appliedAs: receiverAppliedAs,
        resolvedQueueContentIds,
        prewarmTimedOut,
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
    this.#scheduler.after(RETRY_DELAY_MS, async () => {
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
    });
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
      // Name the device as the household does; the id stays only in the tag,
      // so a second failure for the same TV replaces the card without ringing.
      const name = device?.name ?? titleCaseId(deviceId);
      await this.#haGateway.callService('notify', notifyService, {
        title: `📺 ${name} didn't turn on`,
        message: "It didn't respond after a retry",
        data: pushData({ tag: `tv-${deviceId}`, alertOnce: true }),
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
  /**
   * Wait (bounded) until something is subscribed to the screen's topic.
   * Uses the injected clock and scheduler. A bus that cannot count
   * subscribers falls back to the fixed settle the other fallbacks use.
   */
  async #awaitSubscriber(topic, deviceId) {
    const count = this.#eventBus?.getTopicSubscriberCount;
    const liveness = this.#commandHandlerLivenessService;
    if (typeof count !== 'function' && !liveness) {
      await this.#scheduler.wait(5000);
      return true;
    }
    // The raw count includes '*' (wildcard) subscribers — a phone's Media app
    // makes a cold TV look subscribed at once — so a real command handler
    // (fresh liveness for this device) is required as well.
    const ready = () => (typeof count !== 'function' || this.#eventBus.getTopicSubscriberCount(topic) > 0)
      && (!liveness || liveness.isFresh(deviceId));
    const deadline = this.#clock.now() + BRIEF_SUBSCRIBE_TIMEOUT_MS;
    for (;;) {
      if (ready()) return true;
      if (this.#clock.now() >= deadline) return false;
      await this.#scheduler.wait(BRIEF_SUBSCRIBE_POLL_MS);
    }
  }

  #emitProgress(topic, dispatchId, step, status, extra = {}) {
    this.#broadcast({
      topic,
      type: 'wake-progress',
      dispatchId,
      step,
      status,
      steps: STEPS,
      ...(this.#dispatchCorrelation.get(dispatchId) || {}),
      ...extra
    });
  }

  /**
   * After a successful load, subscribe to the exact target's device-state for
   * N seconds. A matching command ack gates the observation; Play then needs
   * target playing state and Add needs a same-owner queue-only revision.
   *
   * Non-blocking: the load() response has already been returned to the caller;
   * this runs asynchronously in the background.
   *
   * @private
   */
  #armReceiverOutcomeWatchdog({
    deviceId, dispatchId, topic, contentQuery, outcomeBaseline,
    commandAcknowledged, appliedAs = null, timeoutMs = 90_000,
    resolvedQueueContentIds = [], prewarmTimedOut = false,
  }) {
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
    //
    // A queue=<program/list> ref (e.g. `office-program`) is never reported by
    // a screen: the screen resolves it through GET /api/v1/queue and reports
    // the concrete item it plays. Arming with the program id alone made every
    // program dispatch a false timeout (2026-09-27..10-03 office morning
    // program). So the play-now confirmation picks a BASIS:
    //   item-action         — the correlated operation is current (unchanged)
    //   resolved-queue      — the current item is one of the queue ids
    //                         resolved through the same queue resolution
    //                         (candidate), or the screen's queue shares items
    //                         with that resolution (queue-overlap — program
    //                         slots like `strategy: rotation` are random per
    //                         resolution, so membership alone can miss)
    //   fresh-owned-playing — nothing concrete could be resolved within the
    //                         prewarm deadline for a queue dispatch (or any
    //                         ref whose prewarm timed out): the first owned
    //                         playing transition AFTER the correlated ack
    //                         with an advanced playback revision vs the
    //                         pre-load snapshot AND a different current item
    //                         (or new session) is this dispatch's playback
    //   requested-id        — a concrete requested id (unchanged)
    const resolvedCandidates = [...new Set([
      contentQuery.prewarmContentId,
      ...resolvedQueueContentIds,
    ].filter(Boolean))];
    const requested = resolveContentId(contentQuery);
    const expectedContentIds = [...new Set([
      ...resolvedCandidates,
      contentQuery.contentId,
      requested?.contentId,
    ].filter(Boolean))];
    if (!expectedContentIds.length) return;
    const expectedContentId = expectedContentIds[0];
    const itemAction = decodeItemAction(contentQuery.itemAction);
    const operation = contentQuery.op === 'add' || appliedAs === 'add' ? 'add' : 'play-now';
    const resultStep = operation === 'add' ? 'queue' : 'playback';
    const resolvedSet = new Set(resolvedCandidates);
    const basis = itemAction ? 'item-action'
      : resolvedSet.size > 0 ? 'resolved-queue'
        : (requested?.resolvedKey === 'queue' || requested?.resolvedKey === 'play-next' || prewarmTimedOut) ? 'fresh-owned-playing'
          : 'requested-id';

    this.#logger.info?.(`wake-and-load.${resultStep}.armed`, {
      deviceId, dispatchId, operation, basis: operation === 'add' ? 'queue-revision' : basis,
      expectedContentId, requestedContentId: requested?.contentId ?? null,
      resolvedCandidates: resolvedSet.size, commandAcknowledged, timeoutMs,
    });

    let resolved = false;
    let timer = null;
    let unsubscribe = null;

    const cleanup = () => {
      resolved = true;
      timer?.();
      if (unsubscribe) unsubscribe();
    };

    const ownerIdentity = (snapshot) => snapshot?.meta?.playbackOwner ?? null;
    const currentIdentity = (snapshot) => ({
      contentId: snapshot?.currentItem?.contentId ?? null,
      queueItemId: snapshot?.currentItem?.queueItemId ?? null,
    });
    const contentMatches = (incoming) => expectedContentIds.some((expected) =>
      incoming === expected || incoming?.startsWith?.(`${expected}:`) || expected.startsWith(`${incoming}:`));

    unsubscribe = this.#eventBus.subscribe(`device-state:${deviceId}`, (payload) => {
      if (resolved) return;
      if (!commandAcknowledged || payload?.deviceId !== deviceId) return;
      const snapshot = payload?.snapshot;
      // Show briefly (RQ-PLAY-11): the screen shows it OVER its programme, so
      // the evidence is the published brief, not a new current item.
      if (appliedAs === 'brief') {
        const brief = snapshot?.controls?.brief;
        if (brief && contentMatches(brief.contentId)) {
          cleanup();
          this.#logger.info?.('wake-and-load.playback.confirmed', { deviceId, dispatchId, contentId: expectedContentId, appliedAs: 'brief' });
          this.#emitProgress(topic, dispatchId, 'playback', 'confirmed', {
            operation: 'brief', contentId: brief.contentId, sessionId: snapshot.sessionId ?? null, ownerId: snapshot.meta?.ownerId ?? null,
          });
        }
        return;
      }
      const owner = ownerIdentity(snapshot) ?? (itemAction ? snapshot?.meta?.queueOwner : null);
      if (!snapshot?.sessionId || !snapshot?.meta?.ownerId || !owner?.ownerInstanceId
        || !Number.isInteger(owner.playbackRevision) || !Number.isInteger(owner.queueRevision)) return;

      let matches = false;
      let matchedBy = null;
      const actionEntries = itemAction ? snapshot.queue?.items?.filter(item => item.itemActionId === itemAction.operationId) ?? [] : [];
      const actionCurrent = itemAction && snapshot.queue?.items?.[snapshot.queue.currentIndex]?.itemActionId === itemAction.operationId;
      if (operation === 'add') {
        const beforeOwner = ownerIdentity(outcomeBaseline) ?? (itemAction ? outcomeBaseline?.meta?.queueOwner : null);
        const beforeCurrent = currentIdentity(outcomeBaseline);
        const afterCurrent = currentIdentity(snapshot);
        const appended = itemAction ? actionEntries.length > 0 : snapshot.queue?.items?.some((item) => contentMatches(item?.contentId));
        matches = !!outcomeBaseline
          && snapshot.sessionId === outcomeBaseline.sessionId
          && snapshot.meta.ownerId === outcomeBaseline.meta?.ownerId
          && owner.ownerInstanceId === beforeOwner?.ownerInstanceId
          && owner.playbackRevision === beforeOwner?.playbackRevision
          && owner.queueRevision > beforeOwner?.queueRevision
          && afterCurrent.contentId === beforeCurrent.contentId
          && afterCurrent.queueItemId === beforeCurrent.queueItemId
          && appended;
        // Cold Add may register its first idle owner. Correlated held queue
        // state proves insertion, but cannot claim playback started.
        if (itemAction && !beforeOwner && !beforeCurrent.contentId) matches = appended && !afterCurrent.contentId
          && ['idle', 'ready'].includes(snapshot.state);
      } else {
        const incoming = snapshot.currentItem?.contentId;
        const beforeOwner = ownerIdentity(outcomeBaseline);
        const ownerAdvanced = !beforeOwner
          || snapshot.sessionId !== outcomeBaseline?.sessionId
          || owner.ownerInstanceId !== beforeOwner.ownerInstanceId
          || owner.playbackRevision > beforeOwner.playbackRevision;
        if (snapshot.state === 'playing' && ownerAdvanced) {
          if (basis === 'item-action') {
            if (actionCurrent) matchedBy = 'item-action';
          } else if (contentMatches(incoming)) {
            matchedBy = 'candidate';
          } else if (basis === 'resolved-queue') {
            const queueIds = (snapshot.queue?.items ?? []).map((item) => item?.contentId).filter(Boolean);
            if (incoming && queueIds.includes(incoming) && queueIds.some((id) => resolvedSet.has(id))) {
              matchedBy = 'queue-overlap';
            }
          } else if (basis === 'fresh-owned-playing') {
            // Player bumps playbackRevision on play/toggle/pause too, so a
            // person resuming the baseline item looks "advanced". Require a
            // different current item or a new session as well.
            const before = currentIdentity(outcomeBaseline);
            const after = currentIdentity(snapshot);
            const differentItem = after.contentId !== before.contentId || after.queueItemId !== before.queueItemId;
            if (differentItem || snapshot.sessionId !== outcomeBaseline?.sessionId) {
              matchedBy = 'fresh-owned-playing';
            }
          }
        }
        matches = !!matchedBy;
      }

      if (matches) {
        cleanup();
        this.#logger.info?.(`wake-and-load.${resultStep}.confirmed`, {
          deviceId, dispatchId,
          contentId: operation === 'add' ? expectedContentId : snapshot.currentItem?.contentId ?? expectedContentId,
          expectedContentId,
          ...(operation === 'add' ? {} : { basis, matchedBy }),
        });
        this.#emitProgress(topic, dispatchId, resultStep, 'confirmed', {
          operation,
          contentId: operation === 'add' ? expectedContentId : snapshot.currentItem?.contentId ?? expectedContentId,
          sessionId: snapshot.sessionId,
          ownerId: snapshot.meta.ownerId,
          ownerInstanceId: owner.ownerInstanceId,
          playbackRevision: owner.playbackRevision,
          queueRevision: owner.queueRevision,
          ...(operation === 'add' ? { queueLength: snapshot.queue.items.length,
            ...(itemAction ? { ordinal: snapshot.queue.items.findIndex(item => item.itemActionId === itemAction.operationId) + 1, count: actionEntries.length } : {}) }
            : (itemAction ? { count: actionEntries.length } : {})),
        });
      }
    });

    timer = this.#scheduler.after(timeoutMs, () => {
      if (resolved) return;
      cleanup();
      this.#logger.warn?.(`wake-and-load.${resultStep}.timeout`, {
        deviceId, dispatchId, expectedContentId, requestedContentId: requested?.contentId ?? null, timeoutMs,
        basis: operation === 'add' ? 'queue-revision' : basis,
        resolvedCandidates: resolvedSet.size, commandAcknowledged,
      });
      this.#emitProgress(topic, dispatchId, resultStep, 'timeout', {
        operation, expectedContentId, timeoutMs,
      });
    });
  }
}

export default WakeAndLoadService;
