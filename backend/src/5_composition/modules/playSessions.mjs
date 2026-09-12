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
import { RetroArchSessionLogReader } from '#adapters/gaming/RetroArchSessionLogReader.mjs';
import { EventBusPlaySessionAnnouncer } from '#adapters/eventbus/EventBusPlaySessionAnnouncer.mjs';
import { FleetPlaySessionAnnouncer } from '#adapters/eventbus/FleetPlaySessionAnnouncer.mjs';
import { CompositePlaySessionAnnouncer } from '#adapters/eventbus/CompositePlaySessionAnnouncer.mjs';
import { FullyKioskPlayOverlay } from '#adapters/devices/FullyKioskPlayOverlay.mjs';
import { OverlayPlaySessionAnnouncer } from '#apps/gaming/runtime/OverlayPlaySessionAnnouncer.mjs';
import { KioskPlayTerminator } from '#adapters/devices/KioskPlayTerminator.mjs';
import { KioskPlaySpeaker } from '#adapters/devices/KioskPlaySpeaker.mjs';
import { NoPlayTimeGrants } from '#adapters/gaming/NoPlayTimeGrants.mjs';
import { RoleBasedPlayGrants } from '#adapters/gaming/RoleBasedPlayGrants.mjs';
import { LedgerPlayTimeGrants } from '#adapters/gaming/LedgerPlayTimeGrants.mjs';
import { YamlPlayGrantLedger } from '#adapters/persistence/yaml/YamlPlayGrantLedger.mjs';
import { GrantPlayTime } from '#apps/gaming/usecases/GrantPlayTime.mjs';
import { CheckPlayEligibility } from '#apps/gaming/usecases/CheckPlayEligibility.mjs';
import { AndroidControllerProbe } from '#adapters/devices/AndroidControllerProbe.mjs';
import { HomeAssistantPlayAlert } from '#adapters/devices/HomeAssistantPlayAlert.mjs';
import { EnforcePlayBudget } from '#apps/gaming/usecases/EnforcePlayBudget.mjs';
import { YamlPlaySessionDatastore } from '#adapters/persistence/yaml/YamlPlaySessionDatastore.mjs';
import { YamlPlayIntentDatastore } from '#adapters/persistence/yaml/YamlPlayIntentDatastore.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { RecordPlayObservation } from '#apps/gaming/usecases/RecordPlayObservation.mjs';
import { ReconcileOpenSessions } from '#apps/gaming/usecases/ReconcileOpenSessions.mjs';
import { ReconcilePlaySessions } from '#apps/gaming/usecases/ReconcilePlaySessions.mjs';
import { PlayObservationWatchdog } from '#apps/gaming/runtime/PlayObservationWatchdog.mjs';
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
/** Where the emulator keeps its per-session logs. Overridable per household. */
const DEFAULT_LOG_DIR = '/storage/emulated/0/RetroArch/logs';
/** How far back startup reconciliation looks for sessions the meter never saw. */
const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * ROM path → content identity, from the launcher catalog.
 *
 * The device's logs name the content by its file path, because that is what the
 * emulator was handed. Turning that back into a content id is what lets a
 * session recovered after a blind spot be attributed to an actual title.
 */
export function buildContentResolver(catalog) {
  const byRom = new Map();
  for (const [consoleId, games] of Object.entries(catalog?.games || {})) {
    for (const game of games || []) {
      if (game?.rom) byRom.set(game.rom, { contentId: `retroarch:${consoleId}/${game.id}`, title: game.title });
    }
  }
  return (romPath) => byRom.get(romPath) || null;
}

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
    devicesConfig, gamesConfig, gamesCatalog = null, configService, eventBus, httpClient,
    daylightHost = null, overlayPath = '/arcade-film.html',
    grants = null, haGateway = null, profileFor = null, assertionsFor = null,
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
    return { trackers: [], sessions: null, intents: null, recordObservation: null, watchdog: null, grantLedger: null, grantPlayTime: null, checkEligibility: null, async start() {}, stop() {} };
  }

  const packageName = gamesConfig?.launch?.package;
  if (!packageName) {
    // Without the package to watch there is no way to tell the emulator from
    // anything else in the foreground. Refuse rather than meter the wrong thing.
    logger.warn?.('play.tracking.no_launch_package', {
      devices: declared.map(([id]) => id),
    });
    return { trackers: [], sessions: null, intents: null, recordObservation: null, watchdog: null, grantLedger: null, grantPlayTime: null, checkEligibility: null, async start() {}, stop() {} };
  }

  const sessions = new YamlPlaySessionDatastore({ configService, logger });
  const intents = new YamlPlayIntentDatastore({ configService, logger });
  // Kiosk clients, built once per declared device and shared by the observation
  // source and the overlay driver.
  const kioskByDevice = new Map();
  for (const [deviceId, device] of declared) {
    const content = device.content_control || {};
    const password = content.password
      || (content.auth_ref ? configService?.getHouseholdAuth?.(content.auth_ref)?.password : null);
    kioskByDevice.set(deviceId, new FullyKioskRestClient(
      { host: content.host, port: content.port, password: password || '' },
      { httpClient, logger },
    ));
  }

  // The overlay is a SEPARATE declaration from observation: a device may be
  // metered without ever carrying a countdown. Only `play_overlay: true` devices
  // get a client here, so no code path can put a film on a screen that did not
  // ask for one.
  const overlayDevices = declared.filter(([, d]) => d?.play_overlay === true).map(([id]) => id);
  const overlayAnnouncer = (overlayDevices.length && daylightHost)
    ? new OverlayPlaySessionAnnouncer({
      overlay: new FullyKioskPlayOverlay({
        clientsByDevice: new Map(overlayDevices.map((id) => [id, kioskByDevice.get(id)])),
        httpClient, logger,
      }),
      buildUrl: (deviceId) => `${daylightHost}${overlayPath}?device=${encodeURIComponent(deviceId)}`,
      logger,
    })
    : null;
  if (overlayDevices.length && !daylightHost) {
    logger.warn?.('play.overlay.no_host', { devices: overlayDevices });
  }

  // Enforcement. `grants` decides whether ANY of this can act: the default
  // answers "no grant" for every session, so warnings never fire and nothing is
  // ever stopped. Metering still runs and still records what was played — the
  // meter measures from day one and only starts costing anything when a real
  // grant source replaces this.
  const grantLedger = configService ? new YamlPlayGrantLedger({ configService, logger }) : null;
  const isAdmin = profileFor
    ? async (userId) => {
      const profile = await profileFor(userId);
      const roles = Array.isArray(profile?.roles) ? profile.roles.map(String) : [];
      return profile?.type === 'owner' || roles.some((r) => ['sysadmin', 'parent', 'gaming-host'].includes(r));
    }
    : null;
  const playGrants = (grantLedger && isAdmin)
    ? new LedgerPlayTimeGrants({ ledger: grantLedger, isAdmin, logger })
    : (profileFor ? new RoleBasedPlayGrants({ profileFor, logger }) : new NoPlayTimeGrants());
  const grantPlayTime = grantLedger ? new GrantPlayTime({ ledger: grantLedger, logger }) : null;

  const adbByDevice = new Map();
  const controllerProbes = new Map();
  const enforcement = new EnforcePlayBudget({
    // Adults play without a ceiling; everyone else plays the time on their
    // ledger, and nothing at all if none was granted. Where granted time came
    // from — a parent's phone or converted tokens — is the ledger's business,
    // not the meter's.
    grants: grants || playGrants,
    terminator: new KioskPlayTerminator({
      adbByDevice, kioskByDevice, packageName, logger,
    }),
    speaker: new KioskPlaySpeaker({ clientsByDevice: kioskByDevice, logger }),
    // The countdown film reads warnings off the same topic it already listens to.
    notify: async (session, payload) => {
      try {
        eventBus.broadcast(`play-session:${session.deviceId}`, {
          event: 'play.session.progress',
          sessionId: session.id, deviceId: session.deviceId,
          playedMs: session.playedMs, userId: session.userId,
          title: session.content?.title ?? null, ...payload,
        });
      } catch (error) {
        logger.warn?.('play.budget.notify_failed', { error: error.message });
      }
    },
    sessions,
    logger,
  });

  // Several audiences for the same fact: the domain events the economy consumes,
  // the fleet projection that renders a game like any other content on a device,
  // and the overlay that puts a countdown in front of the player.
  const announcer = new CompositePlaySessionAnnouncer({
    announcers: [
      new EventBusPlaySessionAnnouncer({ eventBus, logger }),
      new FleetPlaySessionAnnouncer({ eventBus, logger }),
      overlayAnnouncer,
      enforcement,
    ],
    logger,
  });

  const recordObservation = new RecordPlayObservation({
    sessions,
    announcer,
    newSessionId: newSessionId || (() => `ps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
    trustedGapMs: Math.round(intervalMs * TRUSTED_GAP_FACTOR),
    logger,
  });

  const built = declared.map(([deviceId, device]) => {
    const content = device.content_control || {};
    const fallback = content.fallback || {};
    const kioskClient = kioskByDevice.get(deviceId);

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

    if (adbAdapter) {
      adbByDevice.set(deviceId, adbAdapter);
      controllerProbes.set(deviceId, new AndroidControllerProbe({ adbAdapter, logger }));
    }

    const logReader = adbAdapter
      ? new RetroArchSessionLogReader({
        adbAdapter, logDir: gamesConfig?.source?.logs_path || DEFAULT_LOG_DIR, logger,
      })
      : null;

    const tracker = new PlaySessionTracker({
      devices: [{ deviceId, surface: CONSOLE_SURFACE }],
      observationSource, intents, recordObservation,
      intervalMs, scheduler, now, logger,
    });
    return { deviceId, tracker, logReader };
  });

  const trackers = built.map((b) => b.tracker);

  const resolveContent = buildContentResolver(gamesCatalog);
  const watchdog = new PlayObservationWatchdog({
    trackers,
    scheduler,
    now,
    staleAfterMs: intervalMs * STALE_AFTER_FACTOR,
    intervalMs: intervalMs * 3,
    // Blindness is tolerable briefly and a person's problem after that. It never
    // stops a running game — only withholds NEW play until observation returns.
    escalateAfterMs: intervalMs * STALE_AFTER_FACTOR * 10,
    alert: new HomeAssistantPlayAlert({
      haGateway,
      serviceByDevice: new Map(declared
        .filter(([, d]) => d?.notify_service)
        .map(([id, d]) => [id, d.notify_service])),
      logger,
    }),
    logger,
  });

  logger.info?.('play.tracking.configured', {
    devices: declared.map(([id]) => id), intervalMs, packageName,
  });

  const reconcile = new ReconcileOpenSessions({ sessions, announcer, logger });
  const deviceIds = declared.map(([id]) => id);

  // Eligibility: may play BEGIN? Rules live in configuration and in state-gate
  // assertions, never here. Absent inputs are permissive; a device the meter
  // cannot see is the one thing that refuses.
  const checkEligibility = new CheckPlayEligibility({
    policyFor: () => gamesConfig?.play_policy || {},
    assertionsFor,
    isBlocked: (deviceId) => watchdog.isBlocked(deviceId),
    controllersFor: async (deviceId) => {
      const probe = controllerProbes.get(deviceId);
      const census = probe ? await probe.census() : null;
      return census?.connected ?? null;
    },
    logger,
  });

  return {
    trackers,
    sessions,
    checkEligibility,
    intents,
    // Exposed so the HTTP surface can feed self-reporting play surfaces into the
    // same use case the polled source uses.
    recordObservation,
    watchdog,
    grantLedger,
    grantPlayTime,
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
      // Compare what the device recorded against what we saw. This never
      // invents billable time — it surfaces sessions the meter missed and
      // repairs attribution it could not determine live.
      for (const { deviceId, logReader } of built) {
        if (!logReader) continue;
        try {
          const found = await new ReconcilePlaySessions({
            sessions, logReader, resolveContent, logger,
          }).execute({ deviceId, since: new Date(Date.parse(now()) - RECONCILE_WINDOW_MS).toISOString() });
          if (found.unrecorded.length || found.enriched.length) {
            logger.info?.('play.tracking.device_reconciled', {
              deviceId, unrecorded: found.unrecorded.length, enriched: found.enriched.length,
            });
          }
        } catch (error) {
          logger.warn?.('play.tracking.device_reconcile_failed', { deviceId, error: error.message });
        }
      }

      // A process that died mid-session must not leave a film on the family
      // television. Recovery removes it actively rather than assuming it is gone.
      if (overlayAnnouncer) {
        const stillOpen = new Set();
        for (const deviceId of deviceIds) {
          if (await sessions.findOpenForDevice(deviceId)) stillOpen.add(deviceId);
        }
        await overlayAnnouncer.disarmIdle(overlayDevices.filter((id) => !stillOpen.has(id)));
      }

      trackers.forEach((t) => t.start());
      watchdog.start();
    },
    stop() { watchdog.stop(); trackers.forEach((t) => t.stop()); },
  };
}

export default createPlaySessionTracking;
