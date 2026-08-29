// backend/src/5_composition/modules/donow.mjs
//
// Composition wiring for DoNow — the household "start this, there, now"
// dispatch facade (spec `docs/superpowers/specs/2026-07-30-household-donow-
// dispatch-design.md`). This is the ONE place that names concrete adapters
// for all eight surfaces; every use case above it takes ports.
//
// HOUSEHOLD-LEVEL, NOT A SCHOOL PORT (spec §2 decision 2). This module mounts
// unconditionally, independent of `school.yml`'s `lifecycle.enabled` gate —
// School is one CONSUMER of the resulting `DoNowService`, wired into
// `createSchoolLifecycle` as a dependency, the same way any other caller
// (trigger, cron, voice — spec §10 "out of scope for now") would be.
//
// FAIL CLOSED, PER SURFACE. Every adapter here is optional-degrading by its
// own construction (Task 8): a missing seam (no `eventBus`, no
// `wakeAndLoadService`, no `thermalPrinterRegistry` entry, ...) means that ONE
// surface reports occupancy `unknown` / dispatch `{dispatched:false}` — it
// never stops `DoNowService` itself from constructing, and it never stops any
// OTHER surface from working. The router mounts only when the service
// constructs, which — because the service itself only requires a `surfaces`
// Map and a `datastore`, both always buildable — is unconditional in
// practice; this module never throws.
//
// WHY THIS RUNS AFTER wakeAndLoadService/homeAutomationAdapters/
// playbackHubServices (app.mjs ordering). Three of the seven v1 surfaces
// delegate straight to seams that do not exist yet at the point
// `createSchoolLifecycle` used to be constructed (`livingroom-tv` ->
// `wakeAndLoadService`, `playback-hub` -> the playback-hub container,
// `portal`'s occupancy needs nothing new but `thermal`'s printer resolution
// wants `thermalPrinterRegistry`, already available earlier). Building this
// module — and therefore `createSchoolLifecycle`, which now takes the real
// `donow` service as a dependency — has to happen after those seams exist,
// which is why `app.mjs` moved the school-lifecycle construction block to
// follow this one.
import { YamlDoNowDatastore } from '#adapters/persistence/yaml/YamlDoNowDatastore.mjs';
import { DoNowService } from '#apps/donow/DoNowService.mjs';
import { DoNowApprovals } from '#apps/donow/DoNowApprovals.mjs';
import { authenticate } from '#apps/trigger/guards/authenticate.mjs';
import { HaApprovalNotifier } from '#adapters/home-automation/donow/HaApprovalNotifier.mjs';
import { CallHomeAssistantService } from '#apps/home-automation/usecases/CallHomeAssistantService.mjs';
import { createDoNowRouter } from '#api/v1/routers/donow.mjs';
import { MidiPresenceTracker } from '#apps/donow/presence/MidiPresenceTracker.mjs';
import { FitnessPresenceTracker } from '#apps/donow/presence/FitnessPresenceTracker.mjs';
import { PlaybackPresenceTracker } from '#apps/donow/presence/PlaybackPresenceTracker.mjs';
import { PortalSurface } from '#apps/donow/surfaces/PortalSurface.mjs';
import { ThermalSurface } from '#apps/donow/surfaces/ThermalSurface.mjs';
import { LaserSurface } from '#apps/donow/surfaces/LaserSurface.mjs';
import { PlaybackHubSurface } from '#apps/donow/surfaces/PlaybackHubSurface.mjs';
import { LivingroomTvSurface } from '#apps/donow/surfaces/LivingroomTvSurface.mjs';
import { GarageFitnessSurface } from '#apps/donow/surfaces/GarageFitnessSurface.mjs';
import { PianoKioskSurface } from '#apps/donow/surfaces/PianoKioskSurface.mjs';
// Cross-domain reuse, at the composition root only: the same generic
// "render a document, print it on the thermal roll, never throw" use case
// the school console already relies on (`ReceiptPrinting.wired` reports
// false rather than the caller crashing when no printer/renderer resolved).
// Household-level DoNow gets its OWN instance — sharing the school console's
// would tie an unrelated surface's lifetime to `school.yml`'s lifecycle gate.
import { ReceiptPrinting } from '#apps/school/ReceiptPrinting.mjs';
import { ReceiptRendererAdapter } from '#adapters/school/documents/DocumentRendererAdapter.mjs';
import { HomeAssistantTvState } from '#adapters/donow/HomeAssistantTvState.mjs';
import { EventBusDoNowRealtimeAdapter } from '#adapters/donow/EventBusDoNowRealtimeAdapter.mjs';

/**
 * @param {object} deps
 * @param {object} deps.configService
 * @param {string|null} [deps.householdId]
 * @param {object} [deps.eventBus] - `{broadcast, subscribe}`; every soft-occupancy
 *   presence tracker and three of the seven surfaces need it. Absent means
 *   those surfaces degrade (occupancy `unknown`, dispatch `{dispatched:false}`)
 *   rather than DoNow failing to construct.
 * @param {object} [deps.thermalPrinterRegistry] - the house `ThermalPrinterRegistry`.
 * @param {object} [deps.homeAutomationAdapters] - `{haGateway, tvAdapter}` from
 *   `createHomeAutomationAdapters` (bootstrap.mjs) — `tvAdapter` feeds the
 *   `livingroom-tv` occupancy probe, `haGateway` feeds the HA approval notifier.
 * @param {object} [deps.wakeAndLoadService] - `{execute(deviceId, query)}` —
 *   `livingroom-tv`'s dispatch delegate.
 * @param {object} [deps.playbackHubContainer] - `PlaybackHubContainer`-shaped
 *   (`.sendHubCommand`, `.gateway`) — `playback-hub`'s dispatch + occupancy.
 *   `null` on a household with no `services.playback_hub` configured.
 * @param {object} [deps.schoolService] - `{activeSittings}` — `portal`'s
 *   occupancy source (the same in-memory quiz/drill sitting projection
 *   `PortalSurface`'s own doc names).
 * @param {() => Date} [deps.clock]
 * @param {object} [deps.logger]
 * @returns {{
 *   service: DoNowService, approvals: DoNowApprovals, notifier: object|null,
 *   router: import('express').Router, surfaces: Map<string, object>,
 *   datastore: YamlDoNowDatastore, presence: {midi: object|null, fitness: FitnessPresenceTracker, playback: object|null},
 *   stop: () => void,
 * }}
 */
export async function createDonow({
  configService, householdId = null, eventBus = null,
  thermalPrinterRegistry = null, homeAutomationAdapters = null,
  wakeAndLoadService = null, playbackHubContainer = null,
  schoolService = null, clock = () => new Date(), logger = console,
} = {}) {
  const cfg = configService.getHouseholdAppConfig?.(householdId, 'donow') || {};
  const timezone = configService.getTimezone?.() || null;
  const realtimeGateway = eventBus ? new EventBusDoNowRealtimeAdapter({ eventBus }) : null;

  // --- presence trackers (spec §5.1) -----------------------------------------
  // Both throw if handed no eventBus; guard here so a household with no bus
  // (a bare test harness) degrades every soft-occupancy surface to `unknown`
  // instead of this whole module throwing.
  const midiPresence = realtimeGateway ? new MidiPresenceTracker({ activitySource: realtimeGateway, logger }) : null;
  const playbackPresence = realtimeGateway ? new PlaybackPresenceTracker({ activitySource: realtimeGateway, logger }) : null;
  // No eventBus dependency at all (Task 7 discovery: `ingestFrontendLogs` has
  // no per-event hook of its own) — always constructed; `app.mjs` wires the
  // one-line tap into `ingestFrontendLogs`'s `onEvent` hook by calling
  // `presence.fitness.observe(normalized)` for every ingested frontend log
  // event. Silence (nothing ever tapped in) reads as `unknown`, fail-closed.
  const fitnessPresence = new FitnessPresenceTracker({ logger });

  // --- printing (thermal) ------------------------------------------------------
  // Mirrors `schoolLifecycle.mjs`'s own construction of the ESC/POS renderer:
  // a 1_rendering module the application layer may not import directly, so it
  // is loaded dynamically here at the composition root and degrades the ONE
  // surface (never the whole module) when unavailable.
  let receiptRenderer = null;
  try {
    const { createDocumentEscPosRenderer } = await import('#rendering/school/documents/DocumentEscPosRenderer.mjs');
    // Default symbology (CODE128, linear) — the household default everywhere
    // outside the school console, which alone opts into QR for its own imager.
    receiptRenderer = createDocumentEscPosRenderer();
  } catch (err) {
    logger.warn?.('donow.thermal.no-renderer', { error: err.message });
  }
  let thermalPrinter = null;
  if (thermalPrinterRegistry) {
    try {
      thermalPrinter = thermalPrinterRegistry.resolve(cfg.thermalPrinterLocation ?? undefined);
    } catch (err) {
      logger.warn?.('donow.thermal.no-printer', { location: cfg.thermalPrinterLocation ?? null, error: err.message });
    }
  }
  const receipts = new ReceiptPrinting({
    renderer: receiptRenderer ? new ReceiptRendererAdapter({ renderer: receiptRenderer }) : null,
    printer: thermalPrinter,
    logger,
  });

  // --- living-room TV: tvState is a thin wrap over TVControlAdapter -----------
  const tvAdapter = homeAutomationAdapters?.tvAdapter ?? null;
  const livingroomDeviceId = cfg.livingroomDeviceId ?? 'livingroom-tv';
  const tvState = tvAdapter ? new HomeAssistantTvState({ tvAdapter }) : null;

  // --- the seven v1 surfaces (spec §5) -----------------------------------------
  // `laser` is v1 DEFERRED-thin (Task 8): the spec's eventual shape is an
  // authorized-actor path over `PrintService`, which has no such entry point
  // today (`PrintService` is a quota-gated, printable-id-driven flow with no
  // `print(document, {learnerId, requestedBy})` shape to delegate to) — wiring
  // a mismatched adapter would be worse than the honest degrade `issueOrPrint:
  // null` already gives (attribution still logs, `dispatched:false`).
  const surfaces = new Map([
    ['portal', new PortalSurface({
      schoolLauncher: realtimeGateway,
      schoolActivity: typeof schoolService?.activeSittings === 'function' ? schoolService : null,
      logger,
    })],
    ['thermal', new ThermalSurface({ receipts })],
    ['laser', new LaserSurface({ issueOrPrint: null, logger })],
    ['playback-hub', new PlaybackHubSurface({
      sendHubCommand: playbackHubContainer?.sendHubCommand ?? null,
      headsetHubGateway: playbackHubContainer?.gateway ?? null,
      logger,
    })],
    ['livingroom-tv', new LivingroomTvSurface({
      wakeAndLoad: wakeAndLoadService,
      tvState,
      playback: playbackPresence,
      deviceId: livingroomDeviceId,
      logger,
    })],
    ['garage-fitness', new GarageFitnessSurface({ fitnessLauncher: realtimeGateway, presence: fitnessPresence, logger })],
    // Default-registered (Task 9's updated verdict, after the sheet-music
    // fix-up: an explicit `source:localId` contentId IS reachable today via
    // SheetMusic's own `view/*` route) — `PianoKioskSurface.validateAction`
    // itself now enforces that shape, so an unreachable contentId is REJECTED
    // (`failed`) rather than silently dispatching to a warn+no-op tablet.
    ['piano-kiosk', new PianoKioskSurface({
      pianoLauncher: realtimeGateway, presence: midiPresence, kioskDeviceParam: cfg.pianoKioskDeviceParam ?? null, logger,
    })],
  ]);

  // --- the service + approvals lifecycle + HA notifier -------------------------
  const datastore = new YamlDoNowDatastore({ configService, householdId, logger });

  let notifier = null;
  if (cfg.notifyService && homeAutomationAdapters?.haGateway) {
    const callHomeAssistant = new CallHomeAssistantService({ haGateway: homeAutomationAdapters.haGateway, logger });
    notifier = new HaApprovalNotifier({ callHomeAssistant, notifyService: cfg.notifyService, logger });
  } else if (cfg.notifyService) {
    logger.warn?.('donow.notifier.no-ha-gateway', { notifyService: cfg.notifyService });
  }

  const service = new DoNowService({
    surfaces,
    datastore,
    notifier,
    realtimeGateway,
    clock,
    timezone,
    approvalTtlSeconds: cfg.approvalTtlSeconds ?? undefined,
    logger,
  });
  const approvals = new DoNowApprovals({ service, datastore, notifier, clock, logger });
  // The approvals token is a SECRET, not app config: it is the only
  // authentication on `POST /approvals/:id/{approve,deny}`, so it lives in
  // `household/auth/donow.yml` alongside every other service credential
  // rather than in `config/donow.yml`. Note `getHouseholdAuth` takes
  // (service, householdId) — the reverse of `getHouseholdAppConfig` — and
  // returns null when the file is absent.
  const approvalsAuth = configService.getHouseholdAuth?.('donow', householdId) || {};
  if (!approvalsAuth.approvalsToken) {
    // Pre-existing posture, unchanged: a falsy expectedToken means the
    // `authenticate` guard passes everything, so approve/deny take NO auth.
    // Logged rather than thrown so a household that never configured one keeps
    // booting — but an open approvals endpoint should never be invisible.
    logger.warn?.('donow.approvals.no-token', { householdId });
  }
  const router = createDoNowRouter({
    service,
    approvals,
    authenticateApproval: authenticate,
    expectedToken: approvalsAuth.approvalsToken ?? null,
    logger,
  });

  logger.info?.('donow.ready', {
    surfaces: [...surfaces.keys()],
    notifier: Boolean(notifier),
    livingroomDeviceId,
  });

  return {
    service,
    approvals,
    notifier,
    router,
    surfaces,
    datastore,
    presence: { midi: midiPresence, fitness: fitnessPresence, playback: playbackPresence },
    /** Unsubscribe every eventBus-backed presence tracker. Safe to call more than once. */
    stop() {
      midiPresence?.stop();
      playbackPresence?.stop();
    },
  };
}

export default createDonow;
