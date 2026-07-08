/**
 * PianoMidiWakeService factory — reads the piano app config's `midi_wake` block
 * and, when enabled, constructs + starts the service that wakes the piano tablet's
 * FKB backlight on a BLE-MIDI note (via the always-on piano-bridge WS fan-out).
 *
 * Mirrors bootstrap/pianoScreenPowerSync. DISABLED BY DEFAULT — nothing connects
 * until `midi_wake.enabled: true` in `config/piano.yml`.
 *
 * @module 5_composition/modules/pianoMidiWake
 */

import { PianoMidiWakeService } from '#apps/devices/services/PianoMidiWakeService.mjs';

/** @type {PianoMidiWakeService | null} */
let instance = null;

/**
 * @param {Object} config
 * @param {{get:Function}} config.deviceService
 * @param {Object} config.configService - ConfigService (getHouseholdAppConfig)
 * @param {string|null} [config.householdId]
 * @param {Object} [config.logger]
 * @returns {{ pianoMidiWakeService: PianoMidiWakeService|null }}
 */
export function createPianoMidiWake({
  deviceService, configService, householdId = null, logger = console,
} = {}) {
  if (instance) {
    logger.warn?.('piano-midi-wake.already_created');
    return { pianoMidiWakeService: instance };
  }

  const cfg = configService?.getHouseholdAppConfig?.(householdId, 'piano')?.midi_wake;
  if (!cfg?.enabled) {
    logger.info?.('piano-midi-wake.disabled', { enabled: !!cfg?.enabled });
    return { pianoMidiWakeService: null };
  }

  if (!deviceService || typeof deviceService.get !== 'function') {
    logger.warn?.('piano-midi-wake.skipped_no_device_service');
    return { pianoMidiWakeService: null };
  }

  const deviceId = cfg.device_id || cfg.deviceId;
  const bridgeUrl = cfg.bridge_url || cfg.bridgeUrl;
  if (!deviceId || !bridgeUrl) {
    logger.warn?.('piano-midi-wake.skipped_missing_config', {
      deviceId: deviceId || null, bridgeUrl: bridgeUrl || null,
    });
    return { pianoMidiWakeService: null };
  }

  // Guard: the target device must exist in the registry, else no-op (don't crash startup).
  if (!deviceService.get(deviceId)) {
    logger.warn?.('piano-midi-wake.skipped_unknown_device', { deviceId });
    return { pianoMidiWakeService: null };
  }

  const service = new PianoMidiWakeService({
    deviceService,
    logger,
    deviceId,
    bridgeUrl,
    cooldownMs: cfg.cooldown_ms ?? cfg.cooldownMs,
  });
  service.start();
  instance = service;
  logger.info?.('piano-midi-wake.created', { deviceId, bridgeUrl });
  return { pianoMidiWakeService: service };
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  if (instance) { try { instance.stop(); } catch { /* ignore */ } }
  instance = null;
}
