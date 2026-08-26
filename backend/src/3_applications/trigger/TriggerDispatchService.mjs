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
 * (its own concerns) with domain ResolverRegistry, then normalizes the
 * resolved intent to a Response (mapIntentToResponse) and dispatches it via
 * the responseHandlers registry (dispatchResponse) + WS broadcast.
 *
 * @module applications/trigger/TriggerDispatchService
 */

import { randomUUID } from 'node:crypto';
import { ResolverRegistry, UnknownModalityError } from '#domains/trigger/services/ResolverRegistry.mjs';
import { dispatchResponse, UnknownResponseKindError } from './responseHandlers.mjs';
import { mapIntentToResponse, UnknownActionError } from './mapIntentToResponse.mjs';
import { authenticate } from './guards/authenticate.mjs';
import { authorize } from './guards/authorize.mjs';
import { gatekeeperStrategies } from './guards/gatekeeperStrategies.mjs';
import { createDebounce } from './guards/debounce.mjs';
import { TriggerEvent } from '#domains/trigger/TriggerEvent.mjs';
import { canonicalizeNfcUid } from '#domains/trigger/nfcUid.mjs';

export class TriggerDispatchService {
  #config;
  #contentIdResolver;
  #deps;
  #tagWriter;
  #onUnknownTag;
  #broadcast;
  #logger;
  #debounce;
  #debounceWindowMs;
  #clock;

  // Per-(intent.target) HA automation guard suppression. When a trigger
  // fires for one of these targets, we disable the named automation for
  // GUARD_SUPPRESS_DURATION_MS so it doesn't kill the TV mid-wake.
  // The Zombie Wake Guard fires on `binary_sensor.living_room_tv_state -> on`
  // and waits 60s before calling script.living_room_tv_off. By disabling
  // it for 90s when our trigger fires, the wake-and-load cycle (~25s) plus
  // settling completes before re-enable, and the guard's trigger never sees
  // the on-edge that would start the kill timer.
  static #GUARD_AUTOMATIONS_BY_TARGET = {
    'livingroom-tv': 'automation.living_room_tv_zombie_wake_guard',
  };
  static #GUARD_SUPPRESS_DURATION_MS = 90_000;

  constructor({
    config,
    contentIdResolver,
    wakeAndLoadService,
    haGateway,
    deviceService,
    tagWriter = null,           // NEW
    contentDispatcher = null,
    // First refusal on a content dispatch, plus the D8 end-behaviour
    // suppression. Whitelisted below like everything else — this is the
    // failure with no symptom: a seam in `responseHandlers.content` and an
    // interceptor handed to composition can both be right while nothing
    // connects them, and the book simply plays.
    contentInterceptors = [],
    screenBroadcast = null,
    commandResolver = null,
    endpointGateway = null,
    learnerActions = null,
    // D9 — told about every NFC tap that resolved to nothing, alongside the
    // observed-registry write and the `notify_unknown` push. It ADDS to those
    // and replaces neither: an unresolvable tag never becomes a content
    // Response, so this is the only point in the pipeline that can tell the
    // screen in front of the child that the book is not known yet.
    onUnknownTag = null,
    broadcast,
    logger = console,
    debounceWindowMs = 30000,
    clock = () => Date.now(),
  }) {
    this.#config = config || {};
    this.#contentIdResolver = contentIdResolver;
    // #deps is an explicit whitelist, not a spread of the constructor args —
    // a dep that is not named here never reaches responseHandlers.
    this.#deps = { wakeAndLoadService, haGateway, deviceService, contentDispatcher, contentInterceptors, screenBroadcast, commandResolver, endpointGateway, learnerActions, logger };
    this.#tagWriter = tagWriter;
    this.#onUnknownTag = onUnknownTag;
    this.#broadcast = broadcast || (() => {});
    this.#logger = logger;
    this.#debounceWindowMs = debounceWindowMs;
    this.#debounce = createDebounce({ windowMs: this.#debounceWindowMs });
    this.#clock = clock;
  }

  #lookupAuthToken(modality, location) {
    return this.#config?.[modality]?.locations?.[location]?.auth_token ?? null;
  }

  // Fire-and-forget HA automation suppression. Disable the guard for the
  // configured target now, schedule re-enable in GUARD_SUPPRESS_DURATION_MS.
  // No-op if no haGateway, no mapping, or the target isn't covered.
  #suppressGuardForTarget(target, dispatchId) {
    const guardEntity = TriggerDispatchService.#GUARD_AUTOMATIONS_BY_TARGET[target];
    if (!guardEntity) return;
    const haGateway = this.#deps.haGateway;
    if (!haGateway?.callService) return;
    const durationMs = TriggerDispatchService.#GUARD_SUPPRESS_DURATION_MS;
    this.#logger.info?.('trigger.guard.suppressed', { target, guardEntity, durationMs, dispatchId });
    Promise.resolve(haGateway.callService('automation', 'turn_off', {
      entity_id: guardEntity,
      stop_actions: true,
    })).catch((err) => {
      this.#logger.warn?.('trigger.guard.disable.failed', { target, guardEntity, error: err?.message, dispatchId });
    });
    setTimeout(() => {
      Promise.resolve(haGateway.callService('automation', 'turn_on', {
        entity_id: guardEntity,
      })).catch((err) => {
        this.#logger.warn?.('trigger.guard.enable.failed', { target, guardEntity, error: err?.message, dispatchId });
      });
    }, durationMs);
  }

  async handleEvent(event, options = {}) {
    const location = event.location;
    const modality = event.source;
    const value = event.value;
    const startedAt = this.#clock();
    const dispatchId = randomUUID();
    // NFC uids canonicalize (case AND separators); everything else only folds
    // case. This is deliberately modality-aware: a barcode may legitimately
    // contain `-` or `_` as part of its value, so stripping separators from one
    // would corrupt it into a different code entirely.
    //
    // It matters beyond lookup — normalizedValue keys the DEBOUNCE below. Left
    // un-canonicalized, one card reported `04_66_9c…` by one reader and
    // `04669C…` by another produced two debounce keys, so a genuine double-tap
    // sailed through as two distinct triggers.
    const normalizedValue = modality === 'nfc'
      ? canonicalizeNfcUid(value)
      : String(value || '').toLowerCase();

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

    const auth = authenticate({ expectedToken: this.#lookupAuthToken(modality, location), providedToken: options.token });
    if (!auth.ok) {
      this.#logger.warn?.('trigger.fired', { location, modality, value: normalizedValue, error: 'auth-failed' });
      return { ok: false, code: 'AUTH_FAILED', error: 'Authentication failed', location, modality, value: normalizedValue, dispatchId };
    }

    // Per-(location, modality, value) debounce. Two failure modes to guard:
    //   (a) HA fires `tag_scanned` 2-3 times per physical tap (sub-second).
    //   (b) Cold-start wake-and-load takes ~25 s with no on-screen feedback,
    //       so users tap again 16-30 s later. Without this guard each scan
    //       spawns a parallel 22-35 s wake-and-load cycle and HA reports
    //       `script.living_room_tv_on: Already running`.
    // 30 s window covers both. Set the key NOW (before dispatching) so
    // concurrent in-flight retries are debounced; success refreshes the key
    // at end (extending the lockout slightly post-success); failure deletes
    // it so the user can retry immediately. dryRun bypasses entirely.
    const debounceKey = `${location}:${modality}:${normalizedValue}`;
    if (!options.dryRun) {
      const { debounced, sinceMs } = this.#debounce.check(debounceKey, startedAt);
      if (debounced) {
        this.#logger.info?.('trigger.debounced', { location, modality, value: normalizedValue, sinceMs, windowMs: this.#debounceWindowMs, dispatchId });
        return { ok: true, debounced: true, location, modality, value: normalizedValue, dispatchId, sinceMs };
      }
      // Lock the key now so concurrent retries during the 25-s wake-and-load
      // window (which won't see the success-side set until we finish) are
      // properly debounced.
      this.#debounce.set(debounceKey, startedAt);
    }

    // Authorize stage — strategies are resolved from the source's `authorize`
    // policy (gatekeeperStrategies). NFC/state locations carry no such policy,
    // so this resolves to [] and authorize() approves unconditionally: a
    // pass-through that doesn't change existing modality behavior.
    if (!options.dryRun) {
      const decision = await authorize({ strategies: gatekeeperStrategies(locationConfig), context: { location, modality, value: normalizedValue } });
      if (!decision.approved) {
        this.#debounce.delete(debounceKey);
        this.#logger.info?.('trigger.denied', { location, modality, value: normalizedValue, reason: decision.reason, dispatchId });
        return { ok: false, code: 'AUTHORIZE_DENIED', error: decision.reason || 'Denied', location, modality, value: normalizedValue, dispatchId };
      }
    }

    let intent;
    try {
      intent = ResolverRegistry.resolve({
        modality,
        location,
        value,
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
      this.#debounce.set(debounceKey, this.#clock());
      return { ok: false, code: 'TRIGGER_NOT_REGISTERED', error: `Trigger not registered: ${normalizedValue}`, location, modality, value: normalizedValue, dispatchId };
    }

    // Normalize resolver output to a Response. NFC/state resolvers return an
    // intent ({action,...}); the barcode resolver returns a (frozen) Response
    // directly. Never mutate the resolver output — build a new object below.
    let response;
    try {
      response = intent.kind ? intent : mapIntentToResponse(intent);
    } catch (err) {
      const code = err instanceof UnknownActionError ? 'UNKNOWN_ACTION' : 'INVALID_INTENT';
      // An action nothing can map is, from the tap's point of view, exactly a
      // tag nobody registered: nothing happens. So give it the same treatment —
      // placeholder write and notify_unknown push — instead of an error that
      // reaches only the log. Without this the unmappable case was WORSE than
      // the unregistered one, because this return sits BELOW the `if (!intent)`
      // branch that does both. (The debounce key is already set before
      // resolution, so repeat taps collapse either way; refreshing it here just
      // keeps the two branches identical.)
      //
      // It matters most for an action configured before its handler ships: the
      // arming event is a one-line YAML edit to a reader in a tree shared with
      // prod, which no test observes and no code comment reaches.
      if (modality === 'nfc') {
        await this.#handleUnknownNfc(location, normalizedValue, locationConfig);
        this.#debounce.set(debounceKey, this.#clock());
      }
      this.#logger.error?.('trigger.fired', { ...baseLog, error: err.message, code });
      this.#emit(location, modality, { ...baseLog, ok: false, error: err.message });
      return { ok: false, code, error: err.message, location, modality, value: normalizedValue, dispatchId };
    }

    // Derive a human-readable action + target for logging across every kind.
    const logAction = response.expression?.action ?? response.op ?? response.command ?? response.action ?? response.kind;
    const target = response.target ?? null;
    const summary = { location, modality, value: normalizedValue, action: logAction, target, dispatchId };

    if (options.dryRun) {
      this.#logger.info?.('trigger.fired', { ...baseLog, action: logAction, target, dryRun: true });
      this.#emit(location, modality, { ...summary, dryRun: true });
      return { ok: true, dryRun: true, ...summary, response };
    }

    // Suppress the Zombie Wake Guard (or any per-target guard) for the duration
    // of the wake-and-load cycle. Fire-and-forget — don't block dispatch on it.
    //
    // CONTENT ONLY. The guard exists because wake-and-load takes ~25s and the
    // automation would kill the TV mid-wake; nothing else here wakes a target.
    // Applied unconditionally it fired on the learner refusal too — the living
    // room's `livingroom-tv` is the one guarded target — so the tap whose whole
    // promise is that it changes nothing disabled a TV safety automation for 90
    // seconds. A refusal must not reach Home Assistant.
    if (response.kind === 'content') this.#suppressGuardForTarget(target, dispatchId);

    try {
      const dispatchResult = await dispatchResponse({ ...response, dispatchId }, this.#deps);
      const elapsedMs = this.#clock() - startedAt;
      // A handler that ANSWERS instead of throwing can still have failed, and
      // the release-on-failure below is reachable only by a thrown error. So a
      // handler is allowed to say so: `retryable` releases the same lockout the
      // catch does. Without it a learner action whose receipt says "Try
      // scanning again" locks the child out for the full window, and the retry
      // it asked for is swallowed with the handler never invoked.
      if (dispatchResult?.retryable) this.#debounce.delete(debounceKey);
      else this.#debounce.set(debounceKey, this.#clock());
      this.#logger.info?.('trigger.fired', { ...baseLog, action: logAction, target, ok: true, elapsedMs });
      this.#emit(location, modality, { ...summary, ok: true });
      return { ok: true, ...summary, dispatch: dispatchResult, elapsedMs };
    } catch (err) {
      const elapsedMs = this.#clock() - startedAt;
      // On failure, ensure no debounce entry persists — user should be
      // able to retry without waiting out the window.
      this.#debounce.delete(debounceKey);
      const code = (err instanceof UnknownResponseKindError || err instanceof UnknownActionError) ? 'UNKNOWN_ACTION' : 'DISPATCH_FAILED';
      this.#logger.error?.('trigger.fired', { ...baseLog, action: logAction, target, ok: false, error: err.message, code, elapsedMs });
      this.#emit(location, modality, { ...summary, ok: false, error: err.message });
      return { ok: false, code, error: err.message, ...summary, elapsedMs };
    }
  }

  async handleTrigger(location, modality, value, options = {}) {
    return this.handleEvent(TriggerEvent.create({ source: modality, location, value }), options);
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
    // FIRST, and above every early return below. The "named but unmapped" tag
    // returns out of the registry write two lines down, and there is still a
    // child standing at the reader who tapped a book. Wrapped because this
    // runs on the tap path with nothing to await it, and the observer is a
    // courtesy — the registry write and the push are the part that gets the
    // book enrolled, and neither may be lost to it.
    try {
      this.#onUnknownTag?.({ location, uid, modality: 'nfc' });
    } catch (err) {
      this.#logger.warn?.('trigger.unknown_tag.observer_failed', {
        location, uid, error: err?.message ?? String(err),
      });
    }

    const entry = this.#config?.nfc?.tags?.[uid];
    const hasNote = typeof entry?.global?.note === 'string' && entry.global.note.length > 0;
    if (entry && hasNote) return;

    if (this.#tagWriter) {
      try {
        await this.#tagWriter.recordObserved(uid, this.#formatScannedAt(this.#clock()));
        this.#logger.debug?.('trigger.observed_recorded', { location, uid });
      } catch (err) {
        this.#logger.error?.('trigger.observed_recorded.failed', { location, uid, error: err.message });
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
