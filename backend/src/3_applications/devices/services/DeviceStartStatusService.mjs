/**
 * DeviceStartStatusService — per-screen start progress and last failure,
 * visible to every device (RQ-HOUSE-04).
 *
 * WakeAndLoadService already publishes a `wake-progress` step stream on
 * `homeline:<deviceId>`, but only the dispatching client correlates it (by its
 * own dispatchId) and a late subscriber sees nothing. This service observes
 * that stream on the event bus, folds it into one compact status per device,
 * and publishes it on `device-start:<deviceId>` (replayed to new subscribers by
 * the WebSocket event bus, and readable at GET /device/:id/start-status).
 *
 * Phases: starting → delivered (content reached the screen) → started
 * (playback confirmed) | failed (a step failed, or playback was never
 * confirmed). `lastFailure` survives later attempts until one is started.
 *
 * @module applications/devices/services
 */
import { buildDeviceStartStatus } from '#shared-contracts/media/sessionControls.mjs';

const DEFAULT_STALE_AFTER_MS = 120_000;
const TERMINAL = new Set(['failed', 'timeout', 'confirmed']);

export class DeviceStartStatusService {
  #gateway; #clock; #logger; #staleAfterMs;
  /** @type {Map<string, object>} */
  #statuses = new Map();
  #unsubscribe = null;

  /**
   * @param {Object} deps
   * @param {{ subscribeWakeProgress(listener: (deviceId: string, event: object) => void): Function,
   *           publishStartStatus(deviceId: string, status: object): void }} deps.progressGateway
   */
  constructor({ progressGateway, clock = Date, logger = console, staleAfterMs = DEFAULT_STALE_AFTER_MS } = {}) {
    if (typeof progressGateway?.subscribeWakeProgress !== 'function' || typeof progressGateway?.publishStartStatus !== 'function') {
      throw new TypeError('DeviceStartStatusService requires a progressGateway');
    }
    this.#gateway = progressGateway;
    this.#clock = clock;
    this.#logger = logger;
    this.#staleAfterMs = staleAfterMs;
  }

  start() {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.#gateway.subscribeWakeProgress((deviceId, payload) => this.#handle(deviceId, payload));
    this.#logger.info?.('device-start-status.start');
  }

  stop() {
    try { this.#unsubscribe?.(); } catch { /* best effort */ }
    this.#unsubscribe = null;
  }

  /** Current status for a device (with `stale` computed now), or null. */
  get(deviceId) {
    const status = this.#statuses.get(deviceId);
    if (!status) return null;
    const terminal = status.phase === 'started' || status.phase === 'failed';
    const age = this.#clock.now() - Date.parse(status.updatedAt);
    return { ...status, stale: !terminal && age > this.#staleAfterMs };
  }

  knownDeviceIds() {
    return [...this.#statuses.keys()];
  }

  #handle(deviceId, payload) {
    if (!deviceId || payload?.type !== 'wake-progress') return;
    const { dispatchId = null, step = null, status: stepStatus = null } = payload;
    const previous = this.#statuses.get(deviceId) ?? null;

    // A terminal event from a dispatch that is no longer current must not
    // overwrite the newer attempt (a late 90s playback timeout, typically).
    if (previous && dispatchId && previous.dispatchId && dispatchId !== previous.dispatchId && TERMINAL.has(stepStatus)) {
      this.#logger.debug?.('device-start-status.superseded-event', { deviceId, dispatchId, current: previous.dispatchId, stepStatus });
      return;
    }

    const at = new Date(this.#clock.now()).toISOString();
    let phase = 'starting';
    let error = null;
    if (stepStatus === 'failed') {
      phase = 'failed';
      error = String(payload.error ?? payload.reason ?? `${step ?? 'start'} failed`);
    } else if (stepStatus === 'timeout') {
      phase = 'failed';
      error = step === 'queue' ? 'The screen did not confirm the queue change' : 'The screen did not confirm playback';
    } else if (stepStatus === 'confirmed') {
      phase = 'started';
    } else if (step === 'load' && stepStatus === 'done') {
      phase = 'delivered';
    }

    let lastFailure = previous?.lastFailure ?? null;
    if (phase === 'failed') lastFailure = { dispatchId, step, error, at };
    if (phase === 'started') lastFailure = null;

    const status = buildDeviceStartStatus({
      deviceId, dispatchId, phase, step, stepStatus, error,
      contentId: payload.contentId ?? payload.expectedContentId ?? previous?.contentId ?? null,
      lastFailure, updatedAt: at,
    });
    this.#statuses.set(deviceId, status);

    if (phase !== previous?.phase || dispatchId !== previous?.dispatchId) {
      this.#logger[phase === 'failed' ? 'warn' : 'info']?.('device-start-status.changed', {
        deviceId, dispatchId, phase, step, stepStatus, ...(error ? { error } : {}),
      });
    }
    try {
      this.#gateway.publishStartStatus(deviceId, status);
    } catch (err) {
      this.#logger.warn?.('device-start-status.broadcast-failed', { deviceId, error: err?.message });
    }
  }
}

export default DeviceStartStatusService;
