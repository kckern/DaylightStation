/**
 * PianoBridgeSupervisorService factory — reads the piano app config's
 * `bridge_supervisor` block and, when enabled, starts the off-tablet watcher
 * that relaunches the piano-bridge APK and pushes when it cannot.
 *
 * Config (`household/piano/config.yml`):
 *
 *   bridge_supervisor:
 *     enabled: true
 *     device_id: yellow-room-tablet          # FKB device in the devices registry
 *     bridge_url: http://10.0.0.245:8770     # defaults to midi_wake.bridge_url
 *     package: net.kckern.pianobridge
 *     location: Yellow Room                  # room name used in the push text
 *     notify_service: mobile_app_...         # HA notify target; unset = log error only
 *     piano_power_entity: binary_sensor...   # defaults to screen_power_sync's
 *     interval_ms: 30000
 *     alert_after_ms: 300000
 *     one_way_alert_after_ms: 600000
 *
 * @module 5_composition/modules/pianoBridgeSupervisor
 */

import { PianoBridgeSupervisorService } from '#apps/devices/services/PianoBridgeSupervisorService.mjs';
import { PianoBridgeHealthProbeAdapter } from '#adapters/devices/PianoBridgeHealthProbeAdapter.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { composePianoBridgePush } from '#domains/devices/pianoBridgePush.mjs';

const DEFAULT_PACKAGE = 'net.kckern.pianobridge';

/** @type {PianoBridgeSupervisorService | null} */
let instance = null;

/**
 * @param {Object} deps
 * @param {Object} deps.configService
 * @param {{performAction:Function}} deps.remoteAdmin - DeviceRemoteAdministrationService
 * @param {{getState:Function, callService:Function}|null} [deps.haGateway]
 * @param {string|null} [deps.householdId]
 * @param {Object} [deps.logger]
 * @returns {{ pianoBridgeSupervisor: PianoBridgeSupervisorService|null }}
 */
export function createPianoBridgeSupervisor({
  configService, remoteAdmin, haGateway = null, householdId = null, logger = console,
  probeFactory = (options) => new PianoBridgeHealthProbeAdapter(options),
  scheduler = new NodeApplicationScheduler(),
} = {}) {
  if (instance) {
    logger.warn?.('piano-bridge.supervisor.already-created');
    return { pianoBridgeSupervisor: instance };
  }

  const piano = configService?.getHouseholdAppConfig?.(householdId, 'piano') ?? {};
  const cfg = piano.bridge_supervisor;
  if (!cfg?.enabled) {
    logger.info?.('piano-bridge.supervisor.disabled', { enabled: !!cfg?.enabled });
    return { pianoBridgeSupervisor: null };
  }

  const deviceId = cfg.device_id || piano.midi_wake?.device_id;
  const bridgeUrl = cfg.bridge_url || piano.midi_wake?.bridge_url;
  const pkg = cfg.package || DEFAULT_PACKAGE;
  if (!deviceId || !bridgeUrl || typeof remoteAdmin?.performAction !== 'function') {
    // A watcher that cannot start is itself the silent failure it exists to
    // prevent, so this is an error, not a warning.
    logger.error?.('piano-bridge.supervisor.not-started', {
      deviceId: deviceId || null, bridgeUrl: bridgeUrl || null, hasRemoteAdmin: !!remoteAdmin,
    });
    return { pianoBridgeSupervisor: null };
  }

  const powerEntity = cfg.piano_power_entity || piano.screen_power_sync?.piano_power_entity || null;
  const readPianoPower = powerEntity && haGateway?.getState
    ? async () => {
      const state = (await haGateway.getState(powerEntity))?.state;
      return state === 'on' || state === 'off' ? state : 'unknown';
    }
    : null;

  const notifyService = cfg.notify_service || null;
  const notify = notifyService && haGateway?.callService
    ? (push) => haGateway.callService('notify', notifyService, push)
    : null;

  const service = new PianoBridgeSupervisorService({
    probe: probeFactory({ bridgeUrl }),
    relaunch: async () => {
      await remoteAdmin.performAction(deviceId, 'launch-app', { package: pkg });
      return { ok: true };
    },
    readPianoPower,
    notify,
    compose: composePianoBridgePush,
    scheduler,
    logger,
    deviceId,
    location: cfg.location || null,
    timezone: configService?.getHouseholdTimezone?.(householdId) ?? null,
    intervalMs: cfg.interval_ms,
    alertAfterMs: cfg.alert_after_ms,
    oneWayAlertAfterMs: cfg.one_way_alert_after_ms,
  });
  service.start();
  instance = service;
  logger.info?.('piano-bridge.supervisor.created', {
    deviceId, bridgeUrl, pkg, notifyService, powerEntity,
  });
  return { pianoBridgeSupervisor: service };
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  if (instance) { try { instance.stop(); } catch { /* ignore */ } }
  instance = null;
}
