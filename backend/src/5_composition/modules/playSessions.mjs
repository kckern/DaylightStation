/**
 * Wires play-session observation for every device that DECLARES it.
 *
 * Nothing here discovers devices to meter. A device is watched only if its
 * configuration says `play_observation: true`, so adding a screen to the house
 * never silently adds a meter to it. A household where no device declares it
 * gets no timers, no clients and no bus traffic at all.
 *
 * One tracker per device rather than one tracker over all devices: each needs
 * its own kiosk client and its own ADB target, and a device that becomes
 * unreachable should not be able to delay the polling of any other.
 *
 * @module 5_composition/modules/playSessions
 */

import { FullyKioskRestClient } from '#adapters/devices/FullyKioskRestClient.mjs';
import { AdbAdapter } from '#adapters/devices/AdbAdapter.mjs';
import { RetroArchPlayObservationSource } from '#adapters/gaming/RetroArchPlayObservationSource.mjs';
import { EventBusPlaySessionAnnouncer } from '#adapters/eventbus/EventBusPlaySessionAnnouncer.mjs';
import { YamlPlaySessionDatastore } from '#adapters/persistence/yaml/YamlPlaySessionDatastore.mjs';
import { YamlPlayIntentDatastore } from '#adapters/persistence/yaml/YamlPlayIntentDatastore.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { RecordPlayObservation } from '#apps/gaming/usecases/RecordPlayObservation.mjs';
import { ReconcileOpenSessions } from '#apps/gaming/usecases/ReconcileOpenSessions.mjs';
import { PlaySessionTracker } from '#apps/gaming/runtime/PlaySessionTracker.mjs';

const DEFAULT_INTERVAL_MS = 10_000;
/** How long a gap between observations may be and still count as continuous
 *  play. Beyond this the tracker was not watching, and the unseen remainder is
 *  a blind spot rather than billable time. */
const TRUSTED_GAP_FACTOR = 2.5;
/** A session unobserved for longer than this cannot be honestly resumed after a
 *  restart, so startup settles it as lost rather than leaving it open. */
const STALE_AFTER_FACTOR = 6;
const CONSOLE_SURFACE = 'console-emulator';

/**
 * @param {Object} config
 * @param {Object} config.devicesConfig  Raw devices.yml content.
 * @param {Object} config.gamesConfig    Launcher config (supplies the package to watch).
 * @param {Object} config.configService
 * @param {Object} config.eventBus
 * @param {Object} config.httpClient
 * @returns {{ trackers: PlaySessionTracker[], sessions, intents, start(): void, stop(): void }}
 */
export function createPlaySessionTracking(config) {
  const {
    devicesConfig, gamesConfig, configService, eventBus, httpClient,
    intervalMs = DEFAULT_INTERVAL_MS,
    scheduler = new NodeApplicationScheduler(),
    now = () => new Date().toISOString(),
    newSessionId,
    logger = console,
  } = config || {};

  const devices = devicesConfig?.devices || devicesConfig || {};
  const declared = Object.entries(devices).filter(([, d]) => d?.play_observation === true);

  if (declared.length === 0) {
    logger.info?.('play.tracking.none_declared', {});
    return { trackers: [], sessions: null, intents: null, async start() {}, stop() {} };
  }

  const packageName = gamesConfig?.launch?.package;
  if (!packageName) {
    // Without the package to watch there is no way to tell the emulator from
    // anything else in the foreground. Refuse rather than meter the wrong thing.
    logger.warn?.('play.tracking.no_launch_package', {
      devices: declared.map(([id]) => id),
    });
    return { trackers: [], sessions: null, intents: null, async start() {}, stop() {} };
  }

  const sessions = new YamlPlaySessionDatastore({ configService, logger });
  const intents = new YamlPlayIntentDatastore({ configService, logger });
  const announcer = new EventBusPlaySessionAnnouncer({ eventBus, logger });

  const recordObservation = new RecordPlayObservation({
    sessions,
    announcer,
    newSessionId: newSessionId || (() => `ps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
    trustedGapMs: Math.round(intervalMs * TRUSTED_GAP_FACTOR),
    logger,
  });

  const trackers = declared.map(([deviceId, device]) => {
    const content = device.content_control || {};
    const fallback = content.fallback || {};
    const password = content.password
      || (content.auth_ref ? configService?.getHouseholdAuth?.(content.auth_ref)?.password : null);

    const kioskClient = new FullyKioskRestClient(
      { host: content.host, port: content.port, password: password || '' },
      { httpClient, logger },
    );

    // ADB is the confirmer, not the primary channel: without it we can still see
    // that the emulator is in front, we just cannot tell playing from paused.
    const adbAdapter = fallback.provider === 'adb' && fallback.host
      ? new AdbAdapter({ host: fallback.host, port: fallback.port }, { logger })
      : null;
    if (!adbAdapter) {
      logger.warn?.('play.tracking.no_adb', { deviceId });
    }

    const observationSource = new RetroArchPlayObservationSource({
      kioskClient, adbAdapter, packageName, pollIntervalMs: intervalMs, logger,
    });

    return new PlaySessionTracker({
      devices: [{ deviceId, surface: CONSOLE_SURFACE }],
      observationSource, intents, recordObservation,
      intervalMs, scheduler, now, logger,
    });
  });

  logger.info?.('play.tracking.configured', {
    devices: declared.map(([id]) => id), intervalMs, packageName,
  });

  const reconcile = new ReconcileOpenSessions({ sessions, announcer, logger });
  const deviceIds = declared.map(([id]) => id);

  return {
    trackers,
    sessions,
    intents,
    /**
     * Settle anything a previous process left open, THEN start watching. Order
     * matters: a tracker that observed first could append to a session whose
     * fate had not yet been decided.
     */
    async start() {
      try {
        const settled = await reconcile.execute({
          deviceIds, now: now(), staleAfterMs: intervalMs * STALE_AFTER_FACTOR,
        });
        if (settled.resumed.length || settled.lost.length) {
          logger.info?.('play.tracking.reconciled', settled);
        }
      } catch (error) {
        // Never let reconciliation failure prevent observation — a missed
        // settlement is recoverable, a meter that never starts is not.
        logger.error?.('play.tracking.reconcile_failed', { error: error.message });
      }
      trackers.forEach((t) => t.start());
    },
    stop() { trackers.forEach((t) => t.stop()); },
  };
}

export default createPlaySessionTracking;
