/**
 * TriggerDispatchService — orchestrates a single trigger event from API to
 * dispatched action. Modality-agnostic: location-rooted config keyed by
 * `(location, type, value)` where `type` chooses which entries map to read.
 * @module applications/trigger/TriggerDispatchService
 */

import { randomUUID } from 'node:crypto';
import { resolveIntent } from '#domains/trigger/TriggerIntent.mjs';
import { dispatchAction, UnknownActionError } from './actionHandlers.mjs';

export class TriggerDispatchService {
  #config;
  #contentIdResolver;
  #deps;
  #broadcast;
  #logger;
  #recentDispatches;   // Map<key, timestampMs>
  #debounceWindowMs;
  #clock;

  constructor({
    config,
    contentIdResolver,
    wakeAndLoadService,
    haGateway,
    deviceService,
    broadcast,
    logger = console,
    debounceWindowMs = 3000,
    clock = () => Date.now(),
  }) {
    this.#config = config || {};
    this.#contentIdResolver = contentIdResolver;
    this.#deps = { wakeAndLoadService, haGateway, deviceService };
    this.#broadcast = broadcast || (() => {});
    this.#logger = logger;
    this.#recentDispatches = new Map();
    this.#debounceWindowMs = debounceWindowMs;
    this.#clock = clock;
  }

  // Map cleanup avoids unbounded growth: every check prunes anything older
  // than the window. With a small number of triggers per location and a
  // 3 s window this is effectively O(N_active_keys) per call.
  #pruneDispatches(now) {
    for (const [key, ts] of this.#recentDispatches) {
      if (now - ts > this.#debounceWindowMs) this.#recentDispatches.delete(key);
    }
  }

  async handleTrigger(location, modality, value, options = {}) {
    const startedAt = this.#clock();
    const dispatchId = randomUUID();
    const normalizedValue = String(value || '').toLowerCase();
    const locationConfig = this.#config[location];

    if (!locationConfig) {
      this.#logger.warn?.('trigger.fired', { location, modality, value: normalizedValue, registered: false, error: 'location-not-found' });
      return { ok: false, code: 'LOCATION_NOT_FOUND', error: `Unknown location: ${location}`, location, modality, value: normalizedValue, dispatchId };
    }

    if (locationConfig.auth_token && locationConfig.auth_token !== options.token) {
      this.#logger.warn?.('trigger.fired', { location, modality, value: normalizedValue, error: 'auth-failed' });
      return { ok: false, code: 'AUTH_FAILED', error: 'Authentication failed', location, modality, value: normalizedValue, dispatchId };
    }

    // Per-(location, modality, value) debounce. HA fires `tag_scanned` 2-3
    // times per physical tap; without this guard each one spawns a fresh
    // 22-35 s wake-and-load cycle. dryRun requests bypass to keep the
    // debugging path simple. Failed dispatches reset the entry below so
    // the user can immediately retry.
    const debounceKey = `${location}:${modality}:${normalizedValue}`;
    if (!options.dryRun) {
      this.#pruneDispatches(startedAt);
      const lastTs = this.#recentDispatches.get(debounceKey);
      if (lastTs != null && startedAt - lastTs < this.#debounceWindowMs) {
        const sinceMs = startedAt - lastTs;
        this.#logger.info?.('trigger.debounced', { location, modality, value: normalizedValue, sinceMs, windowMs: this.#debounceWindowMs, dispatchId });
        return { ok: true, debounced: true, location, modality, value: normalizedValue, dispatchId, sinceMs };
      }
    }

    const valueEntry = locationConfig.entries?.[modality]?.[normalizedValue];
    const baseLog = { location, modality, value: normalizedValue, registered: !!valueEntry, dispatchId };

    if (!valueEntry) {
      this.#logger.info?.('trigger.fired', { ...baseLog, error: 'trigger-not-registered' });
      this.#emit(location, modality, baseLog);
      return { ok: false, code: 'TRIGGER_NOT_REGISTERED', error: `Trigger not registered: ${normalizedValue}`, location, modality, value: normalizedValue, dispatchId };
    }

    let intent;
    try {
      intent = resolveIntent(locationConfig, valueEntry, this.#contentIdResolver);
      intent.dispatchId = dispatchId;
    } catch (err) {
      this.#logger.error?.('trigger.fired', { ...baseLog, error: err.message });
      this.#emit(location, modality, { ...baseLog, ok: false, error: err.message });
      return { ok: false, code: 'INVALID_INTENT', error: err.message, location, modality, value: normalizedValue, dispatchId };
    }

    const summary = { location, modality, value: normalizedValue, action: intent.action, target: intent.target, dispatchId };

    if (options.dryRun) {
      this.#logger.info?.('trigger.fired', { ...baseLog, action: intent.action, target: intent.target, dryRun: true });
      this.#emit(location, modality, { ...summary, dryRun: true });
      return { ok: true, dryRun: true, ...summary, intent };
    }

    try {
      const dispatchResult = await dispatchAction(intent, this.#deps);
      const elapsedMs = this.#clock() - startedAt;
      if (!options.dryRun) {
        this.#recentDispatches.set(debounceKey, this.#clock());
      }
      this.#logger.info?.('trigger.fired', { ...baseLog, action: intent.action, target: intent.target, ok: true, elapsedMs });
      this.#emit(location, modality, { ...summary, ok: true });
      return { ok: true, ...summary, dispatch: dispatchResult, elapsedMs };
    } catch (err) {
      const elapsedMs = this.#clock() - startedAt;
      // On failure, ensure no debounce entry persists — user should be
      // able to retry without waiting out the window.
      this.#recentDispatches.delete(debounceKey);
      const code = err instanceof UnknownActionError ? 'UNKNOWN_ACTION' : 'DISPATCH_FAILED';
      this.#logger.error?.('trigger.fired', { ...baseLog, action: intent.action, target: intent.target, ok: false, error: err.message, code, elapsedMs });
      this.#emit(location, modality, { ...summary, ok: false, error: err.message });
      return { ok: false, code, error: err.message, ...summary, elapsedMs };
    }
  }

  #emit(location, modality, payload) {
    // Payload's `modality` field is the trigger source (nfc, barcode, etc.).
    // The outer `type` is the event kind ('trigger.fired') that subscribers
    // listen for. Topic stays `trigger:<location>:<modality>` as a routing key.
    this.#broadcast({ topic: `trigger:${location}:${modality}`, ...payload, type: 'trigger.fired' });
  }
}

export default TriggerDispatchService;
