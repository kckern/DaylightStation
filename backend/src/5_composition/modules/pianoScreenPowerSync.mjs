/**
 * PianoScreenAuthorityService factory — reads the piano app config's
 * `screen_power_sync` block and, when enabled, constructs + starts the service
 * that reconciles the piano tablet's FKB screen to the piano's real power.
 *
 * Mirrors bootstrap/screenPresence. DISABLED BY DEFAULT — this touches a physical
 * screen, so nothing changes on-device until `screen_power_sync.enabled: true` is
 * set in `config/piano.yml` (design slice 4: on-device verification).
 *
 * @module 5_composition/modules/pianoScreenPowerSync
 */

import { PianoScreenAuthorityService } from '#apps/devices/services/PianoScreenAuthorityService.mjs';

/** @type {PianoScreenAuthorityService | null} */
let instance = null;

/**
 * @param {Object} config
 * @param {{getState:Function, callService:Function}|null} config.haGateway
 * @param {{get:Function}} config.deviceService
 * @param {Object} config.configService - ConfigService (getHouseholdAppConfig)
 * @param {string|null} [config.householdId]
 * @param {Object} [config.logger]
 * @param {{now:()=>number}} [config.clock]
 * @returns {{ pianoScreenAuthorityService: PianoScreenAuthorityService|null }}
 */
export function createPianoScreenPowerSync({
  haGateway, deviceService, configService, householdId = null, logger = console, clock,
} = {}) {
  if (instance) {
    logger.warn?.('piano-screen-authority.already_created');
    return { pianoScreenAuthorityService: instance };
  }

  const cfg = configService?.getHouseholdAppConfig?.(householdId, 'piano')?.screen_power_sync;
  if (!cfg?.enabled) {
    logger.info?.('piano-screen-authority.disabled', { enabled: !!cfg?.enabled });
    return { pianoScreenAuthorityService: null };
  }

  if (!haGateway || typeof haGateway.getState !== 'function') {
    logger.warn?.('piano-screen-authority.skipped_no_ha_gateway');
    return { pianoScreenAuthorityService: null };
  }
  if (!deviceService || typeof deviceService.get !== 'function') {
    logger.warn?.('piano-screen-authority.skipped_no_device_service');
    return { pianoScreenAuthorityService: null };
  }

  const deviceId = cfg.device_id || cfg.deviceId;
  const pianoPowerEntity = cfg.piano_power_entity || cfg.pianoPowerEntity;
  if (!deviceId || !pianoPowerEntity) {
    logger.warn?.('piano-screen-authority.skipped_missing_config', {
      deviceId: deviceId || null, pianoPowerEntity: pianoPowerEntity || null,
    });
    return { pianoScreenAuthorityService: null };
  }

  // Guard: the target device must exist in the registry, else no-op (don't crash startup).
  if (!deviceService.get(deviceId)) {
    logger.warn?.('piano-screen-authority.skipped_unknown_device', { deviceId });
    return { pianoScreenAuthorityService: null };
  }

  const service = new PianoScreenAuthorityService({
    haGateway,
    deviceService,
    logger,
    clock,
    deviceId,
    pianoPowerEntity,
    pollIntervalMs: cfg.poll_interval_ms ?? cfg.pollIntervalMs,
    offDebounceMs: cfg.off_debounce_ms ?? cfg.offDebounceMs,
    reconcileIntervalMs: cfg.reconcile_interval_ms ?? cfg.reconcileIntervalMs,
    maxRetries: cfg.max_retries ?? cfg.maxRetries,
    notifyService: cfg.notify_service ?? cfg.notifyService ?? null,
  });
  service.start();
  instance = service;
  logger.info?.('piano-screen-authority.created', { deviceId, pianoPowerEntity });
  return { pianoScreenAuthorityService: service };
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  if (instance) { try { instance.stop(); } catch { /* ignore */ } }
  instance = null;
}
