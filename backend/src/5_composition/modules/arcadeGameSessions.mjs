/**
 * Wires arcade-game-session observation for every device that DECLARES it.
 *
 * Nothing here discovers devices to poll. A device is watched from outside only
 * if its configuration says `arcade_session_observation: true`, so adding a screen to the
 * house never silently adds an ADB meter to it. Persistence, HTTP ingress and
 * bus publication are still built with no polled devices: self-reporting browser
 * surfaces do not depend on a Shield being declared.
 *
 * One tracker per device rather than one tracker over all devices: each needs
 * its own kiosk client and its own ADB target, and a device that becomes
 * unreachable should not be able to delay the polling of any other.
 *
 * @module 5_composition/modules/arcadeGameSessions
 */

import { FullyKioskRestClient } from '#adapters/devices/FullyKioskRestClient.mjs';
import { AdbAdapter } from '#adapters/devices/AdbAdapter.mjs';
import { RetroArchArcadeGameObservationSource } from '#adapters/gaming/RetroArchArcadeGameObservationSource.mjs';
import { RetroArchSessionLogReader } from '#adapters/gaming/RetroArchSessionLogReader.mjs';
import { EventBusArcadeGameSessionAnnouncer } from '#adapters/eventbus/EventBusArcadeGameSessionAnnouncer.mjs';
import { parseBezel, choosePlacement } from '#domains/gaming/value-objects/OverlayPlacement.mjs';
import { resolveOverlayConfig } from '#domains/gaming/value-objects/OverlaySessionFields.mjs';
import { FleetArcadeGameSessionAnnouncer } from '#adapters/eventbus/FleetArcadeGameSessionAnnouncer.mjs';
import { CompositeArcadeGameSessionAnnouncer } from '#adapters/eventbus/CompositeArcadeGameSessionAnnouncer.mjs';
import { FullyKioskArcadeGameOverlay } from '#adapters/devices/FullyKioskArcadeGameOverlay.mjs';
import { OverlayArcadeGameSessionAnnouncer } from '#apps/gaming/runtime/OverlayArcadeGameSessionAnnouncer.mjs';
import { KioskArcadeGameTerminator } from '#adapters/devices/KioskArcadeGameTerminator.mjs';
import { KioskArcadeGameSpeaker } from '#adapters/devices/KioskArcadeGameSpeaker.mjs';
import { NoArcadeGameTimeGrants } from '#adapters/gaming/NoArcadeGameTimeGrants.mjs';
import { RoleBasedArcadeGameGrants } from '#adapters/gaming/RoleBasedArcadeGameGrants.mjs';
import { LedgerArcadeGameTimeGrants } from '#adapters/gaming/LedgerArcadeGameTimeGrants.mjs';
import { YamlArcadeGameGrantLedger } from '#adapters/persistence/yaml/YamlArcadeGameGrantLedger.mjs';
import { GrantArcadeGameTime } from '#apps/gaming/usecases/GrantArcadeGameTime.mjs';
import { CheckArcadeGameEligibility } from '#apps/gaming/usecases/CheckArcadeGameEligibility.mjs';
import { SummariseArcadeGameUsage } from '#apps/gaming/usecases/SummariseArcadeGameUsage.mjs';
import { AndroidControllerProbe } from '#adapters/devices/AndroidControllerProbe.mjs';
import { HomeAssistantArcadeGameAlert } from '#adapters/devices/HomeAssistantArcadeGameAlert.mjs';
import { EnforceArcadeGameBudget } from '#apps/gaming/usecases/EnforceArcadeGameBudget.mjs';
import { YamlArcadeGameSessionDatastore } from '#adapters/persistence/yaml/YamlArcadeGameSessionDatastore.mjs';
import { YamlArcadeGameSessionIntentDatastore } from '#adapters/persistence/yaml/YamlArcadeGameSessionIntentDatastore.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { RecordArcadeGameObservation } from '#apps/gaming/usecases/RecordArcadeGameObservation.mjs';
import { ReconcileOpenArcadeGameSessions } from '#apps/gaming/usecases/ReconcileOpenArcadeGameSessions.mjs';
import { ReconcileArcadeGameSessions } from '#apps/gaming/usecases/ReconcileArcadeGameSessions.mjs';
import { ArcadeGameObservationWatchdog } from '#apps/gaming/runtime/ArcadeGameObservationWatchdog.mjs';
import { OpenArcadeGameSessionMonitor } from '#apps/gaming/runtime/OpenArcadeGameSessionMonitor.mjs';
import { ArcadeGameSessionTracker } from '#apps/gaming/runtime/ArcadeGameSessionTracker.mjs';

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
export function buildContentResolver(catalog, gamesConfig = null) {
  const byRom = new Map();
  for (const [consoleId, games] of Object.entries(catalog?.games || {})) {
    // The emulated SYSTEM comes from the catalog, never from the core. A core
    // does not identify a system — gambatte serves both Game Boy and Game Boy
    // Color — so a core-based guess would merge two consoles that need
    // different on-screen treatment. The ROM's place in the catalog is exact.
    const label = gamesConfig?.consoles?.[consoleId]?.label ?? null;
    const core = gamesConfig?.consoles?.[consoleId]?.core ?? null;
    for (const game of games || []) {
      if (!game?.rom) continue;
      byRom.set(game.rom, {
        contentId: `arcade:${consoleId}/${game.id}`,
        title: game.title,
        console: consoleId,
        consoleLabel: label,
        core,
      });
    }
  }
  return (romPath) => byRom.get(romPath) || null;
}

/**
 * Emulated system → where a countdown may be drawn on that system's bezel.
 *
 * The geometry is measured from the emulator's own border artwork and lives in
 * configuration, because it is a property of the art, not of the code. Parsing
 * it here means a mis-measured zone — one that has crept over the game screen —
 * is refused at boot with the system named, rather than discovered by a child
 * whose game is covered by a clock.
 *
 * A system whose bezel fails to parse simply gets no placement. Losing the
 * countdown's position must never cost us the meter.
 */
export function buildBezelTable(gamesConfig = null, logger = console) {
  const table = new Map();
  for (const [systemId, entry] of Object.entries(gamesConfig?.consoles || {})) {
    if (!entry?.bezel) continue;
    try {
      table.set(systemId, parseBezel(entry.bezel, { system: systemId }));
    } catch (error) {
      logger.warn?.('arcade.bezel.invalid', { system: systemId, error: error.message });
    }
  }
  return table;
}

/**
 * @param {Object} config
 * @param {Object} config.devicesConfig  Raw devices.yml content.
 * @param {Object} config.gamesConfig    Launcher config (supplies the package to watch).
 * @param {Object} config.configService
 * @param {Object} config.eventBus
 * @param {Object} config.httpClient
 * @returns {{ trackers: ArcadeGameSessionTracker[], sessions, intents, start(): void, stop(): void }}
 */
export function createArcadeGameSessionTracking(config) {
  const {
    devicesConfig, gamesConfig, gamesCatalog = null, arcadeOverlayConfig = null, configService, eventBus, httpClient,
    daylightHost = null, overlayPath = '/arcade-film.html',
    grants = null, haGateway = null, profileFor = null, assertionsFor = null,
    intervalMs = DEFAULT_INTERVAL_MS,
    scheduler = new NodeApplicationScheduler(),
    now = () => new Date().toISOString(),
    newSessionId,
    logger = console,
  } = config || {};

  const devices = devicesConfig?.devices || devicesConfig || {};
  const declared = Object.entries(devices).filter(([, d]) => d?.arcade_session_observation === true);

  if (declared.length === 0) {
    logger.info?.('arcade.tracking.none_declared', {});
  }

  const packageName = gamesConfig?.launch?.package;
  let polledDevices = declared;
  if (declared.length && !packageName) {
    // Without the package to watch there is no way to tell the emulator from
    // anything else in the foreground. Refuse rather than meter the wrong thing.
    logger.warn?.('arcade.tracking.no_launch_package', {
      devices: declared.map(([id]) => id),
    });
    polledDevices = [];
  }

  const sessions = new YamlArcadeGameSessionDatastore({ configService, logger });
  const intents = new YamlArcadeGameSessionIntentDatastore({ configService, logger });
  // Kiosk clients, built once per declared device and shared by the observation
  // source and the overlay driver.
  const kioskByDevice = new Map();
  for (const [deviceId, device] of polledDevices) {
    const content = device.content_control || {};
    const password = content.password
      || (content.auth_ref ? configService?.getHouseholdAuth?.(content.auth_ref)?.password : null);
    kioskByDevice.set(deviceId, new FullyKioskRestClient(
      { host: content.host, port: content.port, password: password || '' },
      { httpClient, logger },
    ));
  }

  // The overlay is a SEPARATE declaration from observation: a device may be
  // metered without ever carrying a countdown. Only `arcade_session_overlay: true` devices
  // get a client here, so no code path can put a film on a screen that did not
  // ask for one.
  const overlayDevices = polledDevices.filter(([, d]) => d?.arcade_session_overlay === true).map(([id]) => id);
  const overlayAnnouncer = (overlayDevices.length && daylightHost)
    ? new OverlayArcadeGameSessionAnnouncer({
      overlay: new FullyKioskArcadeGameOverlay({
        clientsByDevice: new Map(overlayDevices.map((id) => [id, kioskByDevice.get(id)])),
        httpClient, logger,
      }),
      buildUrl: (deviceId) => `${daylightHost}${overlayPath}?device=${encodeURIComponent(deviceId)}`,
      logger,
    })
    : null;
  if (overlayDevices.length && !daylightHost) {
    logger.warn?.('arcade.overlay.no_host', { devices: overlayDevices });
  }

  // Enforcement is an explicit operational mode. Observation, persistence and
  // clocks run by default; warning/termination behavior exists only after the
  // household deliberately selects `arcade_sessions.mode: enabled`.
  const grantLedger = configService ? new YamlArcadeGameGrantLedger({ configService, logger }) : null;
  const isAdmin = profileFor
    ? async (userId) => {
      const profile = await profileFor(userId);
      const roles = Array.isArray(profile?.roles) ? profile.roles.map(String) : [];
      return profile?.type === 'owner' || roles.some((r) => ['sysadmin', 'parent', 'gaming-host'].includes(r));
    }
    : null;
  const playGrants = (grantLedger && isAdmin)
    ? new LedgerArcadeGameTimeGrants({ ledger: grantLedger, isAdmin, logger })
    : (profileFor ? new RoleBasedArcadeGameGrants({ profileFor, logger }) : new NoArcadeGameTimeGrants());
  const grantArcadeGameTime = grantLedger ? new GrantArcadeGameTime({ ledger: grantLedger, logger }) : null;

  const bezels = buildBezelTable(gamesConfig, logger);
  // Content → where its countdown goes. Keyed on the emulated SYSTEM, which the
  // catalog knows exactly; the core would not do, since one core can serve two
  // systems with different bezels.
  const placementFor = (content) => {
    const bezel = content?.console ? bezels.get(content.console) : null;
    return bezel ? choosePlacement(bezel) : null;
  };

  // System id → resolved overlay config (anchor, offsets, scale, fields). The
  // household's arcade-overlay.yml plus its per-system overrides, merged once
  // per call so a missing config still yields the safe "show nothing" default.
  const overlayConfigFor = (systemId) => resolveOverlayConfig(arcadeOverlayConfig, systemId);

  // Who the countdown is addressed to. A slug is an identifier, not a name; the
  // surface a child reads should say "Robin", not "robin".
  const identify = profileFor
    ? async (userId) => {
      if (!userId) return null;
      try {
        const profile = await profileFor(userId);
        return profile ? { displayName: profile.display_name ?? null } : null;
      } catch (error) {
        logger.debug?.('arcade.identify.failed', { userId, error: error.message });
        return null;
      }
    }
    : null;

  const adbByDevice = new Map();
  const controllerProbes = new Map();
  const enforcementMode = gamesConfig?.arcade_sessions?.mode ?? 'observe-only';
  // The ordinary projections are also the terminal projection target for an
  // expiry that occurs inside EnforceArcadeGameBudget.progress(). Keep enforcement
  // itself out of this inner fan-out to avoid recursively announcing to it.
  const sessionProjections = new CompositeArcadeGameSessionAnnouncer({
    announcers: [
      new EventBusArcadeGameSessionAnnouncer({ eventBus, placementFor, overlayConfigFor, identify, sessions, logger }),
      new FleetArcadeGameSessionAnnouncer({ eventBus, logger }),
      overlayAnnouncer,
    ],
    logger,
  });

  const enforcement = enforcementMode === 'enabled' && packageName ? new EnforceArcadeGameBudget({
    // Adults play without a ceiling; everyone else plays the time on their
    // ledger, and nothing at all if none was granted. Where granted time came
    // from — a parent's phone or converted tokens — is the ledger's business,
    // not the meter's.
    grants: grants || playGrants,
    terminator: new KioskArcadeGameTerminator({
      adbByDevice, kioskByDevice, packageName, logger,
    }),
    speaker: new KioskArcadeGameSpeaker({ clientsByDevice: kioskByDevice, logger }),
    // The countdown film reads warnings off the same topic it already listens to.
    notify: async (session, payload) => {
      try {
        // The SAME presentation fields the announcer sends, so a warning is not
        // a second, thinner kind of message the film has to special-case.
        const identity = identify ? await identify(session.userId) : null;
        eventBus.broadcast(`arcade-session:${session.deviceId}`, {
          event: 'arcade.session.progress',
          sessionId: session.id, deviceId: session.deviceId,
          playedMs: session.playedMs, userId: session.userId,
          displayName: identity?.displayName ?? null,
          contentId: session.content?.contentId ?? null,
          title: session.content?.title ?? null,
          system: session.content?.console ?? null,
          systemLabel: session.content?.consoleLabel ?? null,
          placement: placementFor(session.content),
          controllers: session.controllers ?? null,
          ...payload,
        });
      } catch (error) {
        logger.warn?.('arcade.budget.notify_failed', { error: error.message });
      }
    },
    sessions,
    announcer: sessionProjections,
    logger,
  }) : null;

  // Several audiences for the same fact: the domain events the economy consumes,
  // the fleet projection that renders a game like any other content on a device,
  // and the overlay that puts a countdown in front of the player.
  const announcer = new CompositeArcadeGameSessionAnnouncer({
    announcers: [
      sessionProjections,
      enforcement,
    ],
    logger,
  });

  const recordObservation = new RecordArcadeGameObservation({
    sessions,
    announcer,
    newSessionId: newSessionId || (() => `ps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
    trustedGapMs: Math.round(intervalMs * TRUSTED_GAP_FACTOR),
    logger,
  });

  const resolveContent = buildContentResolver(gamesCatalog, gamesConfig);

  const built = polledDevices.map(([deviceId, device]) => {
    const content = device.content_control || {};
    const fallback = content.fallback || {};
    const kioskClient = kioskByDevice.get(deviceId);

    // ADB is the confirmer, not the primary channel: without it we can still see
    // that the emulator is in front, we just cannot tell playing from paused.
    const adbAdapter = fallback.provider === 'adb' && fallback.host
      ? new AdbAdapter({ host: fallback.host, port: fallback.port }, { logger })
      : null;
    if (!adbAdapter) {
      logger.warn?.('arcade.tracking.no_adb', { deviceId });
    }

    if (adbAdapter) {
      adbByDevice.set(deviceId, adbAdapter);
      controllerProbes.set(deviceId, new AndroidControllerProbe({ adbAdapter, logger }));
    }

    const logReader = adbAdapter
      ? new RetroArchSessionLogReader({
        adbAdapter, logDir: gamesConfig?.source?.logs_path || DEFAULT_LOG_DIR, logger,
      })
      : null;

    const observationSource = new RetroArchArcadeGameObservationSource({
      kioskClient, adbAdapter, packageName, logReader, resolveContent,
      pollIntervalMs: intervalMs, logger,
    });

    const tracker = new ArcadeGameSessionTracker({
      devices: [{ deviceId, surface: CONSOLE_SURFACE }],
      observationSource, intents, recordObservation,
      controllersFor: async () => {
        const census = await controllerProbes.get(deviceId)?.census?.();
        return census?.connected ?? null;
      },
      intervalMs, scheduler, now, logger,
    });
    return { deviceId, tracker, logReader };
  });

  const trackers = built.map((b) => b.tracker);
  const configuredStaleAfterMs = Number(gamesConfig?.arcade_sessions?.stale_after_ms);
  const sessionStaleAfterMs = Number.isFinite(configuredStaleAfterMs) && configuredStaleAfterMs > 0
    ? configuredStaleAfterMs
    : intervalMs * STALE_AFTER_FACTOR;
  const sessionMonitorIntervalMs = Math.min(intervalMs * 3, sessionStaleAfterMs);

  const watchdog = new ArcadeGameObservationWatchdog({
    trackers,
    scheduler,
    now,
    staleAfterMs: sessionStaleAfterMs,
    intervalMs: intervalMs * 3,
    // Blindness is tolerable briefly and a person's problem after that. It never
    // stops a running game — only withholds NEW play until observation returns.
    escalateAfterMs: intervalMs * STALE_AFTER_FACTOR * 10,
    alert: new HomeAssistantArcadeGameAlert({
      haGateway,
      serviceByDevice: new Map(polledDevices
        .filter(([, d]) => d?.notify_service)
        .map(([id, d]) => [id, d.notify_service])),
      logger,
    }),
    logger,
  });

  logger.info?.('arcade.tracking.configured', {
    devices: polledDevices.map(([id]) => id), intervalMs, sessionStaleAfterMs,
    packageName, enforcementMode,
  });

  const reconcile = new ReconcileOpenArcadeGameSessions({ sessions, announcer, logger });
  const sessionMonitor = new OpenArcadeGameSessionMonitor({
    sessions,
    announcer,
    scheduler,
    now,
    staleAfterMs: sessionStaleAfterMs,
    intervalMs: sessionMonitorIntervalMs,
    logger,
  });
  const deviceIds = polledDevices.map(([id]) => id);

  // Eligibility: may play BEGIN? Rules live in configuration and in state-gate
  // assertions, never here. Absent inputs are permissive; a device the meter
  // cannot see is the one thing that refuses.
  const checkEligibility = new CheckArcadeGameEligibility({
    policyFor: () => gamesConfig?.arcade_session_policy || {},
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
    /**
     * Overlay geometry per emulated system, already validated.
     *
     * Plain data, so the HTTP surface can serve it without reaching into the
     * domain, and so a person can check what the film was told rather than
     * inferring it from where a countdown ended up on the television.
     */
    placements: () => Object.fromEntries([...bezels].map(([system, bezel]) => [system, {
      label: gamesConfig?.consoles?.[system]?.label ?? null,
      source: bezel.source,
      screen: bezel.screen,
      zones: bezel.zones,
      placement: choosePlacement(bezel),
    }])),
    // Monitoring: usage can be watched long before any policy is set against it.
    summariseArcadeGameUsage: new SummariseArcadeGameUsage({ sessions, logger }),
    intents,
    // Exposed so the HTTP surface can feed self-reporting play surfaces into the
    // same use case the polled source uses.
    recordObservation,
    watchdog,
    sessionMonitor,
    grantLedger,
    grantArcadeGameTime,
    /**
     * Settle anything a previous process left open, THEN start watching. Order
     * matters: a tracker that observed first could append to a session whose
     * fate had not yet been decided.
     */
    async start() {
      try {
        const settled = await reconcile.execute({
          deviceIds, now: now(), staleAfterMs: sessionStaleAfterMs,
        });
        if (settled.resumed.length || settled.lost.length) {
          logger.info?.('arcade.tracking.reconciled', settled);
        }
      } catch (error) {
        // Never let reconciliation failure prevent observation — a missed
        // settlement is recoverable, a meter that never starts is not.
        logger.error?.('arcade.tracking.reconcile_failed', { error: error.message });
      }
      // Compare what the device recorded against what we saw. This never
      // invents billable time — it surfaces sessions the meter missed and
      // repairs attribution it could not determine live.
      for (const { deviceId, logReader } of built) {
        if (!logReader) continue;
        try {
          const found = await new ReconcileArcadeGameSessions({
            sessions, logReader, resolveContent, logger,
          }).execute({ deviceId, since: new Date(Date.parse(now()) - RECONCILE_WINDOW_MS).toISOString() });
          if (found.unrecorded.length || found.enriched.length) {
            logger.info?.('arcade.tracking.device_reconciled', {
              deviceId, unrecorded: found.unrecorded.length, enriched: found.enriched.length,
            });
          }
        } catch (error) {
          logger.warn?.('arcade.tracking.device_reconcile_failed', { deviceId, error: error.message });
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
      sessionMonitor.start();
    },
    stop() { sessionMonitor.stop(); watchdog.stop(); trackers.forEach((t) => t.stop()); },
  };
}

export default createArcadeGameSessionTracking;
