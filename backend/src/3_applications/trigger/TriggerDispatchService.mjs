/**
 * TriggerDispatchService — orchestrates a single trigger event from API to
 * dispatched action. Modality-agnostic via ResolverRegistry (domain service).
 *
 * Config shape (produced by buildTriggerRegistry):
 *   { [modality]: <modality-specific registry slice> }
 *   e.g. {
 *     nfc:   { locations: { [location]: { target, action, auth_token, defaults } }, tags: { [uid]: { global, overrides } } },
 *     state: { locations: { [location]: { target, auth_token, states: { [val]: { action } } } } },
 *   }
 *
 * Auth token is looked up per (modality, location) from
 * config[modality].locations[location].auth_token. This keeps each modality
 * slice self-contained and avoids cross-modality coupling.
 *
 * Layer: APPLICATION (3_applications/trigger). Coordinates auth/debounce
 * (its own concerns) with domain ResolverRegistry and actionHandlers + WS
 * broadcast.
 *
 * @module applications/trigger/TriggerDispatchService
 */

import { randomUUID } from 'node:crypto';
import { ResolverRegistry, UnknownModalityError } from '#domains/trigger/services/ResolverRegistry.mjs';
import { dispatchAction, UnknownActionError } from './actionHandlers.mjs';

export class TriggerDispatchService {
  #config;
  #contentIdResolver;
  #deps;
  #tagWriter;
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
    tagWriter = null,           // NEW
    broadcast,
    logger = console,
    debounceWindowMs = 3000,
    clock = () => Date.now(),
  }) {
    this.#config = config || {};
    this.#contentIdResolver = contentIdResolver;
    this.#deps = { wakeAndLoadService, haGateway, deviceService };
    this.#tagWriter = tagWriter;
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

  #lookupAuthToken(modality, location) {
    return this.#config?.[modality]?.locations?.[location]?.auth_token ?? null;
  }

  async handleTrigger(location, modality, value, options = {}) {
    const startedAt = this.#clock();
    const dispatchId = randomUUID();
    const normalizedValue = String(value || '').toLowerCase();

    // Modality slice check — must come before auth so unknown modalities get
    // a clear error code rather than a misleading LOCATION_NOT_FOUND.
    const modalityConfig = this.#config?.[modality];
    if (!modalityConfig) {
      this.#logger.warn?.('trigger.fired', { location, modality, value: normalizedValue, registered: false, error: 'unknown-modality' });
      return { ok: false, code: 'UNKNOWN_MODALITY', error: `Unknown modality: ${modality}`, location, modality, value: normalizedValue, dispatchId };
    }

    // Location check within the modality slice.
    const locationConfig = modalityConfig.locations?.[location];
    if (!locationConfig) {
      this.#logger.warn?.('trigger.fired', { location, modality, value: normalizedValue, registered: false, error: 'location-not-found' });
      return { ok: false, code: 'LOCATION_NOT_FOUND', error: `Unknown location: ${location}`, location, modality, value: normalizedValue, dispatchId };
    }

    const authToken = this.#lookupAuthToken(modality, location);
    if (authToken && authToken !== options.token) {
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

    let intent;
    try {
      intent = ResolverRegistry.resolve({
        modality,
        location,
        value: normalizedValue,
        registry: this.#config,
        contentIdResolver: this.#contentIdResolver,
      });
    } catch (err) {
      const code = err instanceof UnknownModalityError ? 'UNKNOWN_MODALITY' : 'INVALID_INTENT';
      this.#logger.error?.('trigger.fired', { location, modality, value: normalizedValue, error: err.message, dispatchId });
      this.#emit(location, modality, { location, modality, value: normalizedValue, dispatchId, ok: false, error: err.message });
      return { ok: false, code, error: err.message, location, modality, value: normalizedValue, dispatchId };
    }

    const baseLog = { location, modality, value: normalizedValue, registered: !!intent, dispatchId };

    if (!intent) {
      if (modality === 'nfc') {
        await this.#handleUnknownNfc(location, normalizedValue, locationConfig);
      }
      this.#logger.info?.('trigger.fired', { ...baseLog, error: 'trigger-not-registered' });
      this.#emit(location, modality, baseLog);
      // Extend debounce to the unknown branch so HA's 2-3 duplicate fires
      // per physical tap collapse to a single placeholder write + notify.
      this.#recentDispatches.set(debounceKey, this.#clock());
      return { ok: false, code: 'TRIGGER_NOT_REGISTERED', error: `Trigger not registered: ${normalizedValue}`, location, modality, value: normalizedValue, dispatchId };
    }

    intent.dispatchId = dispatchId;
    const summary = { location, modality, value: normalizedValue, action: intent.action, target: intent.target, dispatchId };

    if (options.dryRun) {
      this.#logger.info?.('trigger.fired', { ...baseLog, action: intent.action, target: intent.target, dryRun: true });
      this.#emit(location, modality, { ...summary, dryRun: true });
      return { ok: true, dryRun: true, ...summary, intent };
    }

    try {
      const dispatchResult = await dispatchAction(intent, this.#deps);
      const elapsedMs = this.#clock() - startedAt;
      this.#recentDispatches.set(debounceKey, this.#clock());
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

  #emit(location, modality, payload, type = 'trigger.fired') {
    // Payload's `modality` field is the trigger source (nfc, barcode, etc.).
    // The outer `type` is the event kind that subscribers listen for.
    // Topic stays `trigger:<location>:<modality>` as a routing key.
    this.#broadcast({ topic: `trigger:${location}:${modality}`, ...payload, type });
  }

  /**
   * Set the freeform `note:` field on a tag entry. Idempotent upsert via
   * the injected tagWriter. Used by the iOS Companion REPLY action that
   * routes through HA → PUT /api/v1/trigger/<loc>/<modality>/<value>/note.
   *
   * @param {string} location
   * @param {string} modality   only 'nfc' supported today
   * @param {string} value      tag UID (will be lowercased)
   * @param {string} note       freeform user-supplied name (1..200 chars)
   * @param {Object} [options]
   * @param {string} [options.token] auth token for the location, if configured
   */
  async setNote(location, modality, value, note, options = {}) {
    if (modality !== 'nfc') {
      return { ok: false, code: 'UNSUPPORTED_MODALITY', error: `setNote only supports nfc modality (got "${modality}")` };
    }

    const locationConfig = this.#config?.nfc?.locations?.[location];
    if (!locationConfig) {
      return { ok: false, code: 'LOCATION_NOT_FOUND', error: `Unknown location: ${location}` };
    }

    const authToken = locationConfig.auth_token ?? null;
    if (authToken && authToken !== options.token) {
      return { ok: false, code: 'AUTH_FAILED', error: 'Authentication failed' };
    }

    if (typeof note !== 'string' || note.length === 0 || note.length > 200) {
      return { ok: false, code: 'INVALID_NOTE', error: 'note must be a non-empty string of at most 200 characters' };
    }

    if (!this.#tagWriter) {
      return { ok: false, code: 'NOTE_WRITE_FAILED', error: 'tagWriter not configured' };
    }

    const normalizedValue = String(value).toLowerCase();
    const scannedAtIfNew = this.#formatScannedAt(this.#clock());

    try {
      const result = await this.#tagWriter.setNfcNote(normalizedValue, note, scannedAtIfNew);
      this.#emit(location, modality, {
        location, modality, value: normalizedValue, note,
      }, 'trigger.note_set');
      this.#logger.info?.('trigger.note_set', { location, modality, value: normalizedValue, created: result.created });
      return { ok: true, location, modality, value: normalizedValue, note, created: result.created };
    } catch (err) {
      this.#logger.error?.('trigger.note_set.failed', { location, modality, value: normalizedValue, error: err.message });
      return { ok: false, code: 'NOTE_WRITE_FAILED', error: err.message };
    }
  }

  /**
   * Handle a scan of an NFC tag that didn't resolve. Lifecycle is derived
   * from the current YAML entry (no explicit pending flag). Notification
   * failures are logged but never fail the GET response.
   *
   * - state 0 (no entry):           write placeholder + notify (if configured)
   * - state 1 (placeholder, no note): notify (if configured), no write
   * - state 2 (has note, no intent): silent (caller already broadcasts)
   *
   * State 3 is unreachable here — the resolver would have produced an intent.
   */
  async #handleUnknownNfc(location, uid, locationConfig) {
    const entry = this.#config?.nfc?.tags?.[uid];
    const hasNote = typeof entry?.global?.note === 'string' && entry.global.note.length > 0;
    if (entry && hasNote) return;

    if (this.#tagWriter) {
      try {
        await this.#tagWriter.upsertNfcPlaceholder(uid, this.#formatScannedAt(this.#clock()));
        this.#logger.debug?.('trigger.placeholder_created', { location, uid });
      } catch (err) {
        this.#logger.error?.('trigger.placeholder.failed', { location, uid, error: err.message });
      }
    }

    const notifyService = locationConfig.notify_unknown;
    if (!notifyService) return;

    const payload = {
      title: `Unknown NFC tag at ${location}`,
      message: `Tap "Add note" to name tag ${uid}`,
      data: {
        actions: [{
          action: `NFC_REPLY|${location}|${uid}`,
          title: 'Add note',
          behavior: 'textInput',
          textInputButtonTitle: 'Save',
          textInputPlaceholder: 'Tag name',
        }],
      },
    };
    try {
      await this.#deps.haGateway.callService('notify', notifyService, payload);
    } catch (err) {
      this.#logger.error?.('trigger.notify.failed', { location, uid, service: notifyService, error: err.message });
    }
  }

  #formatScannedAt(ms) {
    return new Date(ms).toLocaleString('sv-SE', { hour12: false });
  }
}

export default TriggerDispatchService;
