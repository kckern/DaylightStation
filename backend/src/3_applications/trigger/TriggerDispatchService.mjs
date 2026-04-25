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

  constructor({ config, contentIdResolver, wakeAndLoadService, haGateway, deviceService, broadcast, logger = console }) {
    this.#config = config || {};
    this.#contentIdResolver = contentIdResolver;
    this.#deps = { wakeAndLoadService, haGateway, deviceService };
    this.#broadcast = broadcast || (() => {});
    this.#logger = logger;
  }

  async handleTrigger(location, type, value, options = {}) {
    const startedAt = Date.now();
    const dispatchId = randomUUID();
    const normalizedValue = String(value || '').toLowerCase();
    const locationConfig = this.#config[location];

    if (!locationConfig) {
      this.#logger.warn?.('trigger.fired', { location, type, value: normalizedValue, registered: false, error: 'location-not-found' });
      return { ok: false, code: 'LOCATION_NOT_FOUND', error: `Unknown location: ${location}`, location, type, value: normalizedValue, dispatchId };
    }

    if (locationConfig.auth_token && locationConfig.auth_token !== options.token) {
      this.#logger.warn?.('trigger.fired', { location, type, value: normalizedValue, error: 'auth-failed' });
      return { ok: false, code: 'AUTH_FAILED', error: 'Authentication failed', location, type, value: normalizedValue, dispatchId };
    }

    const valueEntry = locationConfig.entries?.[normalizedValue];
    const baseLog = { location, type, value: normalizedValue, registered: !!valueEntry, dispatchId };

    if (!valueEntry) {
      this.#logger.info?.('trigger.fired', { ...baseLog, error: 'trigger-not-registered' });
      this.#emit(location, type, baseLog);
      return { ok: false, code: 'TRIGGER_NOT_REGISTERED', error: `Trigger not registered: ${normalizedValue}`, location, type, value: normalizedValue, dispatchId };
    }

    let intent;
    try {
      intent = resolveIntent(locationConfig, valueEntry, this.#contentIdResolver);
      intent.dispatchId = dispatchId;
    } catch (err) {
      this.#logger.error?.('trigger.fired', { ...baseLog, error: err.message });
      this.#emit(location, type, { ...baseLog, ok: false, error: err.message });
      return { ok: false, code: 'INVALID_INTENT', error: err.message, location, type, value: normalizedValue, dispatchId };
    }

    const summary = { location, type, value: normalizedValue, action: intent.action, target: intent.target, dispatchId };

    if (options.dryRun) {
      this.#logger.info?.('trigger.fired', { ...baseLog, action: intent.action, target: intent.target, dryRun: true });
      this.#emit(location, type, { ...summary, dryRun: true });
      return { ok: true, dryRun: true, ...summary, intent };
    }

    try {
      const dispatchResult = await dispatchAction(intent, this.#deps);
      const elapsedMs = Date.now() - startedAt;
      this.#logger.info?.('trigger.fired', { ...baseLog, action: intent.action, target: intent.target, ok: true, elapsedMs });
      this.#emit(location, type, { ...summary, ok: true });
      return { ok: true, ...summary, dispatch: dispatchResult, elapsedMs };
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const code = err instanceof UnknownActionError ? 'UNKNOWN_ACTION' : 'DISPATCH_FAILED';
      this.#logger.error?.('trigger.fired', { ...baseLog, action: intent.action, target: intent.target, ok: false, error: err.message, code, elapsedMs });
      this.#emit(location, type, { ...summary, ok: false, error: err.message });
      return { ok: false, code, error: err.message, ...summary, elapsedMs };
    }
  }

  #emit(location, type, payload) {
    // Spread `payload` first so its `type` (the modality) is overwritten by the
    // event-kind `type: 'trigger.fired'` that subscribers listen for.
    this.#broadcast({ topic: `trigger:${location}:${type}`, ...payload, type: 'trigger.fired' });
  }
}

export default TriggerDispatchService;
