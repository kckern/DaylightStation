// backend/src/5_composition/modules/schoolLifecycle.mjs
//
// Composition wiring for the School physical console (spec §2, §6.2, §9).
//
// This is the only file that names concrete adapters for the lifecycle: the use
// cases take ports, and the choice between a real printer and a double belongs
// here (decision D1). It returns everything `app.mjs` needs — the scan handler
// for the relay branch, the reporter for the parent board, and the routers.
//
// FAIL CLOSED, TWICE:
//
//  1. The virtual devices are wired ONLY when `school.yml` says
//     `virtualDevices: true` (default false). A production deployment must not
//     be able to reach "make the printer fail", even by guessing a path.
//  2. The lifecycle needs a document renderer, which is a `1_rendering` module
//     the application layer may not import. If that module is not present, the
//     whole lifecycle stays unwired and says so at boot — rather than mounting
//     routes that would fail at the moment a child scans a card.
//
// The doubles are constructed ONCE and shared between the lifecycle use cases
// and the virtual device console. Two instances would mean the console showing
// an empty tray while `IssueDocument` printed happily into a different one.
//
// WHERE ARTWORK LIVES: `<dataDir>/content/assets/<ref>.svg`.
//
// A document's `asset` block carries a bare ref (`school/math/fraction-strips`)
// and nothing about where it is — that is deployment knowledge, and it is
// resolved here. Refs are already namespaced by subsystem, which is why the root
// is `content/assets` and not `content/school/assets`: one tree, and the ref's
// first segment says whose it is. Curriculum YAML sits beside it under
// `content/school/curriculum/`.
//
// Shipping with NO resolver (which is what this file used to do) meant the
// renderer's default one threw on every sheet carrying a diagram, `IssueDocument`
// recorded a failure, and the child was handed a slip saying the printer was not
// answering — false, and no amount of retrying could clear it.

import path from 'path';
import { promises as fs } from 'fs';
import { YamlCurriculumDatastore } from '#adapters/persistence/yaml/YamlCurriculumDatastore.mjs';
import { YamlWorkSessionDatastore } from '#adapters/persistence/yaml/YamlWorkSessionDatastore.mjs';
import { YamlTokenRegistry } from '#adapters/persistence/yaml/YamlTokenRegistry.mjs';
import { YamlAssignmentStore } from '#adapters/persistence/yaml/YamlAssignmentStore.mjs';
import { YamlFormMapStore } from '#adapters/persistence/yaml/YamlFormMapStore.mjs';
import { YamlReviewQueue } from '#adapters/persistence/yaml/YamlReviewQueue.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { GrownUpGate } from '#apps/school/GrownUpGate.mjs';
import { ReceiptPrinting } from '#apps/school/ReceiptPrinting.mjs';
import { PortalDispatch } from '#apps/school/PortalDispatch.mjs';
import { LanguageProgramLauncher } from '#apps/school/LanguageProgramLauncher.mjs';
import { WorkSessionReporter } from '#apps/school/WorkSessionReporter.mjs';
import { BuildAgenda } from '#apps/school/usecases/BuildAgenda.mjs';
import { IssueDocument } from '#apps/school/usecases/IssueDocument.mjs';
import { DispatchMedia } from '#apps/school/usecases/DispatchMedia.mjs';
import { RecordMediaCompletion } from '#apps/school/usecases/RecordMediaCompletion.mjs';
import { SubmitPaperWork } from '#apps/school/usecases/SubmitPaperWork.mjs';
import { GradeSubmission } from '#apps/school/usecases/GradeSubmission.mjs';
import { CloseSessionOutcome } from '#apps/school/usecases/CloseSessionOutcome.mjs';
import { OpenRemediation } from '#apps/school/usecases/OpenRemediation.mjs';
import { ResolvePersonalCard } from '#apps/school/usecases/ResolvePersonalCard.mjs';
import { ResolveScanAction } from '#apps/school/usecases/ResolveScanAction.mjs';
import { ResolveSubjectNext } from '#apps/school/usecases/ResolveSubjectNext.mjs';
import { ResolveReviewItem } from '#apps/school/usecases/ResolveReviewItem.mjs';
import { SetAssignments } from '#apps/school/usecases/SetAssignments.mjs';
import { isSchoolToken } from '#domains/school/sessions/tokens.mjs';
import { shortId } from '#domains/core/utils/id.mjs';
import { createSchoolLifecycleRouter } from '#api/v1/routers/schoolLifecycle.mjs';
import { createSchoolVirtualDevicesRouter } from '#api/v1/routers/schoolVirtualDevices.mjs';

/**
 * Tokens are printed and carried around a house; a predictable stream would let
 * one child's ticket be guessed from another's. `crypto.randomUUID` is seeded
 * from the platform CSPRNG, so this draw is too — and it stays an injected
 * function, which is what keeps the domain pure and the tests deterministic.
 */
function cryptoRng(crypto) {
  return () => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 2 ** 32;
  };
}

/**
 * @param {object} deps
 * @param {object} deps.configService
 * @param {string|null} [deps.householdId]
 * @param {object} deps.schoolService - the existing grading engine + bank reader
 * @param {object} [deps.economyService]
 * @param {object} [deps.userService]
 * @param {object} [deps.languageStudyService] - the sentence-ladder program (Task 8/12).
 *   Present means the `language` program is a live launcher, reachable from a
 *   `subject_next` ticket the same as any curriculum unit; absent means the
 *   `launchers` map stays empty and no program entry can ever resolve.
 * @param {object} [deps.eventBus]
 * @param {object} [deps.thermalPrinterRegistry] - the house receipt-printer registry
 * @param {object} [deps.playbackAdapter] - real playback target; null until §8 lands
 * @param {() => Date} [deps.clock] - the ONE clock the whole lifecycle reads.
 *   Grace windows, token expiry and the UTC day boundary of a payout are all
 *   decided from it, so nothing downstream calls `Date.now()` and a test states
 *   the time rather than waiting for it. Defaults to the wall clock.
 * @param {() => number} [deps.rng] - draws in [0,1) for token minting. Defaults
 *   to the platform CSPRNG; a caller passes a seeded one only to make a run
 *   reproducible.
 * @param {object} [deps.logger]
 * @returns {Promise<{
 *   wired: boolean, reason: string|null,
 *   handlesCode: (code: string) => boolean,
 *   handleScan: ((args: {code: string, device?: string}) => Promise<object>)|null,
 *   reporter: object|null, router: object|null, devicesRouter: object|null,
 *   useCases: object, stores: object, devices: object, renderers: object,
 * }>}
 */
export async function createSchoolLifecycle({
  configService, householdId = null, schoolService,
  economyService = null, userService = null, eventBus = null,
  thermalPrinterRegistry = null, playbackAdapter = null,
  languageStudyService = null,
  clock = () => new Date(), rng = null, logger = console,
} = {}) {
  const cfg = configService.getHouseholdAppConfig?.(householdId, 'school') || {};
  const lifecycleCfg = cfg.lifecycle || {};
  const dataDir = configService.getDataDir();

  const inert = (reason) => {
    logger.info?.('school.lifecycle.unwired', { reason });
    return {
      wired: false, reason, handlesCode: () => false, handleScan: null,
      reporter: null, router: null, devicesRouter: null,
      useCases: {}, stores: {}, devices: {}, renderers: {},
    };
  };

  if (lifecycleCfg.enabled !== true) return inert('lifecycle.enabled is not true in school.yml');

  // --- hardware --------------------------------------------------------------
  const useVirtual = (cfg.virtualDevices ?? lifecycleCfg.virtualDevices) === true;
  const captureRoot = path.join(dataDir, 'apps', 'school', 'captures');

  // --- rendering (the one dependency the application layer cannot import) ----
  let documentRenderer = null;
  let receiptRenderer = null;
  try {
    const { createDocumentPdfRenderer } = await import('#rendering/school/documents/DocumentPdfRenderer.mjs');
    const { createFileAssetResolver } = await import('#rendering/school/documents/assetResolver.mjs');
    // Already the `IDocumentRenderer` shape: `render(document, opts)` →
    // `{pdf, pageCount, formMap}`. No adaptation needed, and none invented.
    documentRenderer = createDocumentPdfRenderer({
      resolveAsset: createFileAssetResolver({
        rootDir: cfg.assets?.dir || path.join(dataDir, 'content', 'assets'),
        logger,
      }),
    });
  } catch (err) {
    // No renderer, no console. Mounting routes that would fail at the moment a
    // child scans a card is worse than not mounting them.
    return inert(`document renderer unavailable: ${err.message}`);
  }

  try {
    // ESC/POS text + barcode items, NOT the canvas renderer's PNG.
    //
    // The canvas draws an empty square where the code belongs — it renders no
    // barcode at all — so an image job handed a child a receipt with nothing
    // scannable on it, and left the printer's text transcript (the operator's
    // record of what a child was told) empty. Emitting items lets the printer
    // generate a real Code128 in firmware. None of the three receipts this
    // console prints contains math, which is the only thing the raster path
    // buys; `DocumentReceiptRenderer` stays the probe that proves a document
    // CAN be drawn on 58mm tape.
    const { createDocumentEscPosRenderer } = await import('#rendering/school/documents/DocumentEscPosRenderer.mjs');
    // QR, not Code128: the school console's tickets are minted and re-derived
    // through this one renderer, and a QR is what a phone-shaped scanner in a
    // household reads back reliably at receipt-tape width.
    receiptRenderer = createDocumentEscPosRenderer({ symbology: 'QR' });
  } catch (err) {
    // A missing receipt renderer is survivable: worksheets still print, and
    // `ReceiptPrinting` reports every receipt as unprinted rather than lying.
    logger.warn?.('school.lifecycle.no-receipt-renderer', { error: err.message });
  }

  const devices = {};
  let laserPrinter = null;
  let receiptPrinter = null;
  let playback = null;

  if (useVirtual) {
    const [
      { VirtualLaserPrinterAdapter }, { VirtualThermalPrinterAdapter },
      { VirtualScannerAdapter }, { VirtualPlaybackAdapter }, { VirtualOmrReader },
    ] = await Promise.all([
      import('#adapters/hardware/laser-printer/VirtualLaserPrinterAdapter.mjs'),
      import('#adapters/hardware/thermal-printer/VirtualThermalPrinterAdapter.mjs'),
      import('#adapters/hardware/scanner/VirtualScannerAdapter.mjs'),
      import('#adapters/hardware/playback/VirtualPlaybackAdapter.mjs'),
      import('#adapters/hardware/omr/VirtualOmrReader.mjs'),
    ]);
    devices.laserPrinter = new VirtualLaserPrinterAdapter({
      captureDir: path.join(captureRoot, 'laser'), logger,
    });
    devices.thermalPrinter = new VirtualThermalPrinterAdapter(
      { captureDir: path.join(captureRoot, 'thermal') }, { logger },
    );
    if (eventBus) {
      devices.scanner = new VirtualScannerAdapter({ eventBus, logger });
      devices.playback = new VirtualPlaybackAdapter({
        eventBus, targets: (lifecycleCfg.media?.targets || []).map((t) => t.id).filter(Boolean), logger,
      });
    }
    devices.omrReader = new VirtualOmrReader({ eventBus, logger });
    laserPrinter = devices.laserPrinter;
    receiptPrinter = devices.thermalPrinter;
    playback = devices.playback;
    logger.warn?.('school.lifecycle.virtual-devices', { captureRoot, devices: Object.keys(devices) });
  } else {
    const { LaserPrinterAdapter } = await import('#adapters/hardware/laser-printer/LaserPrinterAdapter.mjs');
    const printerHost = cfg.printing?.host || configService.getDeviceConfig?.('kitchen-printer')?.host || null;
    if (!printerHost) return inert('no laser printer host configured (school.yml printing.host)');
    laserPrinter = new LaserPrinterAdapter({
      host: printerHost,
      port: cfg.printing?.port || 631,
      path: cfg.printing?.path || '/ipp/print',
      logger,
    });
    // The thermal registry is built elsewhere in the composition root, so the
    // lifecycle asks it for whichever printer `school.yml` names rather than
    // standing up a second adapter against the same host. With no receipt
    // printer the console still runs: worksheets print, and every receipt
    // reports itself unprinted instead of pretending.
    const receiptLocation = lifecycleCfg.receiptPrinter ?? null;
    if (thermalPrinterRegistry) {
      try {
        receiptPrinter = thermalPrinterRegistry.resolve(receiptLocation ?? undefined);
      } catch (err) {
        logger.warn?.('school.lifecycle.no-receipt-printer', { location: receiptLocation, error: err.message });
      }
    }
    // Real playback dispatch is NOT wired in this slice: the playback-hub
    // container is constructed later in the composition root, and mapping a
    // school target onto a screen or a headset is its own piece of work (§8).
    // Injected rather than read from YAML, because an adapter is an object and
    // config is text — a `playbackAdapter:` key in school.yml could only ever
    // have been dead.
    playback = playbackAdapter;
  }

  // --- persistence -----------------------------------------------------------
  const stores = {
    catalog: new YamlCurriculumDatastore({ configService }),
    sessions: new YamlWorkSessionDatastore({ configService }),
    tokens: new YamlTokenRegistry({ configService }),
    assignments: new YamlAssignmentStore({ configService }),
    formMaps: new YamlFormMapStore({ configService }),
    reviewQueue: new YamlReviewQueue({ configService }),
  };

  // --- program launchers (Task 8/12) ------------------------------------------
  // The same IANA zone `LanguageStudyService` reads its 4am study-day boundary
  // against (`app.mjs`) — one source, so the agenda's "done today" and the
  // program's own idea of "today" can never drift apart.
  const timezone = configService.getTimezone?.() || null;
  const portal = new PortalDispatch({ eventBus, logger });
  // Present only when the caller wired a language-study service: no service,
  // no launcher, and a program-typed unit degrades to "not answering" rather
  // than throwing (CurriculumAccess/ResolveSubjectNext's own try/catch).
  const launchers = new Map(languageStudyService
    ? [['language', new LanguageProgramLauncher({ languageStudyService, portal, logger })]]
    : []);

  // --- collaborators ---------------------------------------------------------
  const draw = rng ?? cryptoRng(globalThis.crypto);
  // Shared by BuildAgenda and ResolveSubjectNext so a curriculum entry opened
  // by either one gets the same shape of session id.
  const newSessionId = () => `ses_${shortId(8)}`;
  const curriculum = new CurriculumAccess({
    catalog: stores.catalog,
    // Read per call, never captured: banks warm asynchronously after boot, and
    // a set snapshotted at construction would be empty for the first minute.
    bankIds: () => (schoolService?.listBanks?.() || []).map((b) => b.id).filter(Boolean),
    // Same read-per-call rule: a launcher registered after boot (or one that
    // never showed up) must be reflected immediately, not frozen at construction.
    programIds: () => [...launchers.keys()],
    logger,
  });
  const bankReader = {
    getBank: (id) => { try { return schoolService.getBank(id); } catch { return null; } },
  };
  const receipts = new ReceiptPrinting({ renderer: receiptRenderer, printer: receiptPrinter, logger });
  // Who may act for a child. Read through `userService` per call, never
  // snapshotted: a member added after boot is a member. With no user service at
  // all, nobody is a grown-up and every parent-only write is refused — the
  // console still teaches and prints, it just cannot be signed off, which is the
  // right way round for a household with an unreadable roster.
  const grownUps = new GrownUpGate({
    roster: () => userService?.getHouseholdRoster?.() ?? [],
    clock,
    logger,
  });

  // --- use cases -------------------------------------------------------------
  const buildAgenda = new BuildAgenda({
    curriculum, assignments: stores.assignments, sessions: stores.sessions, tokens: stores.tokens,
    launchers, timezone, clock, rng: draw, newSessionId,
    // Optional knob; BuildAgenda's own default (168h) applies when unset.
    subjectTokenTtlHours: lifecycleCfg.subjectTokenTtlHours, logger,
  });
  const resolveSubjectNext = new ResolveSubjectNext({
    curriculum, assignments: stores.assignments, sessions: stores.sessions,
    launchers, timezone, clock, newSessionId, logger,
  });

  // --- dry-run agenda preview (DoNow + Agenda Preview plan, Task 2) ---------
  // A parent-facing "what would print right now" view. It runs the exact same
  // algorithm as `buildAgenda` above — same curriculum, same planner, same
  // program launchers — but against dry-run stand-ins for sessions and tokens,
  // so a preview can never open a real work session or mint a scannable
  // ticket. `appendEvent` is a no-op because `ensureSession` only needs to
  // REDUCE a session's events to decide what is next; it never has to persist
  // one for a preview to be accurate.
  const previewSessions = {
    listForLearner: (id) => stores.sessions.listForLearner(id),
    readEvents: (sid) => stores.sessions.readEvents(sid),
    appendEvent: async () => {},
  };
  const previewAgenda = new BuildAgenda({
    curriculum, assignments: stores.assignments, sessions: previewSessions,
    tokens: { put: async () => {} },
    launchers, timezone, clock, rng: draw, newSessionId,
    subjectTokenTtlHours: lifecycleCfg.subjectTokenTtlHours,
    logger: logger.child ? logger.child({ preview: true }) : logger,
  });
  // The rendering-layer PNG renderer, same optional-dependency posture as the
  // ESC/POS receipt renderer above: a preview is a nice-to-have surface, not
  // the console itself, so its absence degrades the one route rather than the
  // whole lifecycle.
  let receiptPngRenderer = null;
  try {
    const { createDocumentReceiptRenderer } = await import('#rendering/school/documents/DocumentReceiptRenderer.mjs');
    // QR, matching the printed receipt's own symbology — the preview is
    // supposed to look like the paper, not like a different console.
    receiptPngRenderer = createDocumentReceiptRenderer({ scanCodes: 'qr' });
  } catch (err) {
    logger.warn?.('school.lifecycle.no-preview-renderer', { error: err.message });
  }
  const issueDocument = new IssueDocument({
    curriculum, sessions: stores.sessions, tokens: stores.tokens,
    renderer: documentRenderer, printer: laserPrinter, formMaps: stores.formMaps,
    bankReader, clock, rng: draw, logger,
  });
  const dispatchMedia = playback
    ? new DispatchMedia({
      curriculum, sessions: stores.sessions, playback,
      targets: lifecycleCfg.media?.targets || [], clock, logger,
    })
    : null;
  const recordMediaCompletion = new RecordMediaCompletion({
    curriculum, sessions: stores.sessions, clock,
    graceSec: lifecycleCfg.media?.graceSec ?? 600, logger,
  });
  const submitPaperWork = new SubmitPaperWork({
    curriculum, sessions: stores.sessions, formMaps: stores.formMaps,
    reviewQueue: stores.reviewQueue, bankReader, clock, logger,
  });
  const gradeSubmission = new GradeSubmission({
    curriculum, sessions: stores.sessions, reviewQueue: stores.reviewQueue,
    grader: schoolService, bankReader, grownUps, clock, logger,
  });
  const closeSessionOutcome = new CloseSessionOutcome({
    curriculum, sessions: stores.sessions, tokens: stores.tokens, assignments: stores.assignments,
    // The result receipt is where a FAILED attempt's retry barcode reaches the
    // child's hand. Without this the close-out returned JSON and the loop
    // dead-ended.
    receipts,
    economy: economyService,
    economyAction: lifecycleCfg.economy?.action || 'school-unit-complete',
    economyEnabled: lifecycleCfg.economy?.enabled === true,
    grownUps,
    clock, rng: draw, logger,
  });
  const openRemediation = new OpenRemediation({ curriculum, sessions: stores.sessions, clock, logger });
  const resolvePersonalCard = new ResolvePersonalCard({
    buildAgenda, receipts,
    roster: {
      displayName: (id) => (userService?.getHouseholdRoster?.() || []).find((u) => u.id === id)?.name ?? null,
    },
    logger,
  });
  // The media leg is optional (a household with no playback target still prints
  // worksheets), but the scan resolver is not — so a no-op stand-in keeps the
  // single entry point whole rather than making every caller check.
  const mediaOrNothing = dispatchMedia ?? {
    selectableTargets: () => [],
    execute: async ({ sessionId }) => ({
      status: 'unavailable', sessionId, dispatchId: null, target: null, contentId: null,
      durationSec: null, message: 'There is nowhere to play this right now. Tell a grown-up.', document: null,
    }),
  };
  const resolveScanAction = new ResolveScanAction({
    tokens: stores.tokens, sessions: stores.sessions, curriculum,
    resolvePersonalCard, issueDocument, dispatchMedia: mediaOrNothing, openRemediation,
    receipts, resolveSubjectNext, portal, launchers, clock, logger,
  });

  // The two parent-only writes. They are use cases rather than raw store calls
  // because the router may not be the place a child's sign-off is checked.
  const resolveReviewItem = new ResolveReviewItem({
    reviewQueue: stores.reviewQueue, grownUps, clock, logger,
  });
  const setAssignments = new SetAssignments({
    assignments: stores.assignments, grownUps, clock, logger,
  });

  const useCases = {
    buildAgenda, issueDocument, dispatchMedia, recordMediaCompletion,
    submitPaperWork, gradeSubmission, closeSessionOutcome, openRemediation,
    resolvePersonalCard, resolveScanAction, resolveReviewItem, setAssignments,
    previewAgenda,
  };

  const router = createSchoolLifecycleRouter({
    ...useCases,
    receiptPngRenderer,
    assignments: stores.assignments,
    reviewQueue: stores.reviewQueue,
    curriculum,
    sessions: stores.sessions,
    logger,
  });

  // Only when the doubles exist; the factory itself also refuses to register a
  // route for a device it was not handed.
  const devicesRouter = useVirtual
    ? createSchoolVirtualDevicesRouter({
      ...devices,
      getFormMap: (formId) => stores.formMaps.get(formId),
      logger,
    })
    : null;

  logger.info?.('school.lifecycle.ready', {
    virtualDevices: useVirtual,
    media: Boolean(dispatchMedia),
    receipts: receipts.wired,
    economy: lifecycleCfg.economy?.enabled === true,
    launchers: [...launchers.keys()],
  });

  return {
    wired: true,
    reason: null,
    handlesCode: (code) => isSchoolToken(code),
    handleScan: ({ code, device = null }) => resolveScanAction.execute({ code, device }),
    reporter: new WorkSessionReporter({
      curriculum, sessions: stores.sessions, assignments: stores.assignments,
      reviewQueue: stores.reviewQueue, clock, logger,
    }),
    router,
    devicesRouter,
    useCases,
    // `curriculum` is the read model every use case above shares — the same
    // cache, so a caller reading a unit sees exactly what the console saw.
    stores: { ...stores, curriculum },
    devices,
    // The two renderers this console built, exposed for inspection. Neither is
    // reachable any other way, and a caller that wants to know whether a
    // document can be drawn on 58mm tape should ask the one that will draw it.
    renderers: { document: documentRenderer, receipt: receiptRenderer, receiptPng: receiptPngRenderer },
  };
}

export default createSchoolLifecycle;
