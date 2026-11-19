/**
 * PianoMidiWakeService factory — reads the piano app config's `midi_wake` block
 * and, when enabled, constructs + starts the service that wakes the piano tablet's
 * FKB backlight on a BLE-MIDI note (via the always-on piano-bridge WS fan-out).
 *
 * Mirrors bootstrap/pianoScreenPowerSync. DISABLED BY DEFAULT — nothing connects
 * until `midi_wake.enabled: true` in `household/piano/config.yml`.
 *
 * @module 5_composition/modules/pianoMidiWake
 */

import { PianoMidiWakeService } from "../application/services/PianoMidiWakeService.mjs";
import { PianoMidiBridgeAdapter } from "../adapters/bridge/PianoMidiBridgeAdapter.mjs";
import { resolvePianoBridgeEndpoint, PIANO_BRIDGE } from "./bridge-endpoint.mjs";
import { getPianoWakeHoldSync } from "./wake-hold-sync.mjs";


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
  bridgeFactory = (options) => new PianoMidiBridgeAdapter(options),
  getScreenOverrideService,
} = {}) {
  if (instance) {
    logger.warn?.('piano-midi-wake.already_created');
    return { pianoMidiWakeService: instance };
  }

  const piano = configService?.getHouseholdAppConfig?.(householdId, 'piano') ?? {};
  const cfg = piano.midi_wake;
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
  // bridge_provider (top level of the piano config) picks the old piano-bridge APK or
  // the DaylightStation Android app's control port; see composition/bridge-endpoint.mjs.
  const usesOldBridge = (piano.bridge_provider || PIANO_BRIDGE) === PIANO_BRIDGE;
  if (!deviceId || (usesOldBridge && !bridgeUrl)) {
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

  const endpoint = resolvePianoBridgeEndpoint({ piano, deviceId, bridgeUrl, configService, logger, event: 'piano-midi-wake' });
  if (!endpoint) {
    logger.error?.('piano-midi-wake.not-started', { deviceId, provider: piano.bridge_provider || PIANO_BRIDGE });
    return { pianoMidiWakeService: null };
  }

  const service = new PianoMidiWakeService({
    deviceService,
    logger,
    deviceId,
    bridge: bridgeFactory(endpoint.provider === PIANO_BRIDGE
      ? { bridgeUrl, logger }
      : {
        bridgeUrl: endpoint.wsUrl, headers: endpoint.headers, relay: 'setting', logger,
        // A relay that did not arrive is re-synced on the supervisor's next reachable tick.
        onRelayFailed: () => getPianoWakeHoldSync({ endpoint, deviceId, getScreenOverrideService, logger })?.relayFailed(),
      }),
    prepareWake: endpoint.provider === PIANO_BRIDGE ? null : () =>
      getPianoWakeHoldSync({ endpoint, deviceId, getScreenOverrideService, logger }).prepareWake(),
    cooldownMs: cfg.cooldown_ms ?? cfg.cooldownMs,
    screenOverride: getScreenOverrideService(),
  });
  service.start();
  instance = service;
  logger.info?.('piano-midi-wake.created', { deviceId, provider: endpoint.provider, bridgeUrl: endpoint.provider === PIANO_BRIDGE ? bridgeUrl : endpoint.wsUrl });
  return { pianoMidiWakeService: service };
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  if (instance) { try { instance.stop(); } catch { /* ignore */ } }
  instance = null;
}
